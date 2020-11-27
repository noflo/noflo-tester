const noflo = require('noflo');
const { Flowtrace } = require('flowtrace');
const { writeTrace } = require('./trace');

// Tester loads and wraps a NoFlo component or graph
// for testing it with input and output commands.
class Tester {
  // Constructor accepts the following arguments:
  //
  // - `component`: full name of the component (including library prefix),
  //   or an already loaded component instance, or a custom function that
  //   returns a new instance, or a NoFlo Graph.
  // - `options`: a map of custom options, including:
  //   - `load`: a callback `function(err, instance)` called after loading
  //     a new object instance;
  //   - `ready`: a callback `function(err, instance)` called when instance
  //     is ready.
  constructor(component, options = {}) {
    this.component = component;
    this.options = options;
    this.tracer = null;
    this.network = null;
    if (this.options.cache !== true) {
      this.options.cache = false;
    }

    if (this.options.loader) {
      this.loader = this.options.loader;
    } else {
      if (this.options.baseDir) {
        this.baseDir = this.options.baseDir;
      } else if (process.env.NOFLO_TEST_BASEDIR) {
        this.baseDir = process.env.NOFLO_TEST_BASEDIR;
      } else {
        this.baseDir = process.cwd();
      }
      this.loader = new noflo.ComponentLoader(this.baseDir, {
        cache: this.options.cache,
      });
    }

    if (this.options.flowtrace) {
      // Use Flowtrace provided via settings
      this.tracer = this.options.flowtrace;
    } else if (this.options.debug) {
      // Use internal Flowtrace
      this.tracer = new Flowtrace();
    }

    this.componentName = this.options.componentName || 'wrapper/Wrapped';
    if (typeof this.component === 'string') {
      this.componentName = this.component;
    }
  }

  // Prepares a NoFlo network for the component
  prepareNetwork(component, done) {
    if (typeof component === 'object' && Array.isArray(component.edges)) {
      // This is a Graph object
      noflo.createNetwork(component, {
        componentLoader: this.loader,
        baseDir: this.baseDir,
        delay: true,
      }, done);
      return;
    }
    if (!this.loader.components) {
      // Prepare component loader first
      this.loader.listComponents((err) => {
        if (err) {
          done(err);
          return;
        }
        this.prepareNetwork(component, done);
      });
      return;
    }
    if (typeof component !== 'string') {
      // Register the component to be loadable
      this.loader.registerComponent('wrapper', 'Wrapped', this.component, (err) => {
        if (err) {
          done(err);
          return;
        }
        this.prepareNetwork('wrapper/Wrapped', done);
      });
      return;
    }
    this.loader.load(component, (loadErr, instance) => {
      if (loadErr) {
        done(loadErr);
        return;
      }
      if (instance.isSubgraph() && instance.network) {
        // We can use the subraph as-is
        done(null, instance.network);
        return;
      }
      // Prepare a Graph to wrap the component
      const graph = new noflo.Graph(component);
      const nodeName = this.componentName;
      graph.addNode(nodeName, component);
      // Expose ports
      const inPorts = instance.inPorts.ports;
      const outPorts = instance.outPorts.ports;
      Object.keys(inPorts).forEach((port) => {
        graph.addInport(port, nodeName, port);
      });
      Object.keys(outPorts).forEach((port) => {
        graph.addOutport(port, nodeName, port);
      });
      // Prepare network
      noflo.createNetwork(graph, {
        componentLoader: this.loader,
        baseDir: this.baseDir,
        delay: true,
      }, done);
    });
  }

  // Loads a Network, attaches inputs and outputs and starts it.
  //
  //  - `done`: a callback `function(err, instance)` called after starting
  //   a component instance.
  start(done) {
    if (typeof done !== 'function') {
      throw new Error('start() requires a callback');
    }
    this.prepareNetwork(this.component, (prepareErr, network) => {
      if (typeof (this.options.load) === 'function') {
        this.options.load(prepareErr, network);
      }
      if (prepareErr) {
        done(prepareErr);
        return;
      }
      network.connect((connectErr) => {
        if (connectErr) {
          done(connectErr);
          return;
        }
        if (typeof (this.options.ready) === 'function') {
          this.options.ready(null, network);
        }
        this.ins = {};
        this.outs = {};
        if (this.tracer) {
          // Attach tracer
          try {
            network.setFlowtrace(this.tracer, network.graph.name || this.componentName, true);
          } catch (e) {
            done(e);
            return;
          }
        }
        // Attach to exported ports
        Object.keys(network.graph.inports).forEach((name) => {
          const portDef = network.graph.inports[name];
          const process = network.getNode(portDef.process);
          if (!process) {
            return;
          }
          const socket = noflo.internalSocket.createSocket();
          network.subscribeSocket(socket);
          socket.to = {
            process,
            port: portDef.port,
          };
          process.component.inPorts[portDef.port].attach(socket);
          this.ins[name] = socket;
        });
        Object.keys(network.graph.outports).forEach((name) => {
          const portDef = network.graph.outports[name];
          const process = network.getNode(portDef.process);
          if (!process) {
            return;
          }
          const socket = noflo.internalSocket.createSocket();
          network.subscribeSocket(socket);
          socket.from = {
            process,
            port: portDef.port,
          };
          process.component.outPorts[portDef.port].attach(socket);
          this.outs[name] = socket;
        });
        this.network = network;
        network.start((err) => done(err, network));
      });
    });
  }

  dumpTrace() {
    if (noflo.isBrowser() || !this.tracer) {
      return Promise.resolve();
    }
    return writeTrace({
      baseDir: this.baseDir,
    }, this.tracer)
      .then((f) => {
        console.log('Wrote flowtrace to', f);
        return f;
      });
  }

  // Sends data packets to one or multiple inports and disconnects them.
  //
  // It accepts either a single hashmap argument mapping port names to data,
  // or a pair of arguments with port name and data to sent to that single
  // port.
  send(hashmap, singleData) {
    let portmap = hashmap;
    if (typeof (portmap) === 'string') {
      const port = portmap;
      portmap = {};
      portmap[port] = singleData;
    }
    (() => {
      const result = [];
      Object.keys(portmap).forEach((port) => {
        const value = portmap[port];
        if (Object.keys(this.ins).indexOf(port) === -1) {
          throw new Error(`No such inport: ${port}`);
        }
        const ip = noflo.IP.isIP(value) ? value : new noflo.IP('data', value);
        result.push(this.ins[port].post(ip));
      });
      return result;
    })();
  }

  // Listens for a transmission from an outport of a component until next
  // disconnect event.
  //
  // The `callback` parameter is passed the following arguments:
  // `(data, groups, dataCount, groupCount)`. If there were multiple data
  // packets, `data` is an array of length passed in `dataCount`. `groupCount`
  // contains the number of complete (closed) groups.
  //
  // Returns a promise that is resolved when a value is received.
  //
  // You can pass a hashmap of `port: callback` to this method. The returned
  // promise is resolved after data from all ports in the map have been
  // received.
  receive(port, callback) {
    const getTask = (portName, done) => {
      if (Object.keys(this.outs).indexOf(portName) === -1) {
        throw new Error(`No such outport: ${portName}`);
      }
      return (resolve) => {
        let data = [];
        let dataCount = 0;
        const groups = [];
        let groupCount = 0;
        let brackets = 0;
        let listeningForIps = false;
        this.outs[portName].removeAllListeners();

        const finish = () => {
          this.outs[portName].removeAllListeners();
          if (dataCount === 1) { data = data.pop(); }
          if (done) { done(data, groups, dataCount, groupCount); }
          resolve(data);
        };

        this.outs[portName].on('data', (packet) => {
          if (listeningForIps) { return; }
          data.push(packet);
          dataCount += 1;
        });
        this.outs[portName].on('begingroup', (group) => {
          if (listeningForIps) { return; }
          // Capture only unique groups
          if (groups.indexOf(group) === -1) {
            groups.push(group);
            groupCount += 1;
          }
        });
        this.outs[portName].on('disconnect', () => {
          if (listeningForIps) { return; }
          finish();
        });

        this.outs[portName].on('ip', (packet) => {
          listeningForIps = true;
          if (packet.type === 'openBracket') {
            brackets += 1;
            // Capture only unique groups
            if ((packet.data !== null) && (groups.indexOf(packet.data) === -1)) {
              groups.push(packet.data);
              groupCount += 1;
            }
          }
          if (packet.type === 'closeBracket') {
            brackets -= 1;
          }
          if (packet.type === 'data') {
            data.push(packet.data);
            dataCount += 1;
          }
          if (brackets === 0) {
            finish();
          }
        });
      };
    };

    if (typeof (port) === 'object') {
      // Map of port: callback
      const tasks = [];
      Object.keys(port).forEach((name) => {
        const cb = port[name];
        tasks.push(new Promise(getTask(name, cb)));
      });
      return Promise.all(tasks);
    }
    return new Promise(getTask(port, callback));
  }
}

module.exports = Tester;
