/**
 * mux.js
 *
 * Copyright (c) 2015 Brightcove
 * All rights reserved.
 *
 * Utilities to detect basic properties and metadata about MP4s.
 */
'use strict';

var findBox, parseType, timescale, startTime;

// Find the data for a box specified by its path
findBox = function(data, path) {
  var results = [],
      i, size, type, end, subresults;

  if (!path.length) {
    // short-circuit the search for empty paths
    return null;
  }

  for (i = 0; i < data.byteLength;) {
    size  = data[i]     << 24;
    size |= data[i + 1] << 16;
    size |= data[i + 2] << 8;
    size |= data[i + 3];

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
    id = tkhd[index]     << 24 |
         tkhd[index + 1] << 16 |
         tkhd[index + 2] <<  8 |
         tkhd[index + 3];

    mdhd = findBox(trak, ['mdia', 'mdhd'])[0];
    if (!mdhd) {
      return null;
    }
    version = mdhd[0];
    index = version === 0 ? 12 : 20;
    result[id] = mdhd[index]     << 24 |
                 mdhd[index + 1] << 16 |
                 mdhd[index + 2] <<  8 |
                 mdhd[index + 3];
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
      id = tfhd[4] << 24 |
           tfhd[5] << 16 |
           tfhd[6] << 8 |
           tfhd[7];
      // assume a 90kHz clock if no timescale was specified
      scale = timescale[id] || 90e3;

      // get the base media decode time from the tfdt
      baseTime = findBox(traf, ['tfdt']).map(function(tfdt) {
        var version, result;

        version = tfdt[0];
        result = tfdt[4] << 24 |
                 tfdt[5] << 16 |
                 tfdt[6] <<  8 |
                 tfdt[7];
        if (version ===  1) {
          result *= Math.pow(2, 32);
          result += tfdt[8]  << 24 |
                    tfdt[9]  << 16 |
                    tfdt[10] <<  8 |
                    tfdt[11];
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

module.exports = {
  parseType: parseType,
  timescale: timescale,
  startTime: startTime
};
