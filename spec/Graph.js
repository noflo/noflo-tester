const chai = require('chai');
const noflo = require('noflo');
const Tester = require('../lib/wrapper');

describe('Wrapping a Graph object', () => {
  // Create a noflo.Graph object (could also be loaded from JSON/FBP)
  const graph = new noflo.Graph('Test Graph');
  graph.addNode('kick', 'core/Kick');
  graph.addNode('repeat', 'core/RepeatAsync');
  graph.addEdge('kick', 'out', 'repeat', 'in');
  graph.addInitial({
    test: 42,
  }, 'kick', 'data');
  graph.addInport('start', 'kick', 'in');
  graph.addOutport('result', 'repeat', 'out');
  // Start the wrapper
  const t = new Tester(graph);
  before((done) => t.start(done));
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
