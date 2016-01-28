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
'use strict';
var Stream = require('../utils/stream.js');

// object types
var AacStream;

var

/**
 * Splits an incoming stream of binary data into ADTS and ID3 Frames.
 */

 AacStream = function() {
  var
    everything,
    frameSize = 0,
    receivedTimeStamp = false,
    timeStamp = 0;

  AacStream.prototype.init.call(this);

  this.setTimestamp = function (frame) {
    var d = frame.data;
    var size = ((d[3] & 0x01)  << 30) | (d[4]  << 22) | (d[5] << 14) | (d[6] << 6) | d[7] >>> 2;
    size *= 4;
    size += d[7] & 0x03;
    timeStamp = size;
  };


  this.push = function(bytes) {
    var canParseMore = true;

    // If there are bytes remaining from the last segment, prepend them to the
    // bytes that were pushed in
    if (everything !== undefined && everything.length) {
      var tempLength = everything.length;
      everything = new Uint8Array(bytes.byteLength + tempLength);
      everything.set(everything.subarray(0, tempLength));
      everything.set(bytes, tempLength);
    } else {
      everything = bytes;
    }

    while(canParseMore) {
      if (everything.length >= 10) {
        if ((everything[0] === 'I'.charCodeAt(0)) &&
          (everything[1] === 'D'.charCodeAt(0)) &&
          (everything[2] === '3'.charCodeAt(0))) {

          //check framesize
          frameSize = (everything[6] << 21) | (everything[7] << 14) |
              (everything[8] << 7) | (everything[9]);
          var flags = everything[5];
          var footerpresent = (flags & 16) >> 4;
          if (footerpresent) {
            frameSize = frameSize + 20;
          } else {
            frameSize = frameSize + 10;
          }

          //we have enough in the buffer to emit a full packet
          if(everything.length >= frameSize) {
            var chunk = {
              type: 'timed-metadata',
              data: everything.subarray(0, frameSize)
            };
            this.trigger('data', chunk);
            everything = everything.subarray(frameSize);
            continue;
          } else {
            canParseMore = false;
          }
        } else if ((everything[0] & 0xff == 0xff) &&
            (((everything[1] >> 4) & 0xf) == 0xf)) {

          var lowThree = (everything[5] & 0xE0) >> 5;
          var middle = everything[4] << 3;
          var highTwo = everything[3] & 0x3 << 11;
          frameSize = (highTwo | middle) | lowThree;

          if(everything.length >= frameSize) {
            var packet = {
              type: 'audio',
              data: everything.subarray(0, frameSize),
              pts: timeStamp,
              dts: timeStamp,
            };
            this.trigger('data', packet);
            everything = everything.subarray(frameSize);
            continue;
          } else {
            canParseMore = false;
          }
        }
      } else {
        canParseMore = false;
      }
    }
  };
  this.flush = function () {
    this.trigger('done');
  };
};

AacStream.prototype = new Stream();

var AACStream = {
  AacStream: AacStream,
  MetadataStream: require('./metadata-stream'),
};

module.exports = AACStream;
