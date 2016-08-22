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
var AacStream = require('../aac');
var AdtsStream = require('../codecs/adts.js');

var PES_TIMESCALE = 90000;

var isLikelyAacData = function(data) {
  if ((data[0] === 'I'.charCodeAt(0)) &&
      (data[1] === 'D'.charCodeAt(0)) &&
      (data[2] === '3'.charCodeAt(0))) {
    return true;
  }
  return false;
};

var SegmentInspector = function() {
  var self = this;

  this.pipeline_ = {};

  /**
   * Inspects the given segment byte array and returns an object with timing
   * information for the first and last packet.
   */
  this.inspect = function(segment) {
    var isAac = isLikelyAacData(segment);

    if (isAac && this.pipeline_.type !== 'aac') {
      this.setupAacPipeline();
    } else if (!isAac && this.pipeline_.type !== 'ts') {
      this.setupTsPipeline();
    }

    if (this.pipeline_.type === 'aac') {
      return this.inspectAac(segment);
    } else if (this.pipeline_.type === 'ts') {
      return this.inspectTs(segment);
    }
  };

  this.setupAacPipeline = function() {
    var pipeline = {};
    this.pipeline_ = pipeline;
    pipeline.aacStream = new AacStream();
    pipeline.adtsStream = new AdtsStream();
    pipeline.metadataStream = new m2ts.MetadataStream();
    pipeline.audioTimestampRolloverStream = new m2ts.TimestampRolloverStream('audio');
    pipeline.timedMetadataTimestampRolloverStream = new m2ts.TimestampRolloverStream('timed-metadata');
    pipeline.type = 'aac';

    pipeline.aacStream
      .pipe(pipeline.audioTimestampRolloverStream)
      .pipe(pipeline.adtsStream);
    pipeline.aacStream
      .pipe(pipeline.timedMetadataTimestampRolloverStream)
      .pipe(pipeline.metadataStream);
    pipeline.metadataStream.on('timestamp', function(frame) {
      pipeline.aacStream.setTimestamp(frame.timeStamp);
    });
  };

  this.setupTsPipeline = function() {
    var pipeline = {}
    this.pipeline_ = pipeline;
    pipeline.transportPacketStream = new m2ts.TransportPacketStream();
    pipeline.transportParseStream = new m2ts.TransportParseStream();
    pipeline.elementaryStream = new m2ts.ElementaryStream();
    pipeline.audioTimestampRolloverStream = new m2ts.TimestampRolloverStream('audio');
    pipeline.videoTimestampRolloverStream = new m2ts.TimestampRolloverStream('video');
    pipeline.type = 'ts';
  };

  this.inspectAac = function(segment) {
    var pipeline = this.pipeline_;
    var adtsFrames = [];
    var segmentInfo = {
      audio: []
    };

    pipeline.adtsStream.on('data', function(data) {
      console.log(data);
      adtsFrames.push(data);
    });

    pipeline.aacStream.push(segment);
    pipeline.aacStream.flush();

    segmentInfo.audio.push(adtsFrames[0], adtsFrames[adtsFrames.length - 1]);
    pipeline.adtsStream.dispose();
    return segmentInfo;
  };

  this.inspectTs = function(segment) {
    var pipeline = this.pipeline_;
    var tsPackets = [];
    var segmentInfo = {};

    pipeline.transportPacketStream
      .pipe(pipeline.transportParseStream);

    pipeline.transportParseStream.on('data', function(data) {
      if (data.type === 'pmt') {
        var pmt = data.programMapTable;
        for (var program in pmt) {
          if (pmt.hasOwnProperty(program)) {
            if (pmt[program] === m2ts.H264_STREAM_TYPE) {
              segmentInfo.video = [];
            } else if (pmt[program] === m2ts.ADTS_STREAM_TYPE) {
              segmentInfo.audio = [];
            }
          }
        }
      } else {
        tsPackets.push(data);
      }
    });

    pipeline.transportParseStream.on('done', function() {
      self.parsePackets_(segmentInfo, tsPackets);
    });

    pipeline.transportPacketStream.push(segment);
    pipeline.transportPacketStream.flush();

    pipeline.transportPacketStream.dispose();
    pipeline.transportParseStream.dispose();

    this.adjustTimestamp_(segmentInfo);

    return segmentInfo;
  };

  /**
   * Parse the given pes packets to gain information from the first and last complete packet
   */
  this.parsePackets_ = function(segmentInfo, packets) {
    var processVideoData = !!segmentInfo.video;
    var processAudioData = !!segmentInfo.audio;
    var pipeline = this.pipeline_;

    pipeline.elementaryStream.on('data', function(data) {
      if (data.type === 'audio' && processAudioData) {
        segmentInfo.audio.push(data);
        processAudioData = false;
      } else if (data.type === 'video' && processVideoData) {
        segmentInfo.video.push(data);
        processVideoData = false;
      }
    });

    var i = 0;
    var packet;

    while((processAudioData || processVideoData) && i < packets.length) {
      packet = packets[i];
      if (packet.payloadUnitStartIndicator) {
        pipeline.elementaryStream.push(packet);
        pipeline.elementaryStream.flush();
      }
      i++;
    }

    processVideoData = !!segmentInfo.video;
    processAudioData = !!segmentInfo.audio

    i = packets.length - 1;

    // Walk back from the end to find the last video and audio pes packets
    while((processAudioData || processVideoData) && i > -1) {
      packet = packets[i];
      if (packet.payloadUnitStartIndicator) {
        pipeline.elementaryStream.push(packet);
        pipeline.elementaryStream.flush();
      }

      i--;
    }
  };

  /**
   * Adjusts the timestamp information for the segment to account for
   * rollover and convert to seconds based on pes packet timescale (90khz clock)
   */
  this.adjustTimestamp_ = function(segmentInfo) {
    var pipeline = this.pipeline_;

    pipeline.audioTimestampRolloverStream.on('data', function(data) {
      segmentInfo.audio[i].pts = data.pts / PES_TIMESCALE;
      segmentInfo.audio[i].dts = data.dts / PES_TIMESCALE;
    });

    pipeline.videoTimestampRolloverStream.on('data', function(data) {
      segmentInfo.video[i].pts = data.pts / PES_TIMESCALE;
      segmentInfo.video[i].dts = data.dts / PES_TIMESCALE;
    });

    var i = 0;
    if (segmentInfo.audio && segmentInfo.audio.length) {
      pipeline.audioTimestampRolloverStream.push(segmentInfo.audio[i]);
      i = 1;
      pipeline.audioTimestampRolloverStream.push(segmentInfo.audio[i]);
      pipeline.audioTimestampRolloverStream.flush();
    }

    i = 0;
    if (segmentInfo.video && segmentInfo.video.length) {
      pipeline.videoTimestampRolloverStream.push(segmentInfo.video[i]);
      i = 1;
      pipeline.videoTimestampRolloverStream.push(segmentInfo.video[i]);
      pipeline.videoTimestampRolloverStream.flush();
    }

    pipeline.videoTimestampRolloverStream.dispose();
    pipeline.videoTimestampRolloverStream.dispose();
  };
};

module.exports = {
  SegmentInspector: SegmentInspector
};
