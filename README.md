NoFlo component/graph testing and embedding wrapper
============

Wraps a component to provide a convenient interface for use in normal JavaScript code. It is compatible with any testing paradigm: TDD/BDD/whatever. Read also [Embedding NoFlo](https://noflojs.org/documentation/embedding/).

## Benefits

* Provides easy JavaScript access to long-running NoFlo graphs
* Reduces boilerplate to set up a component testbed.
* Provides common high-level methods.
* Provides low-level access to the component, ports and events.
* Compatible with different testing frameworks and complex test cases.

## Getting started

Install `noflo-wrapper` and add it to your project's dependecies:

```
npm install noflo-wrapper --save
```

Require it:

```javascript
const Wrapper = require('noflo-wrapper');
```

Use methods described below and run the tests just as you do it normally with your favorite testing framework.

## API

Explanations below contain examples in JavaScript using Mocha and Chai in BDD style. You can also write your tests using any other framework or style.

### Loading a component

First you need to create a new Wrapper object to wrap your component or graph:

```javascript
const t = new Wrapper('my-noflo-app/Multiplier');
```

The constructor accepts either a full component name (including namespace prefix), or a function returning an instantiated component object, or a NoFlo Graph instance.

In general, components are loaded and wired up asynchronously, so you need to start the wrapper like this before running any tests:

```javascript
before((done) => {
  t.start((err, instance) => {
    if (err) { return done(err); } // Error handling, optional
    // instance contains a ready to use component
    done();
  });
});
```

**Advanced options**

If the component to be tested is a NoFlo graph, you can pass custom event handlers to the Wrapper constructor:

```javascript
const t = new Wrapper('my-noflo-app/Multiplier', {
  load: (err, instance) => {
    // This is called after loading the graph
  },
  ready: (err, instance) => {
    // This is called when the network is ready to be attached
  },
});
```

### Sending inputs and expecting output

A high-level `receive` method listens on output ports for data and groups until a `disconnect` event.

A high-level `send` methods sends data followed by a disconnect to one or more input ports.

Here is an example that tests a simple multiplier component:

```javascript
t.receive('xy', (data) => {
  chai.expect(data).to.equal(30);
  done();
});

t.send({
  x: 5,
  y: 6,
});
```

Note that `receive` is called before `send`, because it binds event handlers asynchronously, while `send` is almost an instant operation.

Short syntax for `send` method to send data and disconnect to just one inport looks like this:

```javascript
t.send('x', 123);
```

### Direct access to component, ports and events

In more complex test cases you might want to send IPs and handle particular events manually:

```javascript
t.outs.xy.on('data', (data) => {
  chai.expect(data).to.equal(24);
  done();
});

t.ins.x.send(8);
t.ins.x.disconnect();
t.ins.y.send(3);
t.ins.y.disconnect()
```

Wrapper object provides `ins` and `outs` hashmaps of sockets attached to the component.

You can also access the component directly via `c` property:

```javascript
if (t.c.outPorts.error.isAttached()) {
  // Do something
});
```

### Receiving multiple data chunks and groups

As `receive` is triggered by a `disconnect` event, there might be multiple `data` packets in the transmission and also some `group` bracket IPs. In such case they are available as arrays and counts in the callback arguments:

```javascript
t.receive('xy', (data, groups, dataCount, groupCount) => {
  chai.expect(data).to.eql([4, 10, 18]);
  chai.expect(dataCount).to.equal(3);
  chai.expect(groups).to.eql(['foo', 'bar']);
  chai.expect(groupCount).to.equal(2);
  done();
});
```

Note that `groupCount` counts only closed groups via `endGroup` events, while `groups` contains unique groups sent to the output.

### Receiving from multiple output ports

If a component sends output to multiple ports at the same time and you need to test results from all of them at once, that may require some syncrhonization spaghetti in your specs. But `receive` simplifies it by accepting a hashmap and returning a Promise that is resolved when results from all outputs in the map have been received:

```javascript
let div = null;
let mod = null;

t.receive({
  quotient: (data) => {
    div = data;
  },
  remainder: (data) => {
    mod = data;
  },
})
  .then(() => {
    chai.expect(div).to.equal 3
    chai.expect(mod).to.equal 2
    done()
  });

t.send({
  dividend: 11,
  divisor: 3,
});
```

### Using promises to chain subsequent receives

The `receive` method returns a Promise resolved when a transmission is received, so you can chain subsequent transmissions in a thenable way, e.g.:

```javascript
t.receive('quotient', (data) => {
  chai.expect(data).to.equal(5);
})
  .then(() => {
    t.receive('quotient', (data) =>
      chai.expect(data).to.equal(8);
      done()
    });
    t.send({
      dividend: 56,
      divisor: 7,
    });
  });
t.send({
  dividend: 30,
  divisor: 6,
});
```

### Capturing Flowtraces

noflo-wrapper supports capturing [Flowtraces](https://github.com/flowbased/flowtrace) for your runs. This enables retroactive debugging of the data flow in tools like Flowhub.

You can enable this with:

```javascript
const t = new Wrapper('my-noflo-app/Multiplier', {
  debug: true,
});
```

If you want to manage your own Flowtraces, you can also pass in an instance instead:

```javascript
const { Flowtrace } = new Flowtrace();
const myTrace = new Flowtrace();
const t = new Wrapper('my-noflo-app/Multiplier', {
  flowtrace: myTrace,
});
```

Under Node.js you can save the captured Flowtrace into a file with:

```javascript
const tracefile = await t.dumpTrace();
```

If you want to store it some other way, it can be accessed via `t.tracer`.

## Examples

See complete BDD-style examples in `spec` folder.

## Development

The first thing to start developing this package is:

```
npm install
```

Then run bundled Mocha specs:

```
npm test
```

Then feel free to hack on the `lib` and `specs`.

## Changes

* 0.3.0 (2020-09-14)
  - Ported from CoffeeScript to ES6
  - Now using native Promises instead of Bluebird
