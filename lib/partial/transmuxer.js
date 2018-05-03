var Stream = require('../utils/stream.js');
var m2ts = require('../m2ts/m2ts.js');
var codecs = require('../codecs/index.js');
var AudioSegmentStream = require('./audio-segment-stream.js');
var VideoSegmentStream = require('./video-segment-stream.js');
var trackInfo = require('../mp4/track-decode-info.js');

var Transmuxer = function(options) {

  var _self = this;

  Transmuxer.prototype.init.call(this);

  var tracks = {
    audio: null,
    video: null
  };
  var pipeline = {
    packet: new m2ts.TransportPacketStream(),
    parse: new m2ts.TransportParseStream(),
    elementary: new m2ts.ElementaryStream(),
    videoRollover: new m2ts.TimestampRolloverStream('video'),
    audioRollover: new m2ts.TimestampRolloverStream('audio'),
    adts: new codecs.adts(),
    h264: new codecs.h264.H264Stream()
  };

  this.pipeline = pipeline;
  this.tracks = tracks;

  // Transport Stream
  pipeline.packet
    .pipe(pipeline.parse)
    .pipe(pipeline.elementary);

  // H264
  pipeline.elementary
    .pipe(pipeline.videoRollover)
    .pipe(pipeline.h264);

  // ADTS
  pipeline.elementary
    .pipe(pipeline.audioRollover)
    .pipe(pipeline.adts);

  pipeline.elementary.on('data', function(data) {
    if (data.type !== 'metadata') {
      return;
    }

    for (var i = 0; i < data.tracks.length; i++) {
      if (!tracks[data.tracks[i].type]) {
        tracks[data.tracks[i].type] = data.tracks[i];
      }
    }

    if (tracks.video && !pipeline.videoSegment) {
      pipeline.videoSegment = new VideoSegmentStream(tracks.video, options);

      pipeline.videoSegment.on('timelineStartInfo', function(timelineStartInfo) {
        if (tracks.audio) {
          pipeline.audioSegment.setEarliestDts(timelineStartInfo);
        }
      });

      pipeline.videoSegment.on('timingInfo',
                               _self.trigger.bind(_self, 'videoTimingInfo'));

      pipeline.videoSegment.on('data', function(data) {
        _self.trigger('data', {
          type: 'video',
          data: data
        });
      });

      pipeline.videoSegment.on('done',
                               _self.trigger.bind(_self, 'done'));
      pipeline.videoSegment.on('endedsegment',
                               _self.trigger.bind(_self, 'endedsegment'));
      pipeline.videoSegment.on('endedtimeline',
                               _self.trigger.bind(_self, 'endedtimeline'));

      pipeline.h264
        .pipe(pipeline.videoSegment);
    }

    if (tracks.audio && !pipeline.audioSegment) {
      pipeline.audioSegment = new AudioSegmentStream(tracks.audio, options);

      pipeline.audioSegment.on('data', function(data) {
        _self.trigger('data', {
          type: 'audio',
          data: data
        });
      });

      pipeline.audioSegment.on('done',
                               _self.trigger.bind(_self, 'done'));
      pipeline.audioSegment.on('endedsegment',
                               _self.trigger.bind(_self, 'endedsegment'));
      pipeline.audioSegment.on('endedtimeline',
                               _self.trigger.bind(_self, 'endedtimeline'));

      pipeline.audioSegment.on('timingInfo',
                               _self.trigger.bind(_self, 'audioTimingInfo'));

      pipeline.adts
        .pipe(pipeline.audioSegment);
    }

    // emit pmt info
    _self.trigger('trackinfo', {
      containsAudio: !!tracks.audio,
      containsVideo: !!tracks.video
    });
  });

  this.push = function(bytes) {
    pipeline.packet.push(bytes);
  };

  this.flush = function() {
    pipeline.packet.flush();
  };

  this.endSegment = function() {
    pipeline.packet.endSegment();
  };

  this.endTimeline = function() {
    pipeline.packet.endTimeline();
  };

  this.reset = function() {
    if (pipeline.videoSegment) {
      pipeline.videoSegment.reset();
    }
    if (pipeline.audioSegment) {
      pipeline.audioSegment.reset();
    }
    if (pipeline.elementary) {
      pipeline.elementary.reset();
    }
    if (pipeline.h264) {
      pipeline.h264.reset();
    }
    /* TODO
    if (pipeline.caption) {
      pipeline.caption.reset();
    }
    */
  };

  this.setBaseMediaDecodeTime = function(baseMediaDecodeTime) {
    // TODO (removed some important items, e.g., captions)
    if (tracks.audio) {
      tracks.audio.timelineStartInfo.dts = undefined;
      tracks.audio.timelineStartInfo.pts = undefined;
      trackInfo.clearDtsInfo(tracks.audio);
      if (!options.keepOriginalTimestamps) {
        tracks.audio.timelineStartInfo.baseMediaDecodeTime = baseMediaDecodeTime;
      }
      if (pipeline.audioRollover) {
        pipeline.audioRollover.discontinuity();
      }
    }
    if (tracks.video) {
      if (pipeline.videoSegment) {
        pipeline.videoSegment.gopCache_ = [];
        pipeline.videoRollover.discontinuity();
      }
      tracks.video.timelineStartInfo.dts = undefined;
      tracks.video.timelineStartInfo.pts = undefined;
      trackInfo.clearDtsInfo(tracks.video);
      // pipeline.captionStream.reset();
      if (!options.keepOriginalTimestamps) {
        tracks.video.timelineStartInfo.baseMediaDecodeTime = baseMediaDecodeTime;
      }
    }
  };

  this.setAudioAppendStart = function(audioAppendStart) {
    // TODO
  };

  this.alignGopsWith = function() {
    // TODO
  };
};

Transmuxer.prototype = new Stream();

module.exports = Transmuxer;
