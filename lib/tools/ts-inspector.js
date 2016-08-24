/**
 * mux.js
 *
 * Copyright (c) 2016 Brightcove
 * All rights reserved.
 *
 * Parse mpeg2 transport stream packets to extract basic timing information
 */
'use strict';

var m2ts = require('../m2ts');
// var AacStream = require('../aac');
// var AdtsStream = require('../codecs/adts.js');
var probe = require('../m2ts/probe.js');

var
  PES_TIMESCALE = 90000,
  MP2T_PACKET_LENGTH = 188, // bytes
  SYNC_BYTE = 0x47;

var isLikelyAacData = function(data) {
  if ((data[0] === 'I'.charCodeAt(0)) &&
      (data[1] === 'D'.charCodeAt(0)) &&
      (data[2] === '3'.charCodeAt(0))) {
    return true;
  }
  return false;
};

var SegmentInspector = function() {

  var audioTimestampRolloverStream = new m2ts.TimestampRolloverStream('audio');
  var videoTimestampRolloverStream = new m2ts.TimestampRolloverStream('video');
  var frameTimestampRolloverStream = new m2ts.TimestampRolloverStream('video');

  var videoPacketContainsIframe = function(packet) {
    var pusi = probe.parsePayloadUnitStartIndicator(packet);
    var offset = 4 + probe.parseAdaptionField(packet);
    var frameBuffer = packet.subarray(offset);
    var frameI = 0;
    var frameSyncPoint = 0;
    var foundIFrame = false;

    // advance the sync point to a NAL start, if necessary
    for (; frameSyncPoint < frameBuffer.byteLength - 3; frameSyncPoint++) {
      if (frameBuffer[frameSyncPoint + 2] === 1) {
        // the sync point is properly aligned
        frameI = frameSyncPoint + 5;
        break;
      }
    }

    while (frameI < frameBuffer.byteLength) {
      // look at the current byte to determine if we've hit the end of
      // a NAL unit boundary
      switch (frameBuffer[frameI]) {
      case 0:
        // skip past non-sync sequences
        if (frameBuffer[frameI - 1] !== 0) {
          frameI += 2;
          break;
        } else if (frameBuffer[frameI - 2] !== 0) {
          frameI++;
          break;
        }

        if (frameSyncPoint + 3 !== frameI - 2) {
          var nalType = parseNalUnitType(frameBuffer[frameSyncPoint + 3] & 0x1f);
          if (nalType === 'slice_layer_without_partitioning_rbsp_idr') {
            foundIFrame = true;
          }
        }

        // drop trailing zeroes
        do {
          frameI++;
        } while (frameBuffer[frameI] !== 1 && frameI < frameBuffer.length);
        frameSyncPoint = frameI - 2;
        frameI += 3;
        break;
      case 1:
        // skip past non-sync sequences
        if (frameBuffer[frameI - 1] !== 0 ||
            frameBuffer[frameI - 2] !== 0) {
          frameI += 3;
          break;
        }

        var nalType = parseNalUnitType(frameBuffer[frameSyncPoint + 3] & 0x1f);
        if (nalType === 'slice_layer_without_partitioning_rbsp_idr') {
          foundIFrame = true;
        }
        frameSyncPoint = frameI - 2;
        frameI += 3;
        break;
      default:
        // the current byte isn't a one or zero, so it cannot be part
        // of a sync sequence
        frameI += 3;
        break;
      }
    }
    frameBuffer = frameBuffer.subarray(frameSyncPoint);
    frameI -= frameSyncPoint;
    frameSyncPoint = 0;
    // parse the final nal
    if (frameBuffer && frameBuffer.byteLength > 3) {
      var nalType = parseNalUnitType(frameBuffer[frameSyncPoint + 3] & 0x1f);
      if (nalType === 'slice_layer_without_partitioning_rbsp_idr') {
        foundIFrame = true;
      }
    }

    return foundIFrame;
  };

  var parseNalUnitType = function(type) {
    switch (type) {
      case 0x05:
        return 'slice_layer_without_partitioning_rbsp_idr';
      case 0x06:
        return 'sei_rbsp';
      case 0x07:
        return 'seq_parameter_set_rbsp';
      case 0x08:
        return 'pic_parameter_set_rbsp';
      case 0x09:
        return 'access_unit_delimiter_rbsp';
      default:
        return null;
    }
  };

  this.inspect = function(bytes) {
    var pmtPid = null;
    var waitingPmt = [];
    var programMapTable = null;

    var currentFrame = {
      data: [],
      size: 0
    };
    var result = {
      audio: [],
      video: [],
    };

    var startIndex = 0,
        endIndex = MP2T_PACKET_LENGTH,
        last = false;

    var handlePes = function(packet) {
      var type = probe.parsePesType(packet, programMapTable);
      if (type !== 'video' && type !== 'audio') {
        return;
      }

      var pusi = probe.parsePayloadUnitStartIndicator(packet);

      if (pusi) {
        if ((!last && !result[type].length) || (last && result[type].length === 1)) {
          var info = probe.parsePesTime(packet);
          info.type = type;
          result[type].push(info);
        }
      }

      if (type === 'video' && !result.firstIFrame) {
        if (pusi) {
          if (currentFrame.size !== 0) {
            var frame = new Uint8Array(currentFrame.size);
            var i = 0;
            while(currentFrame.data.length) {
              var pes = currentFrame.data.shift();
              frame.set(pes, i);
              i += pes.byteLength;
            }
            if (videoPacketContainsIframe(frame)) {
              result.firstIFrame = probe.parsePesTime(frame);
              result.firstIFrame.type = 'video';
            }
            currentFrame.size = 0;
          }
        }
        currentFrame.data.push(packet);
        currentFrame.size += packet.byteLength;
      }
    };

    while ((!last && endIndex < bytes.byteLength) || (last && startIndex > 0)) {
      if (last &&
          result.audio.length === 2 &&
          result.video.length === 2) {
        break;
      }
      if (!last &&
          result.audio.length === 1 &&
          result.video.length === 1 &&
          result.firstIFrame) {
        endIndex = bytes.byteLength;
        startIndex = endIndex - MP2T_PACKET_LENGTH;
        last = true;
      }
      // Look for a pair of start and end sync bytes in the data..
      if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
        // We found a packet
        var packet = bytes.subarray(startIndex, endIndex);

        var type = probe.parseType(packet, pmtPid);
        switch(type) {
          case 'pat':
            if (!pmtPid) {
              pmtPid = probe.parsePat(packet);
            }
            break;
          case 'pmt':
            if (!programMapTable) {
              programMapTable = probe.parsePmt(packet);
              waitingPmt.forEach(function(pes) {
                handlePes(pes);
              });
            }
            break;
          case 'pes':
            handlePes(packet);
            break;
          default:
            waitingPmt.push(packet);
        }
        if (last) {
          startIndex -= MP2T_PACKET_LENGTH;
          endIndex -= MP2T_PACKET_LENGTH;
        } else {
          startIndex += MP2T_PACKET_LENGTH;
          endIndex += MP2T_PACKET_LENGTH;
        }
        continue;
      }

      // If we get here, we have somehow become de-synchronized and we need to step
      // forward one byte at a time until we find a pair of sync bytes that denote
      // a packet
      if (last) {
        startIndex--;
        endIndex--;
      } else {
        startIndex++;
        endIndex++;
      }
    }

    //this.adjustTimestamp_(result);

    return result;
  };

  /**
   * Adjusts the timestamp information for the segment to account for
   * rollover and convert to seconds based on pes packet timescale (90khz clock)
   */
  this.adjustTimestamp_ = function(segmentInfo) {
    audioTimestampRolloverStream.on('data', function(data) {
      segmentInfo.audio[i].pts = data.pts / PES_TIMESCALE;
      segmentInfo.audio[i].dts = data.dts / PES_TIMESCALE;
    });

    videoTimestampRolloverStream.on('data', function(data) {
      segmentInfo.video[i].pts = data.pts / PES_TIMESCALE;
      segmentInfo.video[i].dts = data.dts / PES_TIMESCALE;
    });

    frameTimestampRolloverStream.on('data', function(data) {
      segmentInfo.firstIFrame.pts = data.pts / PES_TIMESCALE;
      segmentInfo.firstIFrame.dts = data.dts / PES_TIMESCALE;
    });

    var i = 0;
    if (segmentInfo.audio && segmentInfo.audio.length) {
      audioTimestampRolloverStream.push(segmentInfo.audio[i]);
      i = 1;
      audioTimestampRolloverStream.push(segmentInfo.audio[i]);
      audioTimestampRolloverStream.flush();
    }

    i = 0;
    if (segmentInfo.video && segmentInfo.video.length) {
      videoTimestampRolloverStream.push(segmentInfo.video[i]);
      i = 1;
      videoTimestampRolloverStream.push(segmentInfo.video[i]);
      videoTimestampRolloverStream.flush();
    }

    if (segmentInfo.firstIFrame) {
      frameTimestampRolloverStream.push(segmentInfo.firstIFrame);
      frameTimestampRolloverStream.flush();
    }

    audioTimestampRolloverStream.dispose();
    videoTimestampRolloverStream.dispose();
    frameTimestampRolloverStream.dispose();
  };
};

module.exports = {
  SegmentInspector: SegmentInspector
};
