const chai = require('chai');
const noflo = require('noflo');
const Tester = require('../lib/wrapper');

// Async divider
const c = new noflo.Component();
c.description = 'Divides integers into integers';
c.inPorts = new noflo.InPorts({
  dividend: {
    datatype: 'int',
  },
  divisor: {
    datatype: 'int',
  },
});
c.outPorts = new noflo.OutPorts({
  quotient: {
    datatype: 'int',
  },
  remainder: {
    datatype: 'int',
  },
  error: {
    datatype: 'object',
  },
});
c.process((input, output) => {
  if (!input.hasData('dividend', 'divisor')) { return; }
  const dividend = input.getData('dividend');
  const divisor = input.getData('divisor');
  setTimeout(() => {
    if (divisor === 0) {
      output.done(new Error('Division by 0'));
      return;
    }
    if (c.outPorts.quotient.isAttached()) {
      output.send({ quotient: parseInt(dividend / divisor, 10) });
    }
    if (c.outPorts.remainder.isAttached()) {
      output.send({ remainder: parseInt(dividend % divisor, 10) });
    }
    output.done();
  },
  0);
});

describe('Synchronization of received packets', () => {
  const t = new Tester(() => c);

  before((done) => t.start(done));

  it('should wait for result from multiple outputs', (done) => {
    let div = null;
    let mod = null;

    t.receive({
      quotient(data) {
        div = data;
      },
      remainder(data) {
        mod = data;
      },
    }).then(() => {
      chai.expect(div).to.equal(3);
      chai.expect(mod).to.equal(2);
      done();
    });

    t.send({
      dividend: 11,
      divisor: 3,
    });
  });

  it('should chain subsequent receives via promises', (done) => {
    t.receive('quotient', (data) => chai.expect(data).to.equal(5)).then(() => {
      t.receive('quotient', (data) => {
        chai.expect(data).to.equal(8);
        done();
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
  });
});
