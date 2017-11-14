var coffeeScript = require('coffeescript');
if (typeof coffeeScript.register !== 'undefined') {
  coffeeScript.register();
}
module.exports = require('./lib/tester.coffee');
