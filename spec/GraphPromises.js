const chai = require('chai');
const noflo = require('noflo');
const Tester = require('../lib/wrapper');

describe('Wrapping a Graph object (Promises API)', () => {
  // Create a noflo.Graph object (could also be loaded from JSON/FBP)
  const graph = new noflo.Graph('Test Graph')
    .addNode('kick', 'core/Kick')
    .addNode('repeat', 'core/RepeatAsync')
    .addEdge('kick', 'out', 'repeat', 'in')
    .addInitial({
      test: 42,
    }, 'kick', 'data')
    .addInport('start', 'kick', 'in')
    .addOutport('result', 'repeat', 'out');
  // Start the wrapper
  const t = new Tester(graph);
  before(() => t.start());
  it('should use the graph directly', () => {
    chai.expect(t.network.graph).to.equal(graph);
  });
  it('should sent the expected result', () => {
    t.send('start', true);
    return t.receive('result')
      .then((output) => {
        chai.expect(output).to.be.an('object');
      });
  });
});
