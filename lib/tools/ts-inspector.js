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
var probe = {};
probe.ts = require('../m2ts/probe.js');
probe.aac = require('../aac/probe.js');


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

  this.inspect = function(bytes) {
    var isAacData = isLikelyAacData(bytes);

    if (isAacData) {
      return this.inspectAac_(bytes);
    } else {
      return this.inspectTs_(bytes);
    }
  };

  this.inspectAac_ = function(bytes) {
    var result = {
      audio: []
    };

    var
      endLoop = false,
      audioCount = 0,
      sampleRate = null,
      timestamp = null,
      frameSize = 0,
      byteIndex = 0;

    while(bytes.length - byteIndex >= 3) {
      var type = probe.aac.parseType(bytes, byteIndex);
      switch (type) {
        case 'timed-metadata':
          // Exit early because we don't have enough to parse
          // the ID3 tag header
          if (bytes.length - byteIndex < 10) {
            endLoop = true;
            break;
          }

          frameSize = probe.aac.parseId3TagSize(bytes, byteIndex);

          // Exit early if we don't have enough in the buffer
          // to emit a full packet
          if (frameSize > bytes.length) {
            endLoop = true;
            break;
          }
          if (timestamp === null) {
            var packet = bytes.subarray(byteIndex, byteIndex + frameSize);
            timestamp = probe.aac.parseAacTimestamp(packet);
          }
          byteIndex += frameSize;
          break;
        case 'audio':
          // Exit early because we don't have enough to parse
          // the ADTS frame header
          if (bytes.length - byteIndex < 7) {
            endLoop = true;
            break;
          }

          frameSize = probe.aac.parseAdtsSize(bytes, byteIndex);

          // Exit early if we don't have enough in the buffer
          // to emit a full packet
          if (frameSize > bytes.length) {
            endLoop = true;
            break;
          }
          if (sampleRate === null) {
            var packet = bytes.subarray(byteIndex, byteIndex + frameSize);
            sampleRate = probe.aac.parseSampleRate(packet);
          }
          audioCount++;
          byteIndex += frameSize;
          break;
        default:
          byteIndex++;
          break;
      }
      if (endLoop) {
        return null;
      }
    }
    if (sampleRate === null || timestamp === null) {
      return null;
    }

    var audioTimescale = PES_TIMESCALE / sampleRate;

    result.audio.push(
      {
        type: 'audio',
        dts: timestamp,
        pts: timestamp
      },
      {
        type: 'audio',
        dts: timestamp + (audioCount * 1024 * audioTimescale),
        pts: timestamp + (audioCount * 1024 * audioTimescale)
      }
    );

    //this.adjustTimestamp_(result);

    return result;
  };

  this.inspectTs_ = function(bytes) {
    var pmt = {
      pid: null,
      table: null
    };

    var result = {};

    this.parsePsi_(bytes, pmt);

    for (var pid in pmt.table) {
      if (pmt.table.hasOwnProperty(pid)) {
        var type = pmt.table[pid];
        switch (type) {
          case m2ts.H264_STREAM_TYPE:
            result.video = [];
            this.parseVideoPes_(bytes, pmt, result);
            break;
          case m2ts.ADTS_STREAM_TYPE:
            result.audio = [];
            this.parseAudioPes_(bytes, pmt, result);
            break;
          default:
            break;
        }
      }
    }

    this.adjustTimestamp_(result);

    return result;
  }

  this.parsePsi_ = function(bytes, pmt) {
    var
      startIndex = 0,
      endIndex = MP2T_PACKET_LENGTH;

    while (endIndex < bytes.byteLength) {
      // Look for a pair of start and end sync bytes in the data..
      if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
        // We found a packet
        var packet = bytes.subarray(startIndex, endIndex);

        var type = probe.ts.parseType(packet, pmt.pid);
        switch(type) {
          case 'pat':
            if (!pmt.pid) {
              pmt.pid = probe.ts.parsePat(packet);
            }
            break;
          case 'pmt':
            if (!pmt.table) {
              pmt.table = probe.ts.parsePmt(packet);
            }
            break;
          default:
            break;
        }

        // Found the pat and pmt, we can stop walking the segment
        if (pmt.pid && pmt.table) {
          return;
        }

        startIndex += MP2T_PACKET_LENGTH;
        endIndex += MP2T_PACKET_LENGTH;
        continue;
      }

      // If we get here, we have somehow become de-synchronized and we need to step
      // forward one byte at a time until we find a pair of sync bytes that denote
      // a packet
      startIndex++;
      endIndex++;
    }
  };

  this.parseAudioPes_ = function(bytes, pmt, result) {
    var
      startIndex = 0,
      endIndex = MP2T_PACKET_LENGTH;

    var endLoop = false;

    // Start walking from start of segment to get first audio packet
    while (endIndex < bytes.byteLength) {
      // Look for a pair of start and end sync bytes in the data..
      if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
        // We found a packet
        var packet = bytes.subarray(startIndex, endIndex);

        var type = probe.ts.parseType(packet, pmt.pid);
        switch(type) {
          case 'pes':
            var pesType = probe.ts.parsePesType(packet, pmt.table);
            var pusi = probe.ts.parsePayloadUnitStartIndicator(packet);
            if (pesType === 'audio' && pusi) {
              var parsed = probe.ts.parsePesTime(packet);
              parsed.type = 'audio';
              result.audio.push(parsed);
              endLoop = true;
            }
            break;
          default:
            break;
        }

        if (endLoop) {
          break;
        }

        startIndex += MP2T_PACKET_LENGTH;
        endIndex += MP2T_PACKET_LENGTH;
        continue;
      }

      // If we get here, we have somehow become de-synchronized and we need to step
      // forward one byte at a time until we find a pair of sync bytes that denote
      // a packet
      startIndex++;
      endIndex++;
    }

    // Start walking from end of segment to get last audio packet
    endIndex = bytes.byteLength;
    startIndex = endIndex - MP2T_PACKET_LENGTH;
    endLoop = false;
    while (startIndex >= 0) {
      // Look for a pair of start and end sync bytes in the data..
      if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
        // We found a packet
        var packet = bytes.subarray(startIndex, endIndex);

        var type = probe.ts.parseType(packet, pmt.pid);
        switch(type) {
          case 'pes':
            var pesType = probe.ts.parsePesType(packet, pmt.table);
            var pusi = probe.ts.parsePayloadUnitStartIndicator(packet);
            if (pesType === 'audio' && pusi) {
              var parsed = probe.ts.parsePesTime(packet);
              parsed.type = 'audio';
              result.audio.push(parsed);
              endLoop = true;
            }
            break;
          default:
            break;
        }

        if (endLoop) {
          break;
        }

        startIndex -= MP2T_PACKET_LENGTH;
        endIndex -= MP2T_PACKET_LENGTH;
        continue;
      }

      // If we get here, we have somehow become de-synchronized and we need to step
      // forward one byte at a time until we find a pair of sync bytes that denote
      // a packet
      startIndex--;
      endIndex--;
    }
  };

  this.parseVideoPes_ = function(bytes, pmt, result) {
    var
      startIndex = 0,
      endIndex = MP2T_PACKET_LENGTH;

    var endLoop = false;

    var currentFrame = {
      data: [],
      size: 0
    };

    // Start walking from start of segment to get first video packet
    while (endIndex < bytes.byteLength) {
      // Look for a pair of start and end sync bytes in the data..
      if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
        // We found a packet
        var packet = bytes.subarray(startIndex, endIndex);

        var type = probe.ts.parseType(packet, pmt.pid);
        switch(type) {
          case 'pes':
            var pesType = probe.ts.parsePesType(packet, pmt.table);
            var pusi = probe.ts.parsePayloadUnitStartIndicator(packet);
            if (pesType === 'video') {
              if (pusi && !endLoop) {
                var parsed = probe.ts.parsePesTime(packet);
                parsed.type = 'video';
                result.video.push(parsed);
                endLoop = true;
              }
              if (!result.firstIFrame) {
                if (pusi) {
                  if (currentFrame.size !== 0) {
                    var frame = new Uint8Array(currentFrame.size);
                    var i = 0;
                    while(currentFrame.data.length) {
                      var pes = currentFrame.data.shift();
                      frame.set(pes, i);
                      i += pes.byteLength;
                    }
                    if (probe.ts.videoPacketContainsIframe(frame)) {
                      result.firstIFrame = probe.ts.parsePesTime(frame);
                      result.firstIFrame.type = 'video';
                    }
                    currentFrame.size = 0;
                  }
                }
                currentFrame.data.push(packet);
                currentFrame.size += packet.byteLength;
              }
            }
            break;
          default:
            break;
        }

        if (endLoop && result.firstIFrame) {
          break;
        }

        startIndex += MP2T_PACKET_LENGTH;
        endIndex += MP2T_PACKET_LENGTH;
        continue;
      }

      // If we get here, we have somehow become de-synchronized and we need to step
      // forward one byte at a time until we find a pair of sync bytes that denote
      // a packet
      startIndex++;
      endIndex++;
    }

    // Start walking from end of segment to get last video packet
    endIndex = bytes.byteLength;
    startIndex = endIndex - MP2T_PACKET_LENGTH;
    endLoop = false;
    while (startIndex >= 0) {
      // Look for a pair of start and end sync bytes in the data..
      if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
        // We found a packet
        var packet = bytes.subarray(startIndex, endIndex);

        var type = probe.ts.parseType(packet, pmt.pid);
        switch(type) {
          case 'pes':
            var pesType = probe.ts.parsePesType(packet, pmt.table);
            var pusi = probe.ts.parsePayloadUnitStartIndicator(packet);
            if (pesType === 'video' && pusi) {
                var parsed = probe.ts.parsePesTime(packet);
                parsed.type = 'video';
                result.video.push(parsed);
              endLoop = true;
            }
            break;
          default:
            break;
        }

        if (endLoop) {
          break;
        }

        startIndex -= MP2T_PACKET_LENGTH;
        endIndex -= MP2T_PACKET_LENGTH;
        continue;
      }

      // If we get here, we have somehow become de-synchronized and we need to step
      // forward one byte at a time until we find a pair of sync bytes that denote
      // a packet
      startIndex--;
      endIndex--;
    }
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
    if (segmentInfo.audio && segmentInfo.audio.length === 2) {
      audioTimestampRolloverStream.push(segmentInfo.audio[i]);
      i = 1;
      audioTimestampRolloverStream.push(segmentInfo.audio[i]);
      audioTimestampRolloverStream.flush();
    }

    i = 0;
    if (segmentInfo.video && segmentInfo.video.length === 2) {
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
