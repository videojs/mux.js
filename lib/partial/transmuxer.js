var Stream = require('../utils/stream.js');
var m2ts = require('../m2ts/m2ts.js');
var codecs = require('../codecs/index.js');
var AudioSegmentStream = require('./audio-segment-stream.js');
var VideoSegmentStream = require('./video-segment-stream.js');
var trackInfo = require('../mp4/track-decode-info.js');
var isLikelyAacData = require('../aac/utils').isLikelyAacData;
var AdtsStream = require('./adts-stream');
var AacStream = require('./aac-stream');

var createPipeline = function(object) {
  object.prototype = new Stream();
  object.prototype.init.call(object);

  return object;
};

var tsPipeline = function(options) {
  var pipeline = {
    type: 'ts',
    tracks: {
      audio: null,
      video: null
    },
    packet: new m2ts.TransportPacketStream(),
    parse: new m2ts.TransportParseStream(),
    elementary: new m2ts.ElementaryStream(),
    videoRollover: new m2ts.TimestampRolloverStream('video'),
    audioRollover: new m2ts.TimestampRolloverStream('audio'),
    adts: new codecs.adts(),
    h264: new codecs.h264.H264Stream()
  };

  pipeline.headOfPipeline = pipeline.packet;

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
      if (!pipeline.tracks[data.tracks[i].type]) {
        pipeline.tracks[data.tracks[i].type] = data.tracks[i];
      }
    }

    if (pipeline.tracks.video && !pipeline.videoSegment) {
      pipeline.videoSegment = new VideoSegmentStream(pipeline.tracks.video, options);

      pipeline.videoSegment.on('timelineStartInfo', function(timelineStartInfo) {
        if (pipeline.tracks.audio) {
          pipeline.audioSegment.setEarliestDts(timelineStartInfo);
        }
      });

      pipeline.videoSegment.on('timingInfo',
                               pipeline.trigger.bind(pipeline, 'videoTimingInfo'));

      pipeline.videoSegment.on('data', function(data) {
        pipeline.trigger('data', {
          type: 'video',
          data: data
        });
      });

      pipeline.videoSegment.on('done',
                               pipeline.trigger.bind(pipeline, 'done'));
      pipeline.videoSegment.on('partialdone',
                               pipeline.trigger.bind(pipeline, 'partialdone'));
      pipeline.videoSegment.on('endedtimeline',
                               pipeline.trigger.bind(pipeline, 'endedtimeline'));

      pipeline.h264
        .pipe(pipeline.videoSegment);
    }

    if (pipeline.tracks.audio && !pipeline.audioSegment) {
      pipeline.audioSegment = new AudioSegmentStream(pipeline.tracks.audio, options);

      pipeline.audioSegment.on('data', function(data) {
        pipeline.trigger('data', {
          type: 'audio',
          data: data
        });
      });

      pipeline.audioSegment.on('done',
                               pipeline.trigger.bind(pipeline, 'done'));
      pipeline.videoSegment.on('partialdone',
                               pipeline.trigger.bind(pipeline, 'partialdone'));
      pipeline.audioSegment.on('endedtimeline',
                               pipeline.trigger.bind(pipeline, 'endedtimeline'));

      pipeline.audioSegment.on('timingInfo',
                               pipeline.trigger.bind(pipeline, 'audioTimingInfo'));

      pipeline.adts
        .pipe(pipeline.audioSegment);
    }

    // emit pmt info
    pipeline.trigger('trackinfo', {
      hasAudio: !!pipeline.tracks.audio,
      hasVideo: !!pipeline.tracks.video
    });
  });

  return createPipeline(pipeline);
};

var aacPipeline = function(options) {
  var pipeline = {
    type: 'aac',
    tracks: {
      audio: {
        timelineStartInfo: {
          baseMediaDecodeTime: options.baseMediaDecodeTime
        }
      }
    },
    metadataStream: new m2ts.MetadataStream(),
    aacStream: new AacStream(),
    audioRollover: new m2ts.TimestampRolloverStream('audio'),
    timedMetadataTimestampRolloverStream:
      new m2ts.TimestampRolloverStream('timed-metadata'),
    adtsStream: new AdtsStream()
  };

  // set up the parsing pipeline
  pipeline.headOfPipeline = pipeline.aacStream;

  pipeline.aacStream
    .pipe(pipeline.audioRollover)
    .pipe(pipeline.adtsStream);
  pipeline.aacStream
    .pipe(pipeline.timedMetadataTimestampRolloverStream)
    .pipe(pipeline.metadataStream);

  pipeline.metadataStream.on('timestamp', function(frame) {
    pipeline.aacStream.setTimestamp(frame.timeStamp);
  });

  pipeline.aacStream.on('data', function(data) {
    if (data.type !== 'timed-metadata' || pipeline.audioSegmentStream) {
      return;
    }

    var audioTrack = {
      timelineStartInfo: {
        baseMediaDecodeTime: pipeline.tracks.audio.timelineStartInfo.baseMediaDecodeTime
      },
      codec: 'adts',
      type: 'audio'
    };

    // hook up the audio segment stream to the first track with aac data
    pipeline.audioSegmentStream = new AudioSegmentStream(audioTrack, options);

    pipeline.audioSegmentStream.on('timingInfo',
      pipeline.trigger.bind(pipeline, 'audioTimingInfo'));

    // Set up the final part of the audio pipeline
    pipeline.adtsStream
      .pipe(pipeline.audioSegmentStream)

    pipeline.audioSegmentStream.on('data', function(data) {
      pipeline.trigger('data', {
        type: 'audio',
        data: data
      });
    });
    pipeline.audioSegmentStream.on('partialdone',
                                   pipeline.trigger.bind(pipeline, 'partialdone'));
    pipeline.audioSegmentStream.on('done', pipeline.trigger.bind(pipeline, 'done'));
    pipeline.audioSegmentStream.on('endedtimeline',
                                   pipeline.trigger.bind(pipeline, 'endedtimeline'));
    pipeline.audioSegmentStream.on('timingInfo',
                                   pipeline.trigger.bind(pipeline, 'audioTimingInfo'));

  });

  return createPipeline(pipeline);
};

var setupPipelineListeners = function(pipeline, transmuxer) {
  pipeline.on('data', transmuxer.trigger.bind(transmuxer, 'data'));
  pipeline.on('done', transmuxer.trigger.bind(transmuxer, 'done'));
  pipeline.on('partialdone', transmuxer.trigger.bind(transmuxer, 'partialdone'));
  pipeline.on('endedtimeline', transmuxer.trigger.bind(transmuxer, 'endedtimeline'));
  pipeline.on('audioTimingInfo', transmuxer.trigger.bind(transmuxer, 'audioTimingInfo'));
  pipeline.on('videoTimingInfo', transmuxer.trigger.bind(transmuxer, 'videoTimingInfo'));
  pipeline.on('trackinfo', transmuxer.trigger.bind(transmuxer, 'trackinfo'));
};

var Transmuxer = function(options) {
  var
    pipeline = null,
    hasFlushed = true;

  Transmuxer.prototype.init.call(this);

  this.push = function(bytes) {
    if (hasFlushed) {
      var isAac = isLikelyAacData(bytes);

      if (isAac && (!pipeline || pipeline.type !== 'aac')) {
        pipeline = aacPipeline(options);
        setupPipelineListeners(pipeline, this);
      } else if (!isAac && (!pipeline || pipeline.type !== 'ts')) {
        pipeline = tsPipeline(options);
        setupPipelineListeners(pipeline, this);
      }
      hasFlushed = false;
    }

    pipeline.headOfPipeline.push(bytes);
  };

  this.flush = function() {
    if (!pipeline) {
      return;
    }

    hasFlushed = true;
    pipeline.headOfPipeline.flush();
  };

  this.partialFlush = function() {
    if (!pipeline) {
      return;
    }

    pipeline.headOfPipeline.partialFlush();
  };

  this.endTimeline = function() {
    if (!pipeline) {
      return;
    }

    pipeline.headOfPipeline.endTimeline();
  };

  this.reset = function() {
    if (!pipeline) {
      return;
    }

    pipeline.headOfPipeline.reset();
  };

  this.setBaseMediaDecodeTime = function(baseMediaDecodeTime) {
    options.baseMediaDecodeTime = baseMediaDecodeTime;

    if (!pipeline) {
      return;
    }

    // TODO (removed some important items, e.g., captions)
    if (pipeline.tracks.audio) {
      pipeline.tracks.audio.timelineStartInfo.dts = undefined;
      pipeline.tracks.audio.timelineStartInfo.pts = undefined;
      trackInfo.clearDtsInfo(pipeline.tracks.audio);
      if (!options.keepOriginalTimestamps) {
        pipeline.tracks.audio.timelineStartInfo.baseMediaDecodeTime = baseMediaDecodeTime;
      }
      if (pipeline.audioRollover) {
        pipeline.audioRollover.discontinuity();
      }
    }
    if (pipeline.tracks.video) {
      if (pipeline.videoSegment) {
        pipeline.videoSegment.gopCache_ = [];
        pipeline.videoRollover.discontinuity();
      }
      pipeline.tracks.video.timelineStartInfo.dts = undefined;
      pipeline.tracks.video.timelineStartInfo.pts = undefined;
      trackInfo.clearDtsInfo(pipeline.tracks.video);
      // pipeline.captionStream.reset();
      if (!options.keepOriginalTimestamps) {
        pipeline.tracks.video.timelineStartInfo.baseMediaDecodeTime = baseMediaDecodeTime;
      }
    }
  };

  this.setAudioAppendStart = function(audioAppendStart) {
    if (!pipeline) {
      return;
    }

    // TODO
  };

  this.alignGopsWith = function() {
    if (!pipeline) {
      return;
    }

    // TODO
  };
};

Transmuxer.prototype = new Stream();

module.exports = Transmuxer;
