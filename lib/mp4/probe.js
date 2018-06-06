/**
 * mux.js
 *
 * Copyright (c) 2015 Brightcove
 * All rights reserved.
 *
 * Utilities to detect basic properties and metadata about MP4s.
 */
'use strict';

var toUnsigned = require('../utils/bin').toUnsigned;
var discardEmulationPreventionBytes = require('../m2ts/captions-parser').discardEmulationPreventionBytes;
var CaptionStream = require('../m2ts/caption-stream').CaptionStream;
var findBox, parseType, timescale, startTime,
  findSeiNals, mapToSample, parseSamples,
  parseHandlerType, parseTrackId, parseMdhd, parseDecodeTime, parseTfhd,
  parseInitForCaptionMetadata, parseCaptionNals, parseEmbeddedCaptions;

// Find the data for a box specified by its path
findBox = function(data, path) {
  var results = [],
      i, size, type, end, subresults;

  if (!path.length) {
    // short-circuit the search for empty paths
    return null;
  }

  for (i = 0; i < data.byteLength;) {
    size  = toUnsigned(data[i]     << 24 |
                       data[i + 1] << 16 |
                       data[i + 2] <<  8 |
                       data[i + 3]);

    type = parseType(data.subarray(i + 4, i + 8));

    end = size > 1 ? i + size : data.byteLength;

    if (type === path[0]) {
      if (path.length === 1) {
        // this is the end of the path and we've found the box we were
        // looking for
        results.push(data.subarray(i + 8, end));
      } else {
        // recursively search for the next box along the path
        subresults = findBox(data.subarray(i + 8, end), path.slice(1));
        if (subresults.length) {
          results = results.concat(subresults);
        }
      }
    }
    i = end;
  }

  // we've finished searching all of data
  return results;
};

/**
 * Returns the string representation of an ASCII encoded four byte buffer.
 * @param buffer {Uint8Array} a four-byte buffer to translate
 * @return {string} the corresponding string
 */
parseType = function(buffer) {
  var result = '';
  result += String.fromCharCode(buffer[0]);
  result += String.fromCharCode(buffer[1]);
  result += String.fromCharCode(buffer[2]);
  result += String.fromCharCode(buffer[3]);
  return result;
};

/**
 * Parses an MP4 initialization segment and extracts the timescale
 * values for any declared tracks. Timescale values indicate the
 * number of clock ticks per second to assume for time-based values
 * elsewhere in the MP4.
 *
 * To determine the start time of an MP4, you need two pieces of
 * information: the timescale unit and the earliest base media decode
 * time. Multiple timescales can be specified within an MP4 but the
 * base media decode time is always expressed in the timescale from
 * the media header box for the track:
 * ```
 * moov > trak > mdia > mdhd.timescale
 * ```
 * @param init {Uint8Array} the bytes of the init segment
 * @return {object} a hash of track ids to timescale values or null if
 * the init segment is malformed.
 */
timescale = function(init) {
  var
    result = {},
    traks = findBox(init, ['moov', 'trak']);

  // mdhd timescale
  return traks.reduce(function(result, trak) {
    var tkhd, version, index, id, mdhd;

    tkhd = findBox(trak, ['tkhd'])[0];
    if (!tkhd) {
      return null;
    }
    version = tkhd[0];
    index = version === 0 ? 12 : 20;
    id = toUnsigned(tkhd[index]     << 24 |
                    tkhd[index + 1] << 16 |
                    tkhd[index + 2] <<  8 |
                    tkhd[index + 3]);

    mdhd = findBox(trak, ['mdia', 'mdhd'])[0];
    if (!mdhd) {
      return null;
    }
    version = mdhd[0];
    index = version === 0 ? 12 : 20;
    result[id] = toUnsigned(mdhd[index]     << 24 |
                            mdhd[index + 1] << 16 |
                            mdhd[index + 2] <<  8 |
                            mdhd[index + 3]);
    return result;
  }, result);
};

/**
 * Determine the base media decode start time, in seconds, for an MP4
 * fragment. If multiple fragments are specified, the earliest time is
 * returned.
 *
 * The base media decode time can be parsed from track fragment
 * metadata:
 * ```
 * moof > traf > tfdt.baseMediaDecodeTime
 * ```
 * It requires the timescale value from the mdhd to interpret.
 *
 * @param timescale {object} a hash of track ids to timescale values.
 * @return {number} the earliest base media decode start time for the
 * fragment, in seconds
 */
startTime = function(timescale, fragment) {
  var trafs, baseTimes, result;

  // we need info from two childrend of each track fragment box
  trafs = findBox(fragment, ['moof', 'traf']);

  // determine the start times for each track
  baseTimes = [].concat.apply([], trafs.map(function(traf) {
    return findBox(traf, ['tfhd']).map(function(tfhd) {
      var id, scale, baseTime;

      // get the track id from the tfhd
      id = toUnsigned(tfhd[4] << 24 |
                      tfhd[5] << 16 |
                      tfhd[6] <<  8 |
                      tfhd[7]);
      // assume a 90kHz clock if no timescale was specified
      scale = timescale[id] || 90e3;

      // get the base media decode time from the tfdt
      baseTime = findBox(traf, ['tfdt']).map(function(tfdt) {
        var version, result;

        version = tfdt[0];
        result = toUnsigned(tfdt[4] << 24 |
                            tfdt[5] << 16 |
                            tfdt[6] <<  8 |
                            tfdt[7]);
        if (version ===  1) {
          result *= Math.pow(2, 32);
          result += toUnsigned(tfdt[8]  << 24 |
                               tfdt[9]  << 16 |
                               tfdt[10] <<  8 |
                               tfdt[11]);
        }
        return result;
      })[0];
      baseTime = baseTime || Infinity;

      // convert base time to seconds
      return baseTime / scale;
    });
  }));

  // return the minimum
  result = Math.min.apply(null, baseTimes);
  return isFinite(result) ? result : 0;
};

mapToSample = function(offset, samples) {
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

findSeiNals = function(avcStream, samples, trackId) {
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

parseMdhd = function(bytes) {
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

parseTrackId = function(bytes) {
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var version = view.getUint8(0);
  var i = (version === 0) ? 12 : 20;
  var trackId = view.getUint32(i);

  return trackId;
};

parseHandlerType = function(bytes) {
  // 32 bits, skip the version, flags, predefined 0
  var handlerType = parseType(bytes.subarray(8, 12));
  var name = '';

  // skip reserved integers
  for (var i = 24; i < bytes.length; i++) {
    // found null byte
    if (bytes[i] === 0x00) {
      break;
    }
    name += String.fromCharCode(bytes[i]);
  }

  // FIXME: I don't think name is right for the label

  return handlerType;
};

parseInitForCaptionMetadata = function(initSegment) {
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
    var handlerType = parseHandlerType(hdlr[0]);

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
      stbl: stbl[0]
    };

    result[trackId] = trakResult;
  }

  return result;
};

parseDecodeTime = function(bytes) {
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var version = view.getUint8(0);
  // An  integer  equal  to  the  sum  of  the  decode  durations
  // of  all  earlier  samples in the media, expressed in the
  // media's timescale. It does not include the samples added
  // in the enclosing track fragment.
  var baseMediaDecodeTime = view.getUint32(4);

  // FIXME: double check if this is correct?
  if (version === 1) {
    baseMediaDecodeTime *= Math.pow(2, 32);
  }

  return baseMediaDecodeTime;
};

parseTfhd = function(bytes) {
  var result = {};
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var flags;
  // Parsed Flags
  var baseDataOffsetPresent;
  var sampleDescriptionsIndexPresent;
  var defaultSampleDurationPresent;
  var defaultSampleSizePresent;
  var defaultSampleFlagsPresent;
  var durationIsEmpty;
  var defaultBaseIsMoof;
  var i;

  // 24 bits, skip version
  flags = bytes.subarray(1, 4);
  // 32 bits
  result.trackId = view.getUint32(4);

  baseDataOffsetPresent = flags[2] & 0x01;
  sampleDescriptionsIndexPresent = flags[2] & 0x02;
  defaultSampleDurationPresent = flags[2] & 0x08;
  defaultSampleSizePresent = flags[2] & 0x10;
  defaultSampleFlagsPresent = flags[2] & 0x20;
  // FIXME: Do we actually need these two?
  durationIsEmpty = flags[0] & 0x010000;
  defaultBaseIsMoof =  flags[0] & 0x020000;
  i = 8;

  // These are optional values
  if (baseDataOffsetPresent) {
    // 64 bits
    result.baseDataOffset = bytes.subarray(i, i + 8);
    i += 8;
  }

  if (sampleDescriptionsIndexPresent) {
    // 32 bits
    result.sampleDescriptionsIndex = view.getUint32(i);
    i += 4;
  }

  if (defaultSampleDurationPresent) {
    result.defaultSampleDuration = view.getUint32(i);
    i += 4;
  }

  if (defaultSampleSizePresent) {
    result.defaultSampleSize = view.getUint32(i);
    i += 4;
  }

  if (defaultSampleFlagsPresent) {
    result.defaultSampleFlags = view.getUint32(i);
  }

  return result;
};

parseSamples = function(bytes, baseMediaDecodeTime, tfhd, timescale) {
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var samples = [];

  // Default values for samples
  var sampleDataOffset = tfhd.baseDataOffset || 0; // FIXME: set to baseDataOffset (from moof and tfhd)
  // FIXME: need to actually use these as defaults now
  var defaultSampleDuration = tfhd.defaultSampleDuration;
  var defaultSampleSize = tfhd.defaultSampleSize;
  var defaultSampleFlags = tfhd.defaultSampleFlags;
  var trackId = tfhd.trackId;

  // Initialize decode time stamp
  var currentDts = baseMediaDecodeTime;
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

  return samples;
};

parseCaptionNals = function(segment, timescale) {
  // Samples
  var trafs = findBox(segment, ['moof', 'traf']);
  var sampleInfo = {};
  // SEI NAL units
  var mdats = findBox(segment, ['mdat']);
  var captionNals = [];

  // Parse moofs for the sample table
  trafs.forEach(function(traf, index) {
    var trafResult;

    var tfhd = findBox(traf, ['tfhd']);
    var tfdt = findBox(traf, ['tfdt']);
    var trun = findBox(traf, ['trun']);
    var subs = findBox(traf, ['subs']);

    var headerInfo = parseTfhd(tfhd[0]);
    var baseMediaDecodeTime = parseDecodeTime(tfdt[0]);

    trafResult = {
      trackId: headerInfo.trackId,
      samples: parseSamples(trun[0], baseMediaDecodeTime, headerInfo, timescale),
      subSamples: subs
    };

    sampleInfo[index] = trafResult;
  });

  // Parse mdats for SEI messages
  mdats.forEach(function(mdat, index) {
    // mdat and moof paired by index
    var samples = sampleInfo[index].samples;
    var trackId = sampleInfo[index].trackId;
    var seiNals = findSeiNals(mdat, samples, trackId);

    captionNals = captionNals.concat(seiNals);
  });

  return captionNals;
};

/**
 * Parses out inband captions from an MP4 container
 *
 * @param {TypedArray} init The init segment
 * @param {TypedArray} segment The fmp4 segment containing imbedded captions
 **/
parseEmbeddedCaptions = function(init, segment) {
  // FIXME: should each trak have it's own caption stream?
  var captionStreams = [];
  var parsedCaptions = [];
  // Parse out media header information for ISOBMFF video tracks
  var initInfo = parseInitForCaptionMetadata(init);

  // Parse out 608/708 caption NAL units from segment
  for (var trackId in initInfo) {
    var trakInfo = initInfo[trackId];
    var timescale = trakInfo.timescale;
    var seiNals = parseCaptionNals(segment, timescale);
    var captionStream = new CaptionStream();

    // Collect dispatched captions
    captionStream.on('data', function(event) {
      // Convert to seconds
      event.startTime = event.startPts / timescale;
      event.endTime = event.endPts / timescale;

      parsedCaptions.push(event);
    });

    seiNals.forEach(function(nal) {
      captionStream.push(nal);
    });

    // Force the parsed captions to be dispatched
    captionStream.flush();

    captionStreams[trackId] = captionStream;
  }

  return parsedCaptions;
};

module.exports = {
  parseType: parseType,
  timescale: timescale,
  startTime: startTime,
  parseEmbeddedCaptions: parseEmbeddedCaptions
};
