'use strict';

var muxjs = {
  codecs: require('./codecs'),
  mp4: require('./mp4'),
  flv: require('./flv'),
  mp2t: require('./m2ts'),
};
module.exports = muxjs;
