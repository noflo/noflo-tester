const chai = require('chai');
const noflo = require('noflo');
const Tester = require('../lib/wrapper');

// A simple component
const c = new noflo.Component();
c.description = 'Echoes its input to the output';
c.inPorts.add('in',
  c.outPorts.add('out'));
c.process((input, output) => {
  const data = input.getData('in');
  output.sendDone({ out: data });
});

describe('Single input tester', () => {
  const t = new Tester(c);

  before((done) => t.start(() => done()));

  it('should send data to a single input and expect the result', (done) => {
    t.receive('out', (data) => {
      chai.expect(data).to.equal('foobar');
      done();
    });

    t.send('in', 'foobar');
  });
});
