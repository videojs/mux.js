'use strict';

var Stream = require('../utils/stream.js');
var parsers = require('./parsers/adts.js');

var AdtsStream;

/*
 * Accepts a ElementaryStream and emits data events with parsed
 * AAC Audio Frames of the individual packets. Input audio in ADTS
 * format is unpacked and re-emitted as AAC frames.
 *
 * @see http://wiki.multimedia.cx/index.php?title=ADTS
 * @see http://wiki.multimedia.cx/?title=Understanding_AAC
 */
AdtsStream = function() {
  var buffer;

  AdtsStream.prototype.init.call(this);

  this.push = function(packet) {
    var
      i = 0,
      frameNum = 0,
      oldBuffer;

    if (packet.type !== 'audio') {
      // ignore non-audio data
      return;
    }

    // Prepend any data in the buffer to the input data so that we can parse
    // aac frames the cross a PES packet boundary
    if (buffer) {
      oldBuffer = buffer;
      buffer = new Uint8Array(oldBuffer.byteLength + packet.data.byteLength);
      buffer.set(oldBuffer);
      buffer.set(packet.data, oldBuffer.byteLength);
    } else {
      buffer = packet.data;
    }

    // unpack any ADTS frames which have been fully received
    // for details on the ADTS header, see http://wiki.multimedia.cx/index.php?title=ADTS
    while (i + 5 < buffer.length) {

      // Loook for the start of an ADTS header..
      if (buffer[i] !== 0xFF || (buffer[i + 1] & 0xF6) !== 0xF0) {
        // If a valid header was not found,  jump one forward and attempt to
        // find a valid ADTS header starting at the next byte
        i++;
        continue;
      }

      var adtsHeader = parsers.parseAdtsHeader(buffer, i);

      // If we don't have enough data to actually finish this ADTS frame, return
      // and wait for more data
      if (buffer.byteLength < adtsHeader.frameEnd) {
        return;
      }

      // Otherwise, deliver the complete AAC frame
      this.trigger('data', {
        pts: packet.pts + (frameNum * adtsHeader.adtsFrameDuration),
        dts: packet.dts + (frameNum * adtsHeader.adtsFrameDuration),
        sampleCount: adtsHeader.sampleCount,
        audioobjecttype: adtsHeader.audioObjectType,
        channelcount: adtsHeader.channelCount,
        samplerate: adtsHeader.sampleRate,
        samplingfrequencyindex: adtsHeader.samplingFrequencyIndex,
        // assume ISO/IEC 14496-12 AudioSampleEntry default of 16
        samplesize: 16,
        data: buffer.subarray(i + 7 + adtsHeader.protectionSkipBytes, adtsHeader.frameEnd)
      });

      // If the buffer is empty, clear it and return
      if (buffer.byteLength === adtsHeader.frameEnd) {
        buffer = undefined;
        return;
      }

      frameNum++;

      // Remove the finished frame from the buffer and start the process again
      buffer = buffer.subarray(adtsHeader.frameEnd);
    }
  };
  this.flush = function() {
    this.trigger('done');
  };
};

AdtsStream.prototype = new Stream();

module.exports = AdtsStream;
