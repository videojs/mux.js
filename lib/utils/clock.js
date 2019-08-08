"use strict";

exports.__esModule = true;
exports.default = exports.metadataTsToSeconds = exports.videoTsToAudioTs = exports.audioTsToVideoTs = exports.audioTsToSeconds = exports.videoTsToSeconds = exports.secondsToAudioTs = exports.secondsToVideoTs = exports.ONE_SECOND_IN_TS = void 0;

/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
 */
var ONE_SECOND_IN_TS = 90000; // 90kHz clock

exports.ONE_SECOND_IN_TS = ONE_SECOND_IN_TS;

var secondsToVideoTs = function secondsToVideoTs(seconds) {
  return seconds * ONE_SECOND_IN_TS;
};

exports.secondsToVideoTs = secondsToVideoTs;

var secondsToAudioTs = function secondsToAudioTs(seconds, sampleRate) {
  return seconds * sampleRate;
};

exports.secondsToAudioTs = secondsToAudioTs;

var videoTsToSeconds = function videoTsToSeconds(timestamp) {
  return timestamp / ONE_SECOND_IN_TS;
};

exports.videoTsToSeconds = videoTsToSeconds;

var audioTsToSeconds = function audioTsToSeconds(timestamp, sampleRate) {
  return timestamp / sampleRate;
};

exports.audioTsToSeconds = audioTsToSeconds;

var audioTsToVideoTs = function audioTsToVideoTs(timestamp, sampleRate) {
  return secondsToVideoTs(audioTsToSeconds(timestamp, sampleRate));
};

exports.audioTsToVideoTs = audioTsToVideoTs;

var videoTsToAudioTs = function videoTsToAudioTs(timestamp, sampleRate) {
  return secondsToAudioTs(videoTsToSeconds(timestamp), sampleRate);
};
/**
 * Adjust ID3 tag or caption timing information by the timeline pts values
 * (if keepOriginalTimestamps is false) and convert to seconds
 */


exports.videoTsToAudioTs = videoTsToAudioTs;

var metadataTsToSeconds = function metadataTsToSeconds(timestamp, timelineStartPts, keepOriginalTimestamps) {
  return videoTsToSeconds(keepOriginalTimestamps ? timestamp : timestamp - timelineStartPts);
};

exports.metadataTsToSeconds = metadataTsToSeconds;
var _default = {
  ONE_SECOND_IN_TS: ONE_SECOND_IN_TS,
  secondsToVideoTs: secondsToVideoTs,
  secondsToAudioTs: secondsToAudioTs,
  videoTsToSeconds: videoTsToSeconds,
  audioTsToSeconds: audioTsToSeconds,
  audioTsToVideoTs: audioTsToVideoTs,
  videoTsToAudioTs: videoTsToAudioTs,
  metadataTsToSeconds: metadataTsToSeconds
};
exports.default = _default;