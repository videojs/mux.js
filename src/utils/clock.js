/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
 */
export var ONE_SECOND_IN_TS = 90000; // 90kHz clock

export var secondsToVideoTs = function(seconds) {
  return seconds * ONE_SECOND_IN_TS;
};

export var secondsToAudioTs = function(seconds, sampleRate) {
  return seconds * sampleRate;
};

export var videoTsToSeconds = function(timestamp) {
  return timestamp / ONE_SECOND_IN_TS;
};

export var audioTsToSeconds = function(timestamp, sampleRate) {
  return timestamp / sampleRate;
};

export var audioTsToVideoTs = function(timestamp, sampleRate) {
  return secondsToVideoTs(audioTsToSeconds(timestamp, sampleRate));
};

export var videoTsToAudioTs = function(timestamp, sampleRate) {
  return secondsToAudioTs(videoTsToSeconds(timestamp), sampleRate);
};

/**
 * Adjust ID3 tag or caption timing information by the timeline pts values
 * (if keepOriginalTimestamps is false) and convert to seconds
 */
export var metadataTsToSeconds = function(timestamp, timelineStartPts, keepOriginalTimestamps) {
  return videoTsToSeconds(keepOriginalTimestamps ? timestamp : timestamp - timelineStartPts);
};

export default {
  ONE_SECOND_IN_TS: ONE_SECOND_IN_TS,
  secondsToVideoTs: secondsToVideoTs,
  secondsToAudioTs: secondsToAudioTs,
  videoTsToSeconds: videoTsToSeconds,
  audioTsToSeconds: audioTsToSeconds,
  audioTsToVideoTs: audioTsToVideoTs,
  videoTsToAudioTs: videoTsToAudioTs,
  metadataTsToSeconds: metadataTsToSeconds
};
