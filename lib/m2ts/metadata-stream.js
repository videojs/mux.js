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
  typedArrayIndexOf = require('../utils/typed-array').typedArrayIndexOf,
  // Frames that allow different types of text encoding contain a text
  // encoding description byte [ID3v2.4.0 section 4.]
  textEncodingDescriptionByte = {
    Iso88591: 0x00, // ISO-8859-1, terminated with \0.
    Utf16:    0x01, // UTF-16 encoded Unicode BOM, terminated with \0\0
    Utf16be:  0x02, // UTF-16BE encoded Unicode, without BOM, terminated with \0\0
    Utf8:     0x03  // UTF-8 encoded Unicode, terminated with \0
  },
  // return a percent-encoded representation of the specified byte range
  // @see http://en.wikipedia.org/wiki/Percent-encoding
  percentEncode = function(bytes, start, end) {
    var i, result = '';
    for (i = start; i < end; i++) {
      result += '%' + ('00' + bytes[i].toString(16)).slice(-2);
    }
    return result;
  },
  // return the string representation of the specified byte range,
  // interpreted as UTf-8.
  parseUtf8 = function(bytes, start, end) {
    return decodeURIComponent(percentEncode(bytes, start, end));
  },
  // return the string representation of the specified byte range,
  // interpreted as ISO-8859-1.
  parseIso88591 = function(bytes, start, end) {
    return unescape(percentEncode(bytes, start, end)); // jshint ignore:line
  },
  parseSyncSafeInteger = function(data) {
    return (data[0] << 21) |
            (data[1] << 14) |
            (data[2] << 7) |
            (data[3]);
  },
  frameParsers = {
    'APIC': function(frame) {
      var
        i = 1,
        mimeTypeEndIndex,
        descriptionEndIndex,
        LINK_MIME_TYPE = '-->';

      if (frame.data[0] !== textEncodingDescriptionByte.Utf8) {
        // ignore frames with unrecognized character encodings
        return;
      }

      // parsing fields [ID3v2.4.0 section 4.14.]
      mimeTypeEndIndex = typedArrayIndexOf(frame.data, 0, i);
      if (mimeTypeEndIndex < 0) {
        // malformed frame
        return;
      }
      
      // parsing Mime type field (terminated with \0)
      frame.mimeType = parseIso88591(frame.data, i, mimeTypeEndIndex);
      i = mimeTypeEndIndex + 1;

      // parsing 1-byte Picture Type field
      frame.pictureType = frame.data[i];
      i++

      descriptionEndIndex = typedArrayIndexOf(frame.data, 0, i);
      if (descriptionEndIndex < 0) {
        // malformed frame
        return;
      }

      // parsing Description field (terminated with \0)
      frame.description = parseUtf8(frame.data, i, descriptionEndIndex);
      i = descriptionEndIndex + 1;

      if (frame.mimeType === LINK_MIME_TYPE) {
        // parsing Picture Data field as URL (always represented as ISO-8859-1 [ID3v2.4.0 section 4.])
        frame.url = parseIso88591(frame.data, i, frame.data.length)
      } else {
        // parsing Picture Data field as binary data
        frame.pictureData = frame.data.subarray(i, frame.data.length);
      }
    },
    'T*': function(frame) {
      if (frame.data[0] !== textEncodingDescriptionByte.Utf8) {
        // ignore frames with unrecognized character encodings
        return;
      }
      
      // parse text field, do not include null terminator in the frame value
      // frames that allow different types of encoding contain terminated text [ID3v2.4.0 section 4.]
      frame.value = parseUtf8(frame.data, 1, frame.data.length).replace(/\0*$/, '');
      // text information frames supports multiple strings, stored as a terminator separated list [ID3v2.4.0 section 4.2.]
      frame.values = frame.value.split('\0');
    },
    'TXXX': function(frame) {
      var descriptionEndIndex;

      if (frame.data[0] !== textEncodingDescriptionByte.Utf8) {
        // ignore frames with unrecognized character encodings
        return;
      }

      descriptionEndIndex = typedArrayIndexOf(frame.data, 0, 1);

      if (descriptionEndIndex === -1) {
        return;
      }

      // parse the text fields
      frame.description = parseUtf8(frame.data, 1, descriptionEndIndex);
      // do not include the null terminator in the tag value
      // frames that allow different types of encoding contain terminated text
      // [ID3v2.4.0 section 4.]
      frame.value = parseUtf8(
        frame.data,
        descriptionEndIndex + 1,
        frame.data.length
      ).replace(/\0*$/, '');
      frame.data = frame.value;
    },
    'W*': function(frame) {
      // parse URL field; URL fields are always represented as ISO-8859-1 [ID3v2.4.0 section 4.]
      // if the value is followed by a string termination all the following information should be ignored [ID3v2.4.0 section 4.3]
      frame.url = parseIso88591(frame.data, 0, frame.data.length).replace(/\0.*$/, '');
    },
    'WXXX': function(frame) {
      var descriptionEndIndex;

      if (frame.data[0] !== textEncodingDescriptionByte.Utf8) {
        // ignore frames with unrecognized character encodings
        return;
      }

      descriptionEndIndex = typedArrayIndexOf(frame.data, 0, 1);

      if (descriptionEndIndex === -1) {
        return;
      }

      // parse the description and URL fields
      frame.description = parseUtf8(frame.data, 1, descriptionEndIndex);
      // URL fields are always represented as ISO-8859-1 [ID3v2.4.0 section 4.]
      // if the value is followed by a string termination all the following information
      // should be ignored [ID3v2.4.0 section 4.3]
      frame.url = parseIso88591(
        frame.data,
        descriptionEndIndex + 1,
        frame.data.length
      ).replace(/\0.*$/, '');
    },
    'PRIV': function(frame) {
      var i;

      for (i = 0; i < frame.data.length; i++) {
        if (frame.data[i] === 0) {
          // parse the description and URL fields
          frame.owner = parseIso88591(frame.data, 0, i);
          break;
        }
      }
      frame.privateData = frame.data.subarray(i + 1);
      frame.data = frame.privateData;
    }
  },
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
      tagSize = parseSyncSafeInteger(chunk.data.subarray(6, 10));

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
      frameStart += parseSyncSafeInteger(tag.data.subarray(10, 14));

      // clip any padding off the end
      tagSize -= parseSyncSafeInteger(tag.data.subarray(16, 20));
    }

    // parse one or more ID3 frames
    // http://id3.org/id3v2.3.0#ID3v2_frame_overview
    do {
      // determine the number of bytes in this frame
      frameSize = parseSyncSafeInteger(tag.data.subarray(frameStart + 4, frameStart + 8));
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
      if (frameParsers[frame.id]) {
        // use frame specific parser
        frameParsers[frame.id](frame);
      } else if (frame.id[0] === 'T') {
        // use text frame generic parser
        frameParsers['T*'](frame);
      } else if (frame.id[0] === 'W') {
        // use URL link frame generic parser
        frameParsers['W*'](frame);
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
