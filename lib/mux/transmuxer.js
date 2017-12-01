var Stream = require('../utils/stream.js');
var m2ts = require('../m2ts/m2ts.js');
var codecs = require('../codecs/index.js');
var AudioSegmentStream = require('./audio-segment-stream.js');
var VideoSegmentStream = require('./video-segment-stream.js');

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
      pipeline.videoSegment = new VideoSegmentStream(tracks.video);

      pipeline.videoSegment.on('timelineStartInfo', function(timelineStartInfo) {
        if (tracks.audio) {
          pipeline.audioSegment.setEarliestDts(timelineStartInfo);
        }
      });

      pipeline.videoSegment.on('data', function(data) {
        _self.trigger('data', {
          type: 'video',
          data: data
        });
      });

      pipeline.h264
        .pipe(pipeline.videoSegment);
    }

    if (tracks.audio && !pipeline.audioSegment) {
      pipeline.audioSegment = new AudioSegmentStream(tracks.audio);

      pipeline.audioSegment.on('data', function(data) {
        _self.trigger('data', {
          type: 'audio',
          data: data
        });
      });

      pipeline.adts
        .pipe(pipeline.audioSegment);
    }
  });

  this.push = function(bytes) {
    pipeline.packet.push(bytes);
  };

  this.flush = function() {
    pipeline.packet.flush();
  }

  this.superFlush = function() {
    pipeline.packet.superFlush();
  }
};

Transmuxer.prototype = new Stream();

module.exports = Transmuxer;
