/*
 * index.js
 * Copyright (C) 2015 bcasey <bcasey@bcasey-retina.vidmark.local>
 *
 * Distributed under terms of the MIT license.
 */
module.exports = {
  generator: require('./mp4-generator'),
  Transmuxer: require('./transmuxer').Transmuxer,
  AudioSegmentStream: require('./transmuxer').AudioSegmentStream,
  VideoSegmentStream: require('./transmuxer').VideoSegmentStream,
  tools: require('../tools/mp4-inspector'),
};
