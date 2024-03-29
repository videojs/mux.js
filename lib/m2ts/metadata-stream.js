/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
 *
 * Accepts program elementary stream (PES) data events and parses out
 * ID3 metadata from them, if present.
 * @see http://id3.org/id3v2.3.0
 */
'use strict';
var
  Stream = require('../utils/stream'),
  StreamTypes = require('./stream-types'),
  id3 = require('../tools/parse-id3'),
  MetadataStream;

MetadataStream = function(options) {
  var
    settings = {
      // the bytes of the program-level descriptor field in MP2T
      // see ISO/IEC 13818-1:2013 (E), section 2.6 "Program and
      // program element descriptors"
      descriptor: options && options.descriptor
    },
    // the total size in bytes of the ID3 tag being parsed
    tagSize = 0,
    // tag data that is not complete enough to be parsed
    buffer = [],
    // the total number of bytes currently in the buffer
    bufferSize = 0,
    i;

  MetadataStream.prototype.init.call(this);

  // calculate the text track in-band metadata track dispatch type
  // https://html.spec.whatwg.org/multipage/embedded-content.html#steps-to-expose-a-media-resource-specific-text-track
  this.dispatchType = StreamTypes.METADATA_STREAM_TYPE.toString(16);
  if (settings.descriptor) {
    for (i = 0; i < settings.descriptor.length; i++) {
      this.dispatchType += ('00' + settings.descriptor[i].toString(16)).slice(-2);
    }
  }

  this.push = function(chunk) {
    var tag, frameStart, frameSize, frame, i, frameHeader;
    if (chunk.type !== 'timed-metadata') {
      return;
    }

    // if data_alignment_indicator is set in the PES header,
    // we must have the start of a new ID3 tag. Assume anything
    // remaining in the buffer was malformed and throw it out
    if (chunk.dataAlignmentIndicator) {
      bufferSize = 0;
      buffer.length = 0;
    }

    // ignore events that don't look like ID3 data
    if (buffer.length === 0 &&
        (chunk.data.length < 10 ||
          chunk.data[0] !== 'I'.charCodeAt(0) ||
          chunk.data[1] !== 'D'.charCodeAt(0) ||
          chunk.data[2] !== '3'.charCodeAt(0))) {
      this.trigger('log', {
        level: 'warn',
        message: 'Skipping unrecognized metadata packet'
      });
      return;
    }

    // add this chunk to the data we've collected so far

    buffer.push(chunk);
    bufferSize += chunk.data.byteLength;

    // grab the size of the entire frame from the ID3 header
    if (buffer.length === 1) {
      // the frame size is transmitted as a 28-bit integer in the
      // last four bytes of the ID3 header.
      // The most significant bit of each byte is dropped and the
      // results concatenated to recover the actual value.
      tagSize = id3.parseSyncSafeInteger(chunk.data.subarray(6, 10));

      // ID3 reports the tag size excluding the header but it's more
      // convenient for our comparisons to include it
      tagSize += 10;
    }

    // if the entire frame has not arrived, wait for more data
    if (bufferSize < tagSize) {
      return;
    }

    // collect the entire frame so it can be parsed
    tag = {
      data: new Uint8Array(tagSize),
      frames: [],
      pts: buffer[0].pts,
      dts: buffer[0].dts
    };
    for (i = 0; i < tagSize;) {
      tag.data.set(buffer[0].data.subarray(0, tagSize - i), i);
      i += buffer[0].data.byteLength;
      bufferSize -= buffer[0].data.byteLength;
      buffer.shift();
    }

    // find the start of the first frame and the end of the tag
    frameStart = 10;
    if (tag.data[5] & 0x40) {
      // advance the frame start past the extended header
      frameStart += 4; // header size field
      frameStart += id3.parseSyncSafeInteger(tag.data.subarray(10, 14));

      // clip any padding off the end
      tagSize -= id3.parseSyncSafeInteger(tag.data.subarray(16, 20));
    }

    // parse one or more ID3 frames
    // http://id3.org/id3v2.3.0#ID3v2_frame_overview
    do {
      // determine the number of bytes in this frame
      frameSize = id3.parseSyncSafeInteger(tag.data.subarray(frameStart + 4, frameStart + 8));
      if (frameSize < 1) {
        this.trigger('log', {
          level: 'warn',
          message: 'Malformed ID3 frame encountered. Skipping remaining metadata parsing.'
        });
        // If the frame is malformed, don't parse any further frames but allow previous valid parsed frames
        // to be sent along.
        break;
      }
      frameHeader = String.fromCharCode(tag.data[frameStart],
                                        tag.data[frameStart + 1],
                                        tag.data[frameStart + 2],
                                        tag.data[frameStart + 3]);


      frame = {
        id: frameHeader,
        data: tag.data.subarray(frameStart + 10, frameStart + frameSize + 10)
      };
      frame.key = frame.id;

      // parse frame values
      if (id3.frameParsers[frame.id]) {
        // use frame specific parser
        id3.frameParsers[frame.id](frame);
      } else if (frame.id[0] === 'T') {
        // use text frame generic parser
        id3.frameParsers['T*'](frame);
      } else if (frame.id[0] === 'W') {
        // use URL link frame generic parser
        id3.frameParsers['W*'](frame);
      }

      // handle the special PRIV frame used to indicate the start
      // time for raw AAC data
      if (frame.owner === 'com.apple.streaming.transportStreamTimestamp') {
        var
          d = frame.data,
          size = ((d[3] & 0x01)  << 30) |
                  (d[4]  << 22) |
                  (d[5] << 14) |
                  (d[6] << 6) |
                  (d[7] >>> 2);

        size *= 4;
        size += d[7] & 0x03;
        frame.timeStamp = size;
        // in raw AAC, all subsequent data will be timestamped based
        // on the value of this frame
        // we couldn't have known the appropriate pts and dts before
        // parsing this ID3 tag so set those values now
        if (tag.pts === undefined && tag.dts === undefined) {
          tag.pts = frame.timeStamp;
          tag.dts = frame.timeStamp;
        }
        this.trigger('timestamp', frame);
      }

      tag.frames.push(frame);

      frameStart += 10; // advance past the frame header
      frameStart += frameSize; // advance past the frame body
    } while (frameStart < tagSize);
    this.trigger('data', tag);
  };
};
MetadataStream.prototype = new Stream();

module.exports = MetadataStream;
