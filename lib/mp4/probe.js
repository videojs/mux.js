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
var parseSei = require('../m2ts/captions-parser').parseSei;
var CaptionStream = require('../m2ts/caption-stream').CaptionStream;
var findBox, parseType, timescale, startTime, findSeiNals,
  captionNals, captionTracksFromInit, captionTracksFromSegment, parseEmbeddedCaptions;
var parseHandlerType, parseTrackId, parseMdhd, parseLanguage;
var parseDecodeTime, parseTfhd, parseSamples;
var mapToSample;
var discardEmulationPreventionBytes;

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
    var nextSample = samples[i+1];

    if (sample.dataOffset <= offset &&
        offset < nextSample.dataOffset) {
      return sample;
    }
  }

  return null;
};

discardEmulationPreventionBytes = function(data) {
    var
      length = data.byteLength,
      emulationPreventionBytesPositions = [],
      i = 1,
      newLength, newData;

    // Find all `Emulation Prevention Bytes`
    while (i < length - 2) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0x03) {
        emulationPreventionBytesPositions.push(i + 2);
        i += 2;
      } else {
        i++;
      }
    }

    // If no Emulation Prevention Bytes were found just return the original
    // array
    if (emulationPreventionBytesPositions.length === 0) {
      return data;
    }

    // Create a new array to hold the NAL unit data
    newLength = length - emulationPreventionBytesPositions.length;
    newData = new Uint8Array(newLength);
    var sourceIndex = 0;

    for (i = 0; i < newLength; sourceIndex++, i++) {
      if (sourceIndex === emulationPreventionBytesPositions[0]) {
        // Skip this byte
        sourceIndex++;
        // Remove this position index
        emulationPreventionBytesPositions.shift();
      }
      newData[i] = data[sourceIndex];
    }

    return newData;
};

findSeiNals = function(avcStream, sampleTable, trackId) {
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
      var matchingSample = mapToSample(i, sampleTable.samples);
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

captionNals = function(fragment, sampleTable) {
  var captionNals = [];
  var mdat = findBox(fragment, ['mdat']);

  for (var i = 0; i < mdat.length; i++) {
    // mdat and moof pair
    captionNals = captionNals.concat(findSeiNals(mdat[i], sampleTable[i].samples, sampleTable[i].trackId));
  }

  return captionNals;
};

// @param language A 16 bit integer
parseLanguage = function(language) {
  var lang = '';

  // Take 6 most significant bits and add back 0x60
  lang += String.fromCharCode((language >> 10) + 0x60);
  lang += String.fromCharCode(((language & 0x03e0) >> 5) + 0x60);
  lang += String.fromCharCode((language & 0x1f) + 0x60);

  return lang;
};

parseMdhd = function(bytes) {
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var version = view.getUint8(0);
  var flags = bytes.subarray(1, 4);
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

  var i = (version === 0) ? 20 : 32;
  // an array of 3 5-bit fields
  var languageByte = view.getUint16(i);
  var language = parseLanguage(languageByte);

  return {
    creationTime: creationTime,
    modificationTime: modificationTime,
    timescale: timescale,
    duration: duration,
    language: language
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

captionTracksFromInit = function(initSegment) {
  var traks = findBox(initSegment, ['moov', 'trak']);
  var result = {};

  for (var i = 0; i < traks.length; i++) {
    var trak = traks[i];
    var trakResult;

    var mdia = findBox(trak, ['mdia']);
    var tkhd = findBox(trak, ['tkhd']);

    // 1 per trak
    var hdlr = findBox(mdia[0], ['hdlr']);
    var stbl = findBox(mdia[0], ['minf', 'stbl']);
    var mdhd = findBox(mdia[0], ['mdhd']);

    var parsedMdhd = parseMdhd(mdhd[0]);

    trakResult = {
      // 1 per mdia
      trackId: parseTrackId(tkhd[0]),
      // 1 per trak
      language: parsedMdhd.language,
      timescale: parsedMdhd.timescale,
      duration: parsedMdhd.duration,
      // 1 per mdia
      handlerType: parseHandlerType(hdlr[0]),
      stbl: stbl[0]
    };

    result[i] = trakResult;
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

  // 24 bits, skip version
  result.flags = bytes.subarray(1, 4);
  // 32 bits
  result.trackId = view.getUint32(4);

  var baseDataOffsetPresent = result.flags[2] & 0x01;
  var sampleDescriptionsIndexPresent = result.flags[2] & 0x02;
  var defaultSampleDurationPresent = result.flags[2] & 0x08;
  var defaultSampleSizePresent = result.flags[2] & 0x10;
  var defaultSampleFlagsPresent = result.flags[2] & 0x20;
  // TODO: Do we actually need these two?
  var durationIsEmpty = result.flags[0] & 0x010000;
  var defaultBaseIsMoof =  result.flags[0] & 0x020000;
  var i = 8;

  // optional
  if (baseDataOffsetPresent) {
    // 64 bits
    result.baseDataOffset = bytes.subarray(i, i+8);
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
  var result = {
    version: view.getUint8(0),
    flags: bytes.subarray(1, 4),
    samples: []
  };
  var currentDts = baseMediaDecodeTime;
  var currentPts;
  // FIXME: set to baseDataOffset (from moof and tfhd)
  var sampleDataOffset = tfhd.baseDataOffset || 0;
  var defaultSampleDuration = tfhd.defaultSampleDuration;
  var defaultSampleSize = tfhd.defaultSampleSize;
  var defaultSampleFlags = tfhd.defaultSampleFlags;

  // 32 bits
  var sampleCount = view.getUint32(4);
  result.sampleCount = sampleCount;

  // Flag interpretation
  var dataOffsetPresent = result.flags[2] & 0x01;
  var firstSampleFlagsPresent = result.flags[2] & 0x04;
  // 2nd byte of 0x100, 0x200, 0x400, 0x800
  var sampleDurationPresent = result.flags[1] & 0x01;
  var sampleSizePresent = result.flags[1] & 0x02;
  var sampleFlagsPresent = result.flags[1] & 0x04;
  var sampleCompositionTimeOffsetPresent = result.flags[1] & 0x08;
  var i = 8;

  // optional
  if (dataOffsetPresent) {
    // 32 signed
    result.dataOffset = view.getInt32(i);
    sampleDataOffset += result.dataOffset;
    i += 4;
  }

  // Overrides the flags for the first sample only
  if (firstSampleFlagsPresent) {
    var firstSampleDuration;
    var firstSampleSize;
    var firstSampleCompositionTimeOffset;

    var firstSampleFlags = bytes.subarray(i, i + 4);
    i += 4;

    // FIXME: are you meant to parse out the duration, size, flags,
    // composition time offset here too?
    if (sampleDurationPresent) {
      firstSampleDuration = view.getUint32(i);
      i += 4;
    }

    if (sampleSizePresent) {
      firstSampleSize = view.getUint32(i);
      i += 4;
    }

    if (sampleCompositionTimeOffsetPresent) {
      firstSampleCompositionTimeOffset = (result.version === 0) ?
        // TODO: unsigned or signed?
        view.getUint32(i) : view.getUint32(i);
      i += 4;
    }

    result.samples.push({
      trackId: headerInfo.trackId,
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

  // Build a sample table
  // TODO:
  // - dataOffset for each sample [DONE]
  // - pts/cts [MAYBE?]
  // - dts [MAYBE?]
  for (var j = 0; j < sampleCount; j++) {
    var sampleDuration;
    var sampleSize;
    var sampleFlags;
    var sampleCompositionTimeOffset;
    var dataOffset;

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
      sampleCompositionTimeOffset = (result.version === 0) ?
        // TODO: unsigned or signed?
        view.getUint32(i) : view.getInt32(i);
      i += 4;
    }

    result.samples.push({
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

  return result;
};

captionTracksFromSegment = function(segment, init) {
  var trafs = findBox(segment, ['moof', 'traf']);
  var result = {};

  for (var i = 0; i < trafs.length; i++) {
    var traf = trafs[i];
    var trafResult;

    var tfhd = findBox(traf, ['tfhd']);
    var tfdt = findBox(traf, ['tfdt']);
    var trun = findBox(traf, ['trun']);
    var subs = findBox(traf, ['subs']);

    var headerInfo = parseTfhd(tfhd[0]);
    var baseMediaDecodeTime = parseDecodeTime(tfdt[0]);

    trafResult = {
      trackId: headerInfo.trackId,
      headerFlags: headerInfo.flags,
      baseDataOffset: headerInfo.baseDataOffset,
      baseMediaDecodeTime: baseMediaDecodeTime,
      samples: parseSamples(trun[0], baseMediaDecodeTime, headerInfo, init.timescale),
      subSamples: subs
    }

    result[i] = trafResult;
  }

  return result;
};

parseEmbeddedCaptions = function(init, segment) {
  var initInfo = captionTracksFromInit(init);
  var segmentInfo = captionTracksFromSegment(segment, initInfo[0]);
  var seiNals = captionNals(segment, segmentInfo);
  var captionStream = new CaptionStream();
  var parsedCaptions = [];

  captionStream.on('data', function(event) {
    parsedCaptions.push(event);
  });

  for (var i = 0; i < seiNals.length; i++) {
    var nal = seiNals[i];
    captionStream.push(nal);
  }

  captionStream.flush();

  return parsedCaptions;
};

module.exports = {
  parseType: parseType,
  timescale: timescale,
  startTime: startTime,
  captionNals: captionNals,
  captionTracksFromInit: captionTracksFromInit,
  captionTracksFromSegment: captionTracksFromSegment,
  parseEmbeddedCaptions: parseEmbeddedCaptions
};
