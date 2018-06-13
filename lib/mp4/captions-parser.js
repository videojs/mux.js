/**
 * mux.js
 *
 * Copyright (c) 2015 Brightcove
 * All rights reserved.
 *
 * Reads in-band CEA-708 captions out of FMP4 segments.
 * @see https://en.wikipedia.org/wiki/CEA-708
 */
'use strict';

var discardEmulationPreventionBytes = require('../tools/cea708-parser').discardEmulationPreventionBytes;
var CaptionStream = require('../m2ts/caption-stream').CaptionStream;
var probe = require('./probe');
var inspect = require('../tools/mp4-inspector');

var parseTrackId = function(bytes) {
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var version = view.getUint8(0);
  var i = (version === 0) ? 12 : 20;
  var trackId = view.getUint32(i);

  return trackId;
};

var getVideoTrackIds = function(init) {
  var traks = probe.findBox(init, ['moov', 'trak']);
  var videoTrackIds = [];

  traks.forEach(function(trak) {
    var hdlrs = probe.findBox(trak, ['mdia', 'hdlr']);
    var tkhds = probe.findBox(trak, ['tkhd']);

    hdlrs.forEach(function(hdlr, index) {
      var handlerType = inspect.parseHdlr(hdlr).handlerType;
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

// FIXME: Do we need to parse the sample table as well?
// moov > trak > mdia > minf > stbl
var parseSamples = function(truns, baseMediaDecodeTime, tfhd) {
  var sampleDataOffset = tfhd.baseDataOffset || 0;
  var currentDts = baseMediaDecodeTime;
  var defaultSampleDuration = tfhd.defaultSampleDuration;
  var defaultSampleSize = tfhd.defaultSampleSize;
  var trackId = tfhd.trackId;
  var allSamples = [];

  truns.forEach(function(trun) {
    var trackRun = inspect.parseTrun(trun);
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
  // To get the samples
  var trafs = probe.findBox(segment, ['moof', 'traf']);
  // To get SEI NAL units
  var mdats = probe.findBox(segment, ['mdat']);
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
    var tfhd = probe.findBox(traf, ['tfhd']);
    // Exactly 1 tfhd per traf
    var headerInfo = inspect.parseTfhd(tfhd[0]);
    var trackId = headerInfo.trackId;
    var tfdt = probe.findBox(traf, ['tfdt']);
    // Either 0 or 1 tfdt per traf
    var baseMediaDecodeTime = (tfdt.length > 0) ? inspect.parseTfdt(tfdt[0]).baseMediaDecodeTime : 0;
    var truns = probe.findBox(traf, ['trun']);
    var samples;
    var seiNals;

    // Only parse video data
    if (videoTrackIds.includes(trackId) && truns.length > 0) {
      samples = parseSamples(truns, baseMediaDecodeTime, headerInfo);

      samples.sort(function(a, b) {
        // This shouldn't ever happen
        if (a.dataOffset === b.dataOffset) {
          return a.pts - b.pts;
        }
        return a.dataOffset - b.dataOffset;
      });

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
  var seiNals;
  var timescales;

  if (videoTrackIds.length === 0) {
    return null;
  }

  seiNals = parseCaptionNals(segment, videoTrackIds);
  timescales = probe.timescale(init);

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
