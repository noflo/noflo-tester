const noflo = require('noflo');
const {
  trace,
} = require('noflo-runtime-base');

// Tester loads and wraps a NoFlo component or graph
// for testing it with input and output commands.
class Tester {
  // Constructor accepts the following arguments:
  //
  // - `component`: full name of the component (including library prefix),
  //   or an already loaded component instance, or a custom function that
  //   returns a new instance.
  // - `options`: a map of custom options, including:
  //   - `load`: a callback `function(err, instance)` called after loading
  //     a new object instance;
  //   - `ready`: a callback `function(err, instance)` called when instance
  //     is ready.
  constructor(component, options = {}) {
    this.dumpTrace = this.dumpTrace.bind(this);
    this.send = this.send.bind(this);
    this.receive = this.receive.bind(this);
    this.component = component;
    this.options = options;
    if ((this.options.cache == null)) { this.options.cache = true; }

    if (typeof (this.component) === 'object') {
      this.c = this.component;
    } else if (typeof (this.component) === 'function') {
      this.c = this.component();
    } else if (this.options.loader) {
      this.loader = this.options.loader;
    } else {
      if (this.options.baseDir) {
        this.baseDir = this.options.baseDir;
      } else if (process.env.NOFLO_TEST_BASEDIR) {
        this.baseDir = process.env.NOFLO_TEST_BASEDIR;
      } else {
        this.baseDir = process.cwd();
      }
      this.loader = new noflo.ComponentLoader(this.baseDir, { cache: this.options.cache });
    }
    if (this.options != null ? this.options.debug : undefined) {
      // instantiate our Tracer
      this.tracer = new trace.Tracer();
    }
  }

  // Loads a component, attaches inputs and outputs and starts it.
  //
  //  - `done`: a callback `function(err, instance)` called after starting
  //   a component instance.
  start(done) {
    if (typeof done !== 'function') {
      throw new Error('start() requires a callback');
    }
    const whenReady = () => {
      if (typeof (this.options.ready) === 'function') { this.options.ready(null, this.c); }
      this.ins = {};
      this.outs = {};
      Object.keys(this.c.inPorts.ports).forEach((name) => {
        if (typeof (this.c.inPorts[name].attach) !== 'function') { return; }
        const socket = noflo.internalSocket.createSocket();
        this.c.inPorts[name].attach(socket);
        this.ins[name] = socket;
      });
      Object.keys(this.c.outPorts.ports).forEach((name) => {
        if (typeof (this.c.outPorts[name].attach) !== 'function') { return; }
        const socket = noflo.internalSocket.createSocket();
        this.c.outPorts[name].attach(socket);
        this.outs[name] = socket;
      });
      if (typeof done !== 'function') { return; }
      this.c.start((err) => done(err, this.c));
    };
    if (this.c) {
      whenReady();
    }
    this.loader.load(this.component, (err, instance) => {
      if (typeof (this.options.load) === 'function') { this.options.load(err, instance); }
      if (err) {
        done(err);
        return;
      }
      this.c = instance;
      if (instance.isReady()) {
        whenReady();
        return;
      }
      // Graphs need to wait for ready event
      this.c.once('ready', () => {
        if (this.options.debug) {
          this.tracer.attach(instance.network);
        }
        whenReady();
      });
    });
  }

  dumpTrace(fileName = null) {
    if (this.options != null ? this.options.debug : undefined) {
      this.tracer.dumpFile(fileName, (err, f) => {
        if (err) { throw err; }
        console.log('Wrote flowtrace to', f);
      });
    }
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
        if (!(port in this.ins)) { throw new Error(`No such inport: ${port}`); }
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
      if (!(portName in this.outs)) { throw new Error(`No such outport: ${portName}`); }
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
