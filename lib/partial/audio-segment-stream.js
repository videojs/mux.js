'use strict';

exports.__esModule = true;
exports.default = void 0;

var _stream = _interopRequireDefault(require("../utils/stream.js"));

var _mp4Generator = require("../mp4/mp4-generator.js");

var _audioFrameUtils = _interopRequireDefault(require("../mp4/audio-frame-utils"));

var _trackDecodeInfo = _interopRequireDefault(require("../mp4/track-decode-info.js"));

var _clock = require("../utils/clock");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// constants
var AUDIO_PROPERTIES = ['audioobjecttype', 'channelcount', 'samplerate', 'samplingfrequencyindex', 'samplesize'];
/**
 * Constructs a single-track, ISO BMFF media segment from AAC data
 * events. The output of this stream can be fed to a SourceBuffer
 * configured with a suitable initialization segment.
 */

var AudioSegmentStream = function AudioSegmentStream(track, options) {
  var adtsFrames = [],
      sequenceNumber = 0,
      earliestAllowedDts = 0,
      audioAppendStartTs = 0,
      videoBaseMediaDecodeTime = Infinity,
      segmentStartDts = null,
      segmentEndDts = null;
  options = options || {};
  AudioSegmentStream.prototype.init.call(this);

  this.push = function (data) {
    _trackDecodeInfo.default.collectDtsInfo(track, data);

    if (track) {
      AUDIO_PROPERTIES.forEach(function (prop) {
        track[prop] = data[prop];
      });
    } // buffer audio data until end() is called


    adtsFrames.push(data);
  };

  this.setEarliestDts = function (earliestDts) {
    earliestAllowedDts = earliestDts;
  };

  this.setVideoBaseMediaDecodeTime = function (baseMediaDecodeTime) {
    videoBaseMediaDecodeTime = baseMediaDecodeTime;
  };

  this.setAudioAppendStart = function (timestamp) {
    audioAppendStartTs = timestamp;
  };

  this.processFrames_ = function () {
    var frames, moof, mdat, boxes, timingInfo; // return early if no audio data has been observed

    if (adtsFrames.length === 0) {
      return;
    }

    frames = _audioFrameUtils.default.trimAdtsFramesByEarliestDts(adtsFrames, track, earliestAllowedDts);

    if (frames.length === 0) {
      // return early if the frames are all after the earliest allowed DTS
      // TODO should we clear the adtsFrames?
      return;
    }

    track.baseMediaDecodeTime = _trackDecodeInfo.default.calculateTrackBaseMediaDecodeTime(track, options.keepOriginalTimestamps);

    _audioFrameUtils.default.prefixWithSilence(track, frames, audioAppendStartTs, videoBaseMediaDecodeTime); // we have to build the index from byte locations to
    // samples (that is, adts frames) in the audio data


    track.samples = _audioFrameUtils.default.generateSampleTable(frames); // concatenate the audio data to constuct the mdat

    mdat = (0, _mp4Generator.mdat)(_audioFrameUtils.default.concatenateFrameData(frames));
    adtsFrames = [];
    moof = (0, _mp4Generator.moof)(sequenceNumber, [track]); // bump the sequence number for next time

    sequenceNumber++;
    track.initSegment = (0, _mp4Generator.initSegment)([track]); // it would be great to allocate this array up front instead of
    // throwing away hundreds of media segment fragments

    boxes = new Uint8Array(moof.byteLength + mdat.byteLength);
    boxes.set(moof);
    boxes.set(mdat, moof.byteLength);

    _trackDecodeInfo.default.clearDtsInfo(track);

    if (segmentStartDts === null) {
      segmentEndDts = segmentStartDts = frames[0].dts;
    }

    segmentEndDts += frames.length * (_clock.ONE_SECOND_IN_TS * 1024 / track.samplerate);
    timingInfo = {
      start: segmentStartDts
    };
    this.trigger('timingInfo', timingInfo);
    this.trigger('data', {
      track: track,
      boxes: boxes
    });
  };

  this.flush = function () {
    this.processFrames_(); // trigger final timing info

    this.trigger('timingInfo', {
      start: segmentStartDts,
      end: segmentEndDts
    });
    this.resetTiming_();
    this.trigger('done', 'AudioSegmentStream');
  };

  this.partialFlush = function () {
    this.processFrames_();
    this.trigger('partialdone', 'AudioSegmentStream');
  };

  this.endTimeline = function () {
    this.flush();
    this.trigger('endedtimeline', 'AudioSegmentStream');
  };

  this.resetTiming_ = function () {
    _trackDecodeInfo.default.clearDtsInfo(track);

    segmentStartDts = null;
    segmentEndDts = null;
  };

  this.reset = function () {
    this.resetTiming_();
    adtsFrames = [];
    this.trigger('reset');
  };
};

AudioSegmentStream.prototype = new _stream.default();
var _default = AudioSegmentStream;
exports.default = _default;