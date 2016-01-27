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

// Constants
var AacStream;

/**
 * Splits an incoming stream of binary data into ADTS and ID3 Frames.
 */

AacStream = function() {
  var
    everything,
    receivedTimeStamp = false,
    timeStamp = 0;

  AacStream.prototype.init.call(this);

  this.setTimestamp = function (timestamp) {
    timeStamp = timestamp;
  };

  this.parseId3TagSize = function(header) {
    var returnSize = (header[6] << 21) | (header[7] << 14) |
              (header[8] << 7) | (header[9]),
      flags = header[5],
      footerPresent = (flags & 16) >> 4;
    if (footerPresent) {
            return returnSize + 20;
    }
    return returnSize + 10;
  };

  this.parseAdtsSize = function(header) {
    var lowThree = (header[5] & 0xE0) >> 5,
      middle = header[4] << 3,
      highTwo = header[3] & 0x3 << 11;
      return (highTwo | middle) | lowThree;
  };

  this.push = function(bytes) {
    var frameSize = 0,
    chunk,
    packet,
    tempLength;

    // If there are bytes remaining from the last segment, prepend them to the
    // bytes that were pushed in
    if (everything !== undefined && everything.length) {
      tempLength = everything.length;
      everything = new Uint8Array(bytes.byteLength + tempLength);
      everything.set(everything.subarray(0, tempLength));
      everything.set(bytes, tempLength);
    } else {
      everything = bytes;
    }

    while (everything.length >= 10) {
      if ((everything[0] === 'I'.charCodeAt(0)) &&
        (everything[1] === 'D'.charCodeAt(0)) &&
        (everything[2] === '3'.charCodeAt(0))) {

        //check framesize
        frameSize = this.parseId3TagSize(everything);
        //we have enough in the buffer to emit a full packet
        if (frameSize > everything.length) {
          break;
        }
        chunk = {
          type: 'timed-metadata',
          data: everything.subarray(0, frameSize)
        };
        this.trigger('data', chunk);
        everything = everything.subarray(frameSize);
      } else if ((everything[0] & 0xff === 0xff) &&
          ((everything[1] & 0xf0) === 0xf0)) {

        frameSize = this.parseAdtsSize(everything);

        if (frameSize > everything.length) {
          break;
        }
        packet = {
          type: 'audio',
          data: everything.subarray(0, frameSize),
          pts: timeStamp,
          dts: timeStamp,
        };
        this.trigger('data', packet);
        everything = everything.subarray(frameSize);
      }
    everything = everything.subarray(0, everything.length);
    }
  };
};

AacStream.prototype = new Stream();



module.exports = AacStream;
