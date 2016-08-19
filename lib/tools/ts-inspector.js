/**
 * mux.js
 *
 * Copyright (c) 2016 Brightcove
 * All rights reserved.
 *
 * Parse mpeg2 transport stream packets to extract basic timing information
 */
'use strict';

var StreamTypes = require('../m2ts/stream-types');
var m2ts = require('../m2ts');

var PES_TIMESCALE = 90000;

var SegmentInspector = function() {
  var self = this;

  this.transportPacketStream = new m2ts.TransportPacketStream();
  this.transportParseStream = new m2ts.TransportParseStream();
  this.elementaryStream = new m2ts.ElementaryStream();
  this.audioTimestampRolloverStream = new m2ts.TimestampRolloverStream('audio');
  this.videoTimestampRolloverStream = new m2ts.TimestampRolloverStream('video');

  /**
   * Inspects the given segment byte array and returns an object with timing
   * information for the first and last packet.
   */
  this.inspect = function(segment) {
    var tsPackets = [];
    var segmentInfo;

    this.transportPacketStream
      .pipe(this.transportParseStream);

    this.transportParseStream.on('data', function(event) {
      tsPackets.push(event);
    });

    this.transportParseStream.on('done', () => {
      segmentInfo = this.parsePackets_(tsPackets);
    });

    this.transportPacketStream.push(segment);
    this.transportPacketStream.flush();

    this.adjustTimestamp_(segmentInfo);

    this.dispose();
    return segmentInfo;
  }

  /**
   * Parse the given pes packets to gain information from the first and last complete packet
   */
  this.parsePackets_ = function(packets) {
    var segmentInfo = {
      video: [],
      audio: []
    };

    var processData = true;
    var first = true;

    this.elementaryStream.on('data', function(data) {
      if (processData) {
        if (data.type === 'audio') {
          if ((first && segmentInfo.audio.length === 0) ||
              (!first && segmentInfo.audio.length === 1)) {
            segmentInfo.audio.push(data);
          }
        }
        if (data.type === 'video') {
          if ((first && segmentInfo.video.length === 0) ||
              (!first && segmentInfo.video.length === 1)) {
            segmentInfo.video.push(data);
          }
        }
        if (first &&
            segmentInfo.audio.length === 1 &&
            segmentInfo.video.length === 1) {
          processData = false;
        } else if (!first &&
                    segmentInfo.audio.length === 2 &&
                    segmentInfo.video.length === 2) {
          processData = false;
        }
      }
    });

    let i = 0;
    let packet;

    while(processData && i < packets.length) {
      packet = packets[i];
      this.elementaryStream.push(packet);
      i++;
    }

    this.elementaryStream.flush();

    processData = true;
    first = false;

    i = packets.length - 1;

    let lastPes = {
      audio: {
        done: false,
        data: []
      },
      video: {
        done: false,
        data: []
      }
    };

    // Walk back from the end to find the last video and audio pes packets
    while(i > -1) {
      packet = packets[i];
      let streamType;

      switch (packet.streamType) {
        case StreamTypes.H264_STREAM_TYPE:
          streamType = 'video';
          break;
        case StreamTypes.ADTS_STREAM_TYPE:
          streamType = 'audio';
          break;
        default:
          i--;
          continue;
      }
      if (!lastPes[streamType].done) {
        lastPes[streamType].data.unshift(packet);

        if (packet.payloadUnitStartIndicator) {
          lastPes[streamType].done = true;
        }
      }

      if (lastPes.audio.done && lastPes.video.done) {
        break;
      }

      i--;
    }

    lastPes.audio.data.forEach(function(packet) {
      self.elementaryStream.push(packet);
    });
    lastPes.video.data.forEach(function(packet) {
      self.elementaryStream.push(packet);
    });
    this.elementaryStream.flush();

    return segmentInfo;
  }

  /**
   * Adjusts the timestamp information for the segment to account for
   * rollover and convert to seconds based on pes packet timescale (90khz clock)
   */
  this.adjustTimestamp_ = function(segmentInfo) {
    var i = 0;

    this.audioTimestampRolloverStream.on('data', function(data) {
      segmentInfo.audio[i].pts = data.pts / PES_TIMESCALE;
      segmentInfo.audio[i].dts = data.dts / PES_TIMESCALE;
    });

    this.videoTimestampRolloverStream.on('data', function(data) {
      segmentInfo.video[i].pts = data.pts / PES_TIMESCALE;
      segmentInfo.video[i].dts = data.dts / PES_TIMESCALE;
    });

    this.audioTimestampRolloverStream.push(segmentInfo.audio[i]);
    this.videoTimestampRolloverStream.push(segmentInfo.video[i]);

    i = 1;

    this.audioTimestampRolloverStream.push(segmentInfo.audio[i]);
    this.videoTimestampRolloverStream.push(segmentInfo.video[i]);

    this.audioTimestampRolloverStream.flush();
    this.videoTimestampRolloverStream.flush();
  }

  this.dispose = function() {
    this.transportPacketStream.dispose();
    this.transportParseStream.dispose();
    this.elementaryStream.dispose();
    this.audioTimestampRolloverStream.dispose();
    this.videoTimestampRolloverStream.dispose();
  }
}


module.exports = {
  SegmentInspector
};
