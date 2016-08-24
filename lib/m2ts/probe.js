/**
 * mux.js
 *
 * Copyright (c) 2016 Brightcove
 * All rights reserved.
 *
 * Utilities to detect basic properties and metadata about TS Segments.
 */
'use strict';

var StreamTypes = require('./stream-types.js');
var
  MP2T_PACKET_LENGTH = 188, // bytes
  SYNC_BYTE = 0x47;

var parsePid = function(packet) {
  var pid = packet[1] & 0x1f;
  pid <<= 8;
  pid |= packet[2];
  return pid;
};

var parseAdaptionField = function(packet) {
  var offset = 0;
  // if an adaption field is present, its length is specified by the
  // fifth byte of the TS packet header. The adaptation field is
  // used to add stuffing to PES packets that don't fill a complete
  // TS packet, and to specify some forms of timing and control data
  // that we do not currently use.
  if (((packet[3] & 0x30) >>> 4) > 0x01) {
    offset += packet[4] + 1;
  }
  return offset;
};

var parseType = function(packet, pmtPid) {
  var pid = parsePid(packet);
  if (pid === 0) {
    return 'pat';
  } else if (pid === pmtPid) {
    return 'pmt';
  } else if (pmtPid) {
    return 'pes';
  } else {
    return null;
  }
};

var parsePat = function(packet) {
  var pusi = parsePayloadUnitStartIndicator(packet);
  var offset = 4 + parseAdaptionField(packet);

  if (pusi) {
    offset += packet[offset] + 1;
  }

  return (packet[offset + 10] & 0x1f) << 8 | packet[offset + 11];
};

var parsePmt = function(packet) {
  var programMapTable = {};
  var pusi = parsePayloadUnitStartIndicator(packet);
  var offset = 4 + parseAdaptionField(packet);

  if (pusi) {
    offset += packet[offset] + 1;
  }

  var payload = packet.subarray(offset);

  // PMTs can be sent ahead of the time when they should actually
  // take effect. We don't believe this should ever be the case
  // for HLS but we'll ignore "forward" PMT declarations if we see
  // them. Future PMT declarations have the current_next_indicator
  // set to zero.
  if (!(payload[5] & 0x01)) {
    return;
  }

  var sectionLength, tableEnd, programInfoLength;
  // the mapping table ends at the end of the current section
  sectionLength = (payload[1] & 0x0f) << 8 | payload[2];
  tableEnd = 3 + sectionLength - 4;

  // to determine where the table is, we have to figure out how
  // long the program info descriptors are
  programInfoLength = (payload[10] & 0x0f) << 8 | payload[11];

  // advance the offset to the first entry in the mapping table
  offset = 12 + programInfoLength;
  while (offset < tableEnd) {
    // add an entry that maps the elementary_pid to the stream_type
    programMapTable[(payload[offset + 1] & 0x1F) << 8 | payload[offset + 2]] = payload[offset];

    // move to the next table entry
    // skip past the elementary stream descriptors, if present
    offset += ((payload[offset + 3] & 0x0F) << 8 | payload[offset + 4]) + 5;
  }
  return programMapTable;
};

var parsePayloadUnitStartIndicator = function(packet) {
  return !!(packet[1] & 0x40);
};

var parsePesType = function(packet, programMapTable) {
  var pid = parsePid(packet);
  var type = programMapTable[pid];
  switch (type) {
    case StreamTypes.H264_STREAM_TYPE:
      return 'video';
    case StreamTypes.ADTS_STREAM_TYPE:
      return 'audio';
    case StreamTypes.METADATA_STREAM_TYPE:
      return 'timed-metadata';
    default:
      return null;
  }
};

var parsePesTime = function(packet) {
  var pusi = parsePayloadUnitStartIndicator(packet);
  if (!pusi) {
    return null;
  }

  var offset = 4 + parseAdaptionField(packet);
  var payload = packet.subarray(offset);

  var pes = {};
  var ptsDtsFlags;

  // find out if this packets starts a new keyframe
  pes.dataAlignmentIndicator = (payload[6] & 0x04) !== 0;
  // PES packets may be annotated with a PTS value, or a PTS value
  // and a DTS value. Determine what combination of values is
  // available to work with.
  ptsDtsFlags = payload[7];

  // PTS and DTS are normally stored as a 33-bit number.  Javascript
  // performs all bitwise operations on 32-bit integers but javascript
  // supports a much greater range (52-bits) of integer using standard
  // mathematical operations.
  // We construct a 31-bit value using bitwise operators over the 31
  // most significant bits and then multiply by 4 (equal to a left-shift
  // of 2) before we add the final 2 least significant bits of the
  // timestamp (equal to an OR.)
  if (ptsDtsFlags & 0xC0) {
    // the PTS and DTS are not written out directly. For information
    // on how they are encoded, see
    // http://dvd.sourceforge.net/dvdinfo/pes-hdr.html
    pes.pts = (payload[9] & 0x0E) << 27 |
      (payload[10] & 0xFF) << 20 |
      (payload[11] & 0xFE) << 12 |
      (payload[12] & 0xFF) <<  5 |
      (payload[13] & 0xFE) >>>  3;
    pes.pts *= 4; // Left shift by 2
    pes.pts += (payload[13] & 0x06) >>> 1; // OR by the two LSBs
    pes.dts = pes.pts;
    if (ptsDtsFlags & 0x40) {
      pes.dts = (payload[14] & 0x0E) << 27 |
        (payload[15] & 0xFF) << 20 |
        (payload[16] & 0xFE) << 12 |
        (payload[17] & 0xFF) << 5 |
        (payload[18] & 0xFE) >>> 3;
      pes.dts *= 4; // Left shift by 2
      pes.dts += (payload[18] & 0x06) >>> 1; // OR by the two LSBs
    }
  }
  return pes;
};

var videoPacketContainsIframe = function(packet) {
  var pusi = parsePayloadUnitStartIndicator(packet);
  var offset = 4 + parseAdaptionField(packet);
  var buffer = packet.subarray(offset);
  var syncPoint = 0;
  var i = 0;

  // advance the sync point to a NAL start, if necessary
  for (; syncPoint < buffer.byteLength - 3; syncPoint++) {
    if (buffer[syncPoint + 2] === 1) {
      // the sync point is properly aligned
      i = syncPoint + 5;
      break;
    }
  }

  while (i < buffer.byteLength) {
    // look at the current byte to determine if we've hit the end of
    // a NAL unit boundary
    switch (buffer[i]) {
    case 0:
      // skip past non-sync sequences
      if (buffer[i - 1] !== 0) {
        i += 2;
        break;
      } else if (buffer[i - 2] !== 0) {
        i++;
        break;
      }

      if (syncPoint + 3 !== i - 2) {
        var nalType = parseNalUnitType(buffer[syncPoint + 3] & 0x1f);
        if (nalType === 'slice_layer_without_partitioning_rbsp_idr') {
          return true;
        }
      }

      // drop trailing zeroes
      do {
        i++;
      } while (buffer[i] !== 1 && i < buffer.length);
      syncPoint = i - 2;
      i += 3;
      break;
    case 1:
      // skip past non-sync sequences
      if (buffer[i - 1] !== 0 ||
          buffer[i - 2] !== 0) {
        i += 3;
        break;
      }

      var nalType = parseNalUnitType(buffer[syncPoint + 3] & 0x1f);
      if (nalType === 'slice_layer_without_partitioning_rbsp_idr') {
        return true;
      }
      syncPoint = i - 2;
      i += 3;
      break;
    default:
      // the current byte isn't a one or zero, so it cannot be part
      // of a sync sequence
      i += 3;
      break;
    }
  }
  return false;
};

var parseNalUnitType = function(type) {
  switch (type) {
    case 0x05:
      return 'slice_layer_without_partitioning_rbsp_idr';
    case 0x06:
      return 'sei_rbsp';
    case 0x07:
      return 'seq_parameter_set_rbsp';
    case 0x08:
      return 'pic_parameter_set_rbsp';
    case 0x09:
      return 'access_unit_delimiter_rbsp';
    default:
      return null;
  }
};

var transportPackets = function(bytes) {
  var startIndex = 0,
      endIndex = MP2T_PACKET_LENGTH;

  var packets = [];

  // While we have enough data for a packet
  while (endIndex < bytes.byteLength) {
    // Look for a pair of start and end sync bytes in the data..
    if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
      // We found a packet
      packets.push(bytes.subarray(startIndex, endIndex));
      startIndex += MP2T_PACKET_LENGTH;
      endIndex += MP2T_PACKET_LENGTH;
      continue;
    }
    // If we get here, we have somehow become de-synchronized and we need to step
    // forward one byte at a time until we find a pair of sync bytes that denote
    // a packet
    startIndex++;
    endIndex++;
  }
  return packets;
};

module.exports = {
  transportPackets: transportPackets,
  parseType: parseType,
  parsePat: parsePat,
  parsePmt: parsePmt,
  parsePayloadUnitStartIndicator: parsePayloadUnitStartIndicator,
  parsePesType: parsePesType,
  parsePesTime, parsePesTime,
  videoPacketContainsIframe, videoPacketContainsIframe
};
