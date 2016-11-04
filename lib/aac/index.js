/**
 * mux.js
 *
 * Copyright (c) 2016 Brightcove
 * All rights reserved.
 *
 * A stream-based aac to mp4 converter. This utility can be used to
 * deliver mp4s to a SourceBuffer on platforms that support native
 * Media Source Extensions.
 */

module.exports = {
  AacStream: require('./aac'),
  Transmuxer: require('./transmuxer').Transmuxer
};
