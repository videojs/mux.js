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

var discardEmulationPreventionBytes = require('../tools/caption-packet-parser').discardEmulationPreventionBytes;
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
  * Maps an offset in the mdat to a sample based on the the size of the samples.
  * Assumes that `parseSamples` has been called first.
  *
  * @param {Number} offset - The offset into the mdat
  * @param {Object[]} samples - An array of samples, parsed using `parseSamples`
  * @return {?Object} The matching sample, or null if no match was found.
  *
  * @see ISO-BMFF-12/2015, Section 8.8.8
 **/
var mapToSample = function(offset, samples) {
  var approximateOffset = offset;

  for (var i = 0; i < samples.length; i++) {
    var sample = samples[i];

    if (approximateOffset < sample.size) {
      return sample;
    }

    approximateOffset -= sample.size;
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
    length,
    lastMatchedSample;

  for (i = 0; i + 4 < avcStream.length; i += length) {
    length = avcView.getUint32(i);
    i += 4;

    // Bail if this doesn't appear to be an H264 stream
    if (length <= 0) {
      continue;
    }

    switch (avcStream[i] & 0x1F) {
    case 0x06:
      var data = avcStream.subarray(i + 1, i + 1 + length);
      var matchingSample = mapToSample(i, samples);

      seiNal = {
        nalUnitType: 'sei_rbsp',
        size: length,
        data: data,
        escapedRBSP: discardEmulationPreventionBytes(data),
        trackId: trackId
      };

      if (matchingSample) {
        seiNal.pts = matchingSample.pts;
        seiNal.dts = matchingSample.dts;
        lastMatchedSample = matchingSample;
      } else {
        // If a matching sample cannot be found, use the last
        // sample's values as they should be as close as possible
        seiNal.pts = lastMatchedSample.pts;
        seiNal.dts = lastMatchedSample.dts;
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
  * the absolute presentation and decode timestamps of each sample.
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
  var currentDts = baseMediaDecodeTime;
  var defaultSampleDuration = tfhd.defaultSampleDuration || 0;
  var defaultSampleSize = tfhd.defaultSampleSize || 0;
  var trackId = tfhd.trackId;
  var allSamples = [];

  truns.forEach(function(trun) {
    // Note: We currently do not parse the sample table as well
    // as the trun. It's possible some sources will require this.
    // moov > trak > mdia > minf > stbl
    var trackRun = inspect.parseTrun(trun);
    var samples = trackRun.samples;

    samples.forEach(function(sample) {
      if (sample.duration === undefined) {
        sample.duration = defaultSampleDuration;
      }
      if (sample.size === undefined) {
        sample.size = defaultSampleSize;
      }
      sample.trackId = trackId;
      sample.dts = currentDts;
      if (sample.compositionTimeOffset === undefined) {
        sample.compositionTimeOffset = 0;
      }
      sample.pts = currentDts + sample.compositionTimeOffset;

      currentDts += sample.duration;
    });

    allSamples = allSamples.concat(samples);
  });

  return allSamples;
};

/**
  * Parses out caption nals from an FMP4 segment's video tracks.
  *
  * @param {Uint8Array} segment - The bytes of a single segment
  * @param {Number} videoTrackId - The trackId of a video track in the segment
  * @return {Object.<Number, Object[]>} A mapping of video trackId to
  *   a list of seiNals found in that track
 **/
var parseCaptionNals = function(segment, videoTrackId) {
  // To get the samples
  var trafs = probe.findBox(segment, ['moof', 'traf']);
  // To get SEI NAL units
  var mdats = probe.findBox(segment, ['mdat']);
  var captionNals = {};
  var mdatTrafPairs = [];

  // Pair up each traf with a mdat as moofs and mdats are in pairs
  mdats.forEach(function(mdat, index) {
    var matchingTraf = trafs[index];
    mdatTrafPairs.push({
      mdat: mdat,
      traf: matchingTraf
    });
  });

  mdatTrafPairs.forEach(function(pair) {
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

    // Only parse video data for the chosen video track
    if (videoTrackId === trackId && truns.length > 0) {
      samples = parseSamples(truns, baseMediaDecodeTime, headerInfo);

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
  * Assumes that `getVideoTrackIds` and `probe.timescale` have been called first
  *
  * @param {Uint8Array} segment - The fmp4 segment containing imbedded captions
  * @param {Number} trackId - A list of video tracks found in the init segment
  * @param {Number} timescale - The timescale for a video track in milliseconds
  *
  * @return {?Object[]} parsedCaptions - A list of captions or null if no video tracks
  * @return {Number} parsedCaptions[].startTime - The time to show the caption in seconds
  * @return {Number} parsedCaptions[].endTime - The time to stop showing the caption in seconds
  * @return {String} parsedCaptions[].text - The visible content of the caption
 **/
var parseEmbeddedCaptions = function(segment, trackId, timescale) {
  var seiNals;

  if (!trackId) {
    return null;
  }

  seiNals = parseCaptionNals(segment, trackId);

  return {
    seiNals: seiNals[trackId],
    timescale: timescale
  };
};

/**
  * Converts SEI NALUs into captions that can be used by video.js
 **/
var CaptionParser = function() {
  var isInitialized = false;
  var captionStream = null;

  // Stores an init segment
  var initSegment = null;
  // Stores segments seen before init segment received
  var segmentCache = [];

  // Stores video track ID of the track being parsed
  var trackId = null;
  // Stores the timescale of the track being parsed
  var timescale = null;
  // Stores captions parsed so far
  var parsedCaptions = {
    captions: [],
    // CC1, CC2, CC3, CC4
    captionStreams: {}
  };

  /**
    * A method to indicate whether a CaptionParser has been initalized
    * @returns {Boolean}
   **/
  this.isInitialized = function() {
    return isInitialized;
  };

  /**
    * Initializes the underlying CaptionStream, SEI NAL parsing
    * and management, and caption collection
   **/
  this.init = function() {
    captionStream = new CaptionStream();
    isInitialized = true;

    // Collect dispatched captions
    captionStream.on('data', function(event) {
      // Convert to seconds in the source's timescale
      event.startTime = event.startPts / timescale;
      event.endTime = event.endPts / timescale;

      parsedCaptions.captions.push(event);
      parsedCaptions.captionStreams[event.stream] = true;
    });
  };

  /**
    * Parses out SEI captions and interacts with underlying
    * CaptionStream to return dispatched captions
    * @see parseEmbeddedCaptions
    * @see m2ts/caption-stream.js
   **/
  this.parse = function(segment) {
    var parsedData;

    // If an init segment has not been seen yet, hold onto segment
    // data until an init segment is set
    if (!this.isInitialized()) {
      return null;
    } else if (!initSegment) {
      segmentCache.push(segment);
      return null;
    }

    parsedData = parseEmbeddedCaptions(segment, trackId, timescale);

    if (parsedData === null || !parsedData.seiNals) {
      return null;
    }

    this.pushNals(parsedData.seiNals);
    // Force the parsed captions to be dispatched
    this.flushStream();

    return parsedCaptions;
  };

  /**
    * Sets an init segment that will be reused to parse
    * subsequent segments for captions
   **/
  this.setInitSegment = function(init) {
    var videoTrackIds;
    var timescales;

    initSegment = init;
    videoTrackIds = getVideoTrackIds(initSegment);
    timescales = probe.timescale(initSegment);

    // Use the first video track only as there is no
    // mechanism to switch to other video tracks
    trackId = videoTrackIds[0];
    timescale = timescales[trackId];

    // There are no parsed captions to return
    if (segmentCache.length === 0) {
      return null;

    } else if (!this.isInitialized()) {
      return null;
    }

    // Now that an init segment is available, parse captions
    segmentCache.forEach(function(segment) {
      this.parse(segment);
    }, this);
    segmentCache = [];

    return parsedCaptions;
  };

  /**
    * Pushes SEI NALUs onto CaptionStream
    * @param {Object[]} nals - A list of SEI nals parsed using `parseCaptionNals`
    * Assumes that `parseCaptionNals` has been called first
    * @see m2ts/caption-stream.js
    **/
  this.pushNals = function(nals) {
    if (!this.isInitialized() || !nals || nals.length === 0) {
      return null;
    }

    nals.forEach(function(nal) {
      captionStream.push(nal);
    });
  };

  /**
    * Flushes underlying CaptionStream to dispatch processed, displayable captions
    * @see m2ts/caption-stream.js
   **/
  this.flushStream = function() {
    if (!this.isInitialized()) {
      return null;
    }

    captionStream.flush();
  };

  /**
    * Reset caption buckets for new data
   **/
  this.resetStoredCaptions = function() {
    parsedCaptions.captions = [];
    parsedCaptions.captionStreams = {};
  };

  /**
    * Resets underlying CaptionStream
    * @see m2ts/caption-stream.js
   **/
  this.resetCaptionStream = function() {
    if (!this.isInitialized()) {
      return null;
    }

    captionStream.reset();
  };

  /**
    * Reset caption parser
   **/
  this.reset = function() {
    isInitialized = false;
    initSegment = null;
    trackId = null;
    timescale = null;

    this.resetCaptionStream();
    this.resetStoredCaptions();
  };
};

module.exports = CaptionParser;
