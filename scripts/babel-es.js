var babelConfig = require('./babel-cjs.js');

babelConfig.presets[0][1].modules = false;


module.exports = babelConfig;
