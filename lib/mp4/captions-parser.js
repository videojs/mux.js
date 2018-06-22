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

/**
  * Parse a trackId out of a Track Header Box.
  *   moov > trak > tkhd
  *
  * @param {Uint8Array} bytes - The bytes from a single tkhd
  * @return {Number} The trackId parsed from this track header box
  *
  * @see ISO-BMFF-12/2015, Section 8.3.2
 **/
var parseTrackId = function(bytes) {
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var version = view.getUint8(0);
  var i = (version === 0) ? 12 : 20;
  var trackId = view.getUint32(i);

  return trackId;
};

/**
  * Find the trackIds of the video tracks in this source.
  * Found by parsing the Handler Reference and Track Header Boxes:
  *   moov > trak > mdia > hdlr
  *   moov > trak > tkhd
  *
  * @param {Uint8Array} init - The bytes of the init segment for this source
  * @return {Number[]} A list of trackIds
  *
  * @see ISO-BMFF-12/2015, Section 8.4.3
 **/
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

/**
  * Maps an offset in the mdat to a sample based on the dataOffset of the sample.
  * Assumes that `parseSamples` has been called first.
  *
  * @param {Number} offset - The offset into the mdat
  * @param {Object[]} samples - An array of samples, parsed using `parseSamples`
  * @return {?Object} The matching sample, or null if no match was found.
  *
  * @see ISO-BMFF-12/2015, Section 8.8.8
 **/
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

/**
  * Finds SEI nal units contained in a Media Data Box.
  * Assumes that `parseSamples` has been called first.
  *
  * @param {Uint8Array} avcStream - The bytes of the mdat
  * @param {Object[]} samples - The samples parsed out by `parseSamples`
  * @param {Number} trackId - The trackId of this video track
  * @return {Object[]} seiNals - the parsed SEI NALUs found.
  *   The contents of the seiNal should match what is expected by
  *   CaptionStream.push (nalUnitType, size, data, escapedRBSP, pts, dts)
  *
  * @see ISO-BMFF-12/2015, Section 8.1.1
  * @see Rec. ITU-T H.264, 7.3.2.3.1
 **/
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

/**
  * Parses sample information out of Track Run Boxes and calculates
  * the presentation and decode timestamps as well as each sample's
  * dataOffset.
  *
  * @param {Array<Uint8Array>} truns - The Trun Run boxes to be parsed
  * @param {Number} baseMediaDecodeTime - base media decode time from tfdt
      @see ISO-BMFF-12/2015, Section 8.8.12
  * @param {Object} tfhd - The parsed Track Fragment Header
  *   @see inspect.parseTfhd
  * @return {Object[]} the parsed samples
  *
  * @see ISO-BMFF-12/2015, Section 8.8.8
 **/
var parseSamples = function(truns, baseMediaDecodeTime, tfhd) {
  var sampleDataOffset = tfhd.baseDataOffset || 0;
  var currentDts = baseMediaDecodeTime;
  var defaultSampleDuration = tfhd.defaultSampleDuration;
  var defaultSampleSize = tfhd.defaultSampleSize;
  var trackId = tfhd.trackId;
  var allSamples = [];

  truns.forEach(function(trun) {
    // Note: We currently do not parse the sample table as well
    // as the trun. It's possible some sources will require this.
    // moov > trak > mdia > minf > stbl
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

/**
  * Parses out caption nals from an FMP4 segment's video tracks.
  *
  * @param {Uint8Array} segment - The bytes of a single segment
  * @param {Array<Number>} videoTrackIds - the trackIds of video tracks in the segment
  * @return {Object.<Number, Object[]>} A mapping of video trackId to
  *   a list of seiNals found in that track
 **/
var parseCaptionNals = function(segment, videoTrackIds) {
  // To get the samples
  var trafs = probe.findBox(segment, ['moof', 'traf']);
  // To get SEI NAL units
  var mdats = probe.findBox(segment, ['mdat']);
  var captionNals = {};
  var trafMdatPairs = [];

  // Pair up each traf with a mdat
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
  * Parses out inband captions from an MP4 container and returns
  * caption objects that can be used by WebVTT and the TextTrack API.
  * @see https://developer.mozilla.org/en-US/docs/Web/API/VTTCue
  * @see https://developer.mozilla.org/en-US/docs/Web/API/TextTrack
  *
  * @param {Uint8Array} init - The init segment
  * @param {Uint8Array} segment - The fmp4 segment containing imbedded captions
  * @return {?Object[]} parsedCaptions - A list of captions or null if no video tracks
  * @return {Number} parsedCaptions[].startTime - The time to show the caption in seconds
  * @return {Number} parsedCaptions[].endTime - The time to stop showing the caption in seconds
  * @return {String} parsedCaptions[].text - The visible content of the caption
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

    // No SEI packets to pass along
    if (!trackSeiNals || trackSeiNals.length === 0) {
      return null;
    }

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
