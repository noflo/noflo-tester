const chai = require('chai');
const Tester = require('../lib/wrapper');

describe('Wrapping a component from library', () => {
  const t = new Tester('core/RepeatAsync');
  before((done) => t.start(done));
  it('should sent the expected result', () => {
    const input = {
      hello: 'world',
    };
    t.send('in', input);
    return t.receive('out')
      .then((output) => {
        chai.expect(output).to.eql(input);
      });
  });
});
