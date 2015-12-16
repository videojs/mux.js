'use strict';

module.exports = {
  mp4: {
    Transmuxer: require('./mp4/transmuxer.js'),
    tools: require('./tools/mp4-inspector.js')
  },
  flv: {
    Transmuxer: require('./flv/transmuxer.js'),
    tools: require('./tools/flv-inspector.js')
  }
};
