/**
 * Constructs a single-track, ISO BMFF media segment from H264 data
 * events. The output of this stream can be fed to a SourceBuffer
 * configured with a suitable initialization segment.
 * @param track {object} track metadata configuration
 * @param options {object} transmuxer options object
 * @param options.alignGopsAtEnd {boolean} If true, start from the end of the
 *        gopsToAlignWith list when attempting to align gop pts
 */
'use strict';

var Stream = require('../utils/stream.js');
var mp4 = require('../mp4/mp4-generator.js');
var trackInfo = require('./track-decode-info.js');

var VIDEO_PROPERTIES = [
  'width',
  'height',
  'profileIdc',
  'levelIdc',
  'profileCompatibility'
];

/**
 * Default sample object
 * see ISO/IEC 14496-12:2012, section 8.6.4.3
 */
var createDefaultSample = function() {
  return {
    size: 0,
    flags: {
      isLeading: 0,
      dependsOn: 1,
      isDependedOn: 0,
      hasRedundancy: 0,
      degradationPriority: 0
    }
  };
};

var VideoSegmentStream = function(track, options) {
  var
    sequenceNumber = 0,
    nalUnits = [],
    frameCache = [],
    logs = [],
    config,
    pps,
    segmentStartDts = null,
    segmentEndDts = null;

  options = options || {};

  VideoSegmentStream.prototype.init.call(this);

  this.push = function(nalUnit) {
    trackInfo.collectDtsInfo(track, nalUnit);
    if (track.startDts === undefined) {
      // TODO do we need to reset this on discontinuities?
      track.startDts = nalUnit.dts;
    }

    // record the track config
    if (nalUnit.nalUnitType === 'seq_parameter_set_rbsp' && !config) {
      config = nalUnit.config;
      track.sps = [nalUnit.data];

      VIDEO_PROPERTIES.forEach(function(prop) {
        track[prop] = config[prop];
      }, this);
    }

    if (nalUnit.nalUnitType === 'pic_parameter_set_rbsp' &&
        !pps) {
      pps = nalUnit.data;
      track.pps = [nalUnit.data];
    }

    // buffer video until flush() is called
    nalUnits.push(nalUnit);
  };

  this.processNals_ = function(cacheLastFrame) {
    var i;

    nalUnits = frameCache.concat(nalUnits);

    // Throw away nalUnits at the start of the byte stream until
    // we find the first AUD
    while (nalUnits.length) {
      if (nalUnits[0].nalUnitType === 'access_unit_delimiter_rbsp') {
        break;
      }
      nalUnits.shift();
    }

    // Return early if no video data has been observed
    if (nalUnits.length === 0) {
      return;
    }

    var frames = this.groupNalsIntoFrames_(nalUnits);

    if (!frames.length) {
      return;
    }

    // note that the frame cache may also protect us from cases where we haven't
    // pushed data for the entire first or last frame yet
    frameCache = frames[frames.length - 1];

    if (cacheLastFrame) {
      frames.pop();
      frames.duration -= frameCache.duration;
      frames.nalCount -= frameCache.length;
      frames.byteLength -= frameCache.byteLength;
    }

    if (!frames.length) {
      nalUnits = [];
      return;
    }

    this.trigger('timelineStartInfo', track.startDts);

    if (segmentStartDts === null) {
      segmentStartDts = frames[0].dts;
      segmentEndDts = segmentStartDts;
    }

    segmentEndDts += frames.duration;

    this.trigger('timingInfo', {
      start: segmentStartDts,
      end: segmentEndDts,
    });

    for (i = 0; i < frames.length; i++) {
      var frame = frames[i];

      track.samples = this.generateSampleTable_(frame);

      var mdat = mp4.mdat(this.concatenateNalData_(frame));

      trackInfo.clearDtsInfo(track);
      trackInfo.collectDtsInfo(track, frame);

      track.baseMediaDecodeTime = trackInfo.calculateTrackBaseMediaDecodeTime(
        track, options.keepOriginalTimestamps);

      var moof = mp4.moof(sequenceNumber, [track]);

      sequenceNumber++;

      track.initSegment = mp4.initSegment([track]);

      var boxes = new Uint8Array(moof.byteLength + mdat.byteLength);

      boxes.set(moof);
      boxes.set(mdat, moof.byteLength);

      this.trigger('data', {track: track, boxes: boxes, sequence: sequenceNumber});
    }

    nalUnits = [];
  }

  this.flush = function() {
    this.processNals_(true);
    this.trigger('done', 'VideoSegmentStream');
  };

  this.superFlush = function() {
    this.processNals_(false);
    // reset config and pps because they may differ across segments
    // for instance, when we are rendition switching
    config = undefined;
    pps = undefined;
    segmentStartDts = null;
    segmentEndDts = null;
    this.trigger('superdone', 'VideoSegmentStream');
  };

  this.reset = function() {
    config = undefined;
    pps = undefined;
    segmentStartDts = null;
    segmentEndDts = null;
    frameCache = [];
    nalUnits = [];
  }

  // Convert an array of nal units into an array of frames with each frame being
  // composed of the nal units that make up that frame
  // Also keep track of cummulative data about the frame from the nal units such
  // as the frame duration, starting pts, etc.
  this.groupNalsIntoFrames_ = function(nalUnits) {
    var
      i,
      currentNal,
      currentFrame = [],
      frames = [];

    frames.byteLength = 0;
    frames.nalCount = 0;
    frames.duration = 0;
    currentFrame.byteLength = 0;

    for (i = 0; i < nalUnits.length; i++) {
      currentNal = nalUnits[i];

      // Split on 'aud'-type nal units
      if (currentNal.nalUnitType === 'access_unit_delimiter_rbsp') {
        // Since the very first nal unit is expected to be an AUD
        // only push to the frames array when currentFrame is not empty
        if (currentFrame.length) {
          currentFrame.duration = currentNal.dts - currentFrame.dts;
          frames.byteLength += currentFrame.byteLength;
          frames.nalCount += currentFrame.length;
          frames.duration += currentFrame.duration;
          frames.push(currentFrame);
        }
        currentFrame = [currentNal];
        currentFrame.byteLength = currentNal.data.byteLength;
        currentFrame.pts = currentNal.pts;
        currentFrame.dts = currentNal.dts;
      } else {
        // Specifically flag key frames for ease of use later
        if (currentNal.nalUnitType === 'slice_layer_without_partitioning_rbsp_idr') {
          currentFrame.keyFrame = true;
        }
        currentFrame.duration = currentNal.dts - currentFrame.dts;
        currentFrame.byteLength += currentNal.data.byteLength;
        currentFrame.push(currentNal);
      }
    }

    // For the last frame, use the duration of the previous frame if we
    // have nothing better to go on
    if (frames.length &&
        (!currentFrame.duration ||
         currentFrame.duration <= 0)) {
      currentFrame.duration = frames[frames.length - 1].duration;
    }

    // Push the final frame
    frames.byteLength += currentFrame.byteLength;
    frames.nalCount += currentFrame.length;
    frames.duration += currentFrame.duration;
    frames.push(currentFrame);
    return frames;
  };

  // generate the track's sample table from an array of gops
  this.generateSampleTable_ = function(currentFrame, baseDataOffset) {
    var
      // i,
      sample,
      // currentFrame,
      dataOffset = baseDataOffset || 0,
      samples = [];

    // for (i = 0; i < frames.length; i++) {
      // currentFrame = frames[i];

      sample = createDefaultSample();

      sample.dataOffset = dataOffset;
      sample.compositionTimeOffset = currentFrame.pts - currentFrame.dts;
      sample.duration = currentFrame.duration;
      sample.size = 4 * currentFrame.length; // Space for nal unit size
      sample.size += currentFrame.byteLength;

      if (currentFrame.keyFrame) {
        sample.flags.dependsOn = 2;
      }

      dataOffset += sample.size;

      samples.push(sample);
    // }

    return samples;
  };

  // generate the track's raw mdat data from an array of frames
  this.concatenateNalData_ = function(currentFrame) {
    var
      i, j,
      // currentFrame,
      currentNal,
      dataOffset = 0,
      nalsByteLength = currentFrame.byteLength,
      numberOfNals = currentFrame.length,
      totalByteLength = nalsByteLength + 4 * numberOfNals,
      data = new Uint8Array(totalByteLength),
      view = new DataView(data.buffer);

    // For each Frame..
    // for (i = 0; i < frames.length; i++) {
    //   currentFrame = frames[i];

      // For each NAL..
      for (j = 0; j < currentFrame.length; j++) {
        currentNal = currentFrame[j];

        view.setUint32(dataOffset, currentNal.data.byteLength);
        dataOffset += 4;
        data.set(currentNal.data, dataOffset);
        dataOffset += currentNal.data.byteLength;
      }
    // }

    return data;
  };
};

VideoSegmentStream.prototype = new Stream();

module.exports = VideoSegmentStream;
