/**
 * mux.js
 *
 * Copyright (c) 2015 Brightcove
 * All rights reserved.
 *
 * Utilities to detect basic properties and metadata about MP4s.
 */
'use strict';

var discardEmulationPreventionBytes = require('../tools/cea708-parser').discardEmulationPreventionBytes;
var CaptionStream = require('../m2ts/caption-stream').CaptionStream;
var mp4Probe = require('./probe');
var findBox = mp4Probe.findBox;
var timescale = mp4Probe.timescale;
var mp4Inspector = require('../tools/mp4-inspector');
var parseTfdt = mp4Inspector.parseTfdt;
var parseHdlr = mp4Inspector.parseHdlr;
var parseTfhd = mp4Inspector.parseTfhd;
var parseTrun = mp4Inspector.parseTrun;

var parseTrackId = function(bytes) {
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var version = view.getUint8(0);
  var i = (version === 0) ? 12 : 20;
  var trackId = view.getUint32(i);

  return trackId;
};

// FIXME: might be able to delete
var parseMdhd = function(bytes) {
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var version = view.getUint8(0);
  var creationTime;
  var modificationTime;
  var timescale;
  var duration;

  if (version === 1) {
    // 64 bits
    creationTime = bytes.subarray(4, 12);
    modificationTime = bytes.subarray(12, 20);
    // 32 bits
    timescale = view.getUint32(20);
    // 64 bits
    duration = bytes.subarray(24, 32);

  } else {
    // 32 bits
    creationTime = view.getUint32(4);
    modificationTime = view.getUint32(8);
    timescale = view.getUint32(12);
    duration = view.getUint32(16);
  }

  return {
    creationTime: creationTime,
    modificationTime: modificationTime,
    timescale: timescale,
    duration: duration
  };
};

// FIXME: keeping this around for sample table still
var parseInitForCaptionMetadata = function(initSegment) {
  var traks = findBox(initSegment, ['moov', 'trak']);
  var result = {};

  for (var i = 0; i < traks.length; i++) {
    var trak = traks[i];
    var trakResult;

    var mdia = findBox(trak, ['mdia']);
    var tkhd = findBox(trak, ['tkhd']);
    var trackId = parseTrackId(tkhd[0]);

    // 1 per trak
    var hdlr = findBox(mdia[0], ['hdlr']);
    var handlerType = parseHdlr(hdlr[0]).handlerType;

    // Don't return audio track metadata
    if (handlerType !== 'vide') {
      continue;
    }

    var stbl = findBox(mdia[0], ['minf', 'stbl']);
    var mdhd = findBox(mdia[0], ['mdhd']);

    var parsedMdhd = parseMdhd(mdhd[0]);

    trakResult = {
      trackId: trackId,
      timescale: parsedMdhd.timescale,
      duration: parsedMdhd.duration,
      handlerType: handlerType,
      // FIXME: potentially might want to parse this
      stbl: stbl[0]
    };

    result[trackId] = trakResult;
  }

  return result;
};

// FIXME: might be able to delete, but pull comments into
// mp4-inspector
var oldParseSamples = function(truns, baseMediaDecodeTime, tfhd) {
  var sampleDataOffset = tfhd.baseDataOffset || 0;
  var trackId = tfhd.trackId;
  // Default values for samples
  // FIXME: need to actually use these as defaults now
  var defaultSampleDuration = tfhd.defaultSampleDuration;
  var defaultSampleSize = tfhd.defaultSampleSize;
  var defaultSampleFlags = tfhd.defaultSampleFlags;
  // Initialize decode time stamp
  var currentDts = baseMediaDecodeTime;
  var samples = [];

  truns.forEach(function(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    var version;
    var sampleCount;
    var flags;

    // Top Level Flags for Optional Fields
    var dataOffsetPresent;
    var firstSampleFlagsPresent;
    var sampleDurationPresent;
    var sampleSizePresent;
    var sampleFlagsPresent;
    var sampleCompositionTimeOffsetPresent;
    var i;

    version = view.getUint8(0);
    flags = bytes.subarray(1, 4);
    // 32 bits
    sampleCount = view.getUint32(4);
    i = 8;

    // Flag interpretation
    dataOffsetPresent = flags[2] & 0x01;
    firstSampleFlagsPresent = flags[2] & 0x04;
    // Comparing with 2nd byte of 0x100, 0x200, 0x400, 0x800
    sampleDurationPresent = flags[1] & 0x01;
    sampleSizePresent = flags[1] & 0x02;
    sampleFlagsPresent = flags[1] & 0x04;
    sampleCompositionTimeOffsetPresent = flags[1] & 0x08;

    /**
      * Optional Fields
     **/

    if (dataOffsetPresent) {
      // 32 bit signed integer
      sampleDataOffset += view.getInt32(i);
      i += 4;
    }

    // Overrides the flags for the first sample only
    // The order of optional values will be:
    //   duration, size, compositionTimeOffset
    if (firstSampleFlagsPresent) {
      var firstSampleDuration;
      var firstSampleSize;
      var firstSampleCompositionTimeOffset;
      var firstSampleFlags = bytes.subarray(i, i + 4);

      i += 4;

      if (sampleDurationPresent) {
        firstSampleDuration = view.getUint32(i);
        i += 4;
      }

      if (sampleSizePresent) {
        firstSampleSize = view.getUint32(i);
        i += 4;
      }

      if (sampleCompositionTimeOffsetPresent) {
        firstSampleCompositionTimeOffset = (version === 0) ?
          view.getUint32(i) : view.getInt32(i);
        i += 4;
      }

      samples.push({
        trackId: trackId,
        duration: firstSampleDuration,
        size: firstSampleSize,
        flags: firstSampleFlags,
        compositionTimeOffset: firstSampleCompositionTimeOffset,
        dataOffset: sampleDataOffset,
        dts: currentDts,
        pts: currentDts + firstSampleCompositionTimeOffset
      });

      sampleDataOffset += firstSampleSize;
      currentDts += firstSampleDuration;
    }

    for (var j = 0; j < sampleCount; j++) {
      var sampleDuration;
      var sampleSize;
      var sampleFlags;
      var sampleCompositionTimeOffset;

      if (sampleDurationPresent) {
        sampleDuration = view.getUint32(i);
        i += 4;
      }

      if (sampleSizePresent) {
        sampleSize = view.getUint32(i);
        i += 4;
      }

      if (sampleFlagsPresent) {
        sampleFlags = bytes.subarray(i, i + 4);
        i += 4;
      }

      if (sampleCompositionTimeOffsetPresent) {
        sampleCompositionTimeOffset = (version === 0) ?
          view.getUint32(i) : view.getInt32(i);
        i += 4;
      }

      samples.push({
        trackId: trackId,
        duration: sampleDuration,
        size: sampleSize,
        flags: sampleFlags,
        compositionTimeOffset: sampleCompositionTimeOffset,
        dataOffset: sampleDataOffset,
        dts: currentDts,
        pts: currentDts + sampleCompositionTimeOffset
      });

      // Update data offset, dts
      sampleDataOffset += sampleSize;
      currentDts += sampleDuration;
    }
  });

  return samples;
};

var getVideoTrackIds = function(init) {
  var traks = findBox(init, ['moov', 'trak']);
  var videoTrackIds = [];

  traks.forEach(function(trak) {
    var hdlrs = findBox(trak, ['mdia', 'hdlr']);
    var tkhds = findBox(trak, ['tkhd']);

    hdlrs.forEach(function(hdlr, index) {
      var handlerType = parseHdlr(hdlr).handlerType;
      var trackId = parseTrackId(tkhds[index]);

      if (handlerType === 'vide') {
        videoTrackIds.push(trackId);
      }
    });
  });

  return videoTrackIds;
};

var mapToSample = function(offset, samples) {
  for (var i = 0; i < samples.length - 1; i++) {
    var sample = samples[i];
    var nextSample = samples[i + 1];

    if (sample.dataOffset <= offset &&
        offset < nextSample.dataOffset) {
      return sample;
    }
  }

  return null;
};

var findSeiNals = function(avcStream, samples, trackId) {
  var
    avcView = new DataView(avcStream.buffer, avcStream.byteOffset, avcStream.byteLength),
    result = [],
    seiNal,
    i,
    length;

  for (i = 0; i + 4 < avcStream.length; i += length) {
    length = avcView.getUint32(i);
    i += 4;

    // bail if this doesn't appear to be an H264 stream
    if (length <= 0) {
      continue;
    }

    switch (avcStream[i] & 0x1F) {
    case 0x06:
      var data = avcStream.subarray(i + 1, i + 1 + length);
      seiNal = {
        nalUnitType: 'sei_rbsp',
        size: length,
        data: data,
        escapedRBSP: discardEmulationPreventionBytes(data),
        trackId: trackId
      };
      var matchingSample = mapToSample(i, samples);
      if (matchingSample) {
        seiNal.pts = matchingSample.pts;
        seiNal.dts = matchingSample.dts;
      } else {
        seiNal.pts = 0;
        seiNal.dts = 0;
      }
      result.push(seiNal);
      break;
    default:
      break;
    }
  }

  return result;
};

var parseSamples = function(truns, baseMediaDecodeTime, tfhd) {
  var sampleDataOffset = tfhd.baseDataOffset || 0;
  var currentDts = baseMediaDecodeTime;
  var defaultSampleDuration = tfhd.defaultSampleDuration;
  var defaultSampleSize = tfhd.defaultSampleSize;
  var trackId = tfhd.trackId;
  var allSamples = [];

  truns.forEach(function(trun) {
    var trackRun = parseTrun(trun);
    var samples = trackRun.samples;

    sampleDataOffset += trackRun.dataOffset || 0;

    samples.forEach(function(sample) {
      if (sample.duration === undefined) {
        sample.duration = defaultSampleDuration;
      }
      if (sample.size === undefined) {
        sample.size = defaultSampleSize;
      }
      sample.trackId = trackId;
      sample.dataOffset = sampleDataOffset;
      sample.dts = currentDts;
      sample.pts = currentDts + sample.compositionTimeOffset;

      currentDts += sample.duration;
      sampleDataOffset += sample.size;
    });

    allSamples = allSamples.concat(samples);
  });

  return allSamples;
};

var parseCaptionNals = function(segment, videoTrackIds) {
  // Samples
  var trafs = findBox(segment, ['moof', 'traf']);
  // SEI NAL units
  var mdats = findBox(segment, ['mdat']);
  var captionNals = {};
  var trafMdatPairs = [];

  trafs.forEach(function(traf, index) {
    var matchingMdat = mdats[index];
    trafMdatPairs.push({
      mdat: matchingMdat,
      traf: traf
    });
  });

  trafMdatPairs.forEach(function(pair) {
    var mdat = pair.mdat;
    var traf = pair.traf;
    var tfhd = findBox(traf, ['tfhd']);
    // Exactly 1 tfhd per traf
    var headerInfo = parseTfhd(tfhd[0]);
    var trackId = headerInfo.trackId;
    var tfdt = findBox(traf, ['tfdt']);
    // Either 0 or 1 tfdt per traf
    var baseMediaDecodeTime = (tfdt.length > 0) ? parseTfdt(tfdt[0]).baseMediaDecodeTime : 0;
    var truns = findBox(traf, ['trun']);
    var subs = findBox(traf, ['subs']);
    var samples;
    var subSamples;
    var seiNals;

    // Only parse video data
    if (videoTrackIds.includes(trackId) && truns.length > 0) {
      samples = parseSamples(truns, baseMediaDecodeTime, headerInfo);
      subSamples = subs;
      seiNals = findSeiNals(mdat, samples, trackId);

      if (!captionNals[trackId]) {
        captionNals[trackId] = [];
      }

      captionNals[trackId] = captionNals[trackId].concat(seiNals);
    }
  });

  return captionNals;
};

/**
 * Parses out inband captions from an MP4 container
 *
 * @param {TypedArray} init The init segment
 * @param {TypedArray} segment The fmp4 segment containing imbedded captions
 **/
var parseEmbeddedCaptions = function(init, segment) {
  var captionStreams = [];
  var parsedCaptions = [];
  var videoTrackIds = getVideoTrackIds(init);
  var seiNals = parseCaptionNals(segment, videoTrackIds);
  var timescales = timescale(init);

  // FIXME: should each trak have it's own caption stream?
  videoTrackIds.forEach(function(trackId) {
    var trackTimescale = timescales[trackId];
    var trackSeiNals = seiNals[trackId];
    var captionStream = new CaptionStream();

    // Collect dispatched captions
    captionStream.on('data', function(event) {
      // Convert to seconds
      event.startTime = event.startPts / trackTimescale;
      event.endTime = event.endPts / trackTimescale;

      parsedCaptions.push(event);
    });

    trackSeiNals.forEach(function(nal) {
      captionStream.push(nal);
    });

    // Force the parsed captions to be dispatched
    captionStream.flush();

    captionStreams[trackId] = captionStream;
  });

  return parsedCaptions;
};

module.exports = {
  parse: parseEmbeddedCaptions
};
