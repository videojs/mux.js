'use strict';

var muxjs = {
  codecs: require('./codecs'),
  mp4: require('./mp4'),
  flv: require('./flv'),
  mp2t: require('./m2ts')
};

// include all the tools when the full library is required
muxjs.mp4.tools = require('./tools/mp4-inspector');
muxjs.flv.tools = require('./tools/flv-inspector');


module.exports = muxjs;
