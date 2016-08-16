/**
 * mux.js
 *
 * Copyright (c) 2016 Brightcove
 * All rights reserved.
 *
 * Parse mpeg2 transport stream packets to extract basic timing information
 */
'use strict';

var StreamTypes = require('../m2ts/stream-types');

var
  MP2T_PACKET_LENGTH = 188, // bytes
  SYNC_BYTE = 0x47;

/**
 * Splits an incoming stream of binary data into MPEG-2 Transport
 * Stream packets.
 */
var parseTransportStream = function(bytes) {
  var
    startIndex = 0,
    endIndex = MP2T_PACKET_LENGTH,
    packets = [];

  // While we have enough data for a packet
  while (endIndex < bytes.byteLength) {
    // Look for a pair of start and end sync bytes in the data..
    if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
      // We found a packet so emit it and jump one whole packet forward in
      // the stream
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

/**
 * Accepts MPEG-2 Transport Stream packets and emits data events with parsed
 * forms of the individual transport stream packets.
 */
var parseTransportStreamPackets = function(packets) {
  var programMapTable = null;
  var packetsWaitingForPmt = [];
  var packetsWaitingForPmtPid = [];
  var pmtPid = null;
  var parsedPackets = [];

  var processPmtOrPes = function(packet) {
    if (packet.pid === pmtPid) {
      packet.type = 'pmt';
      parsePsi(packet);
      parsedPackets.push(packet);
    } else if (programMapTable === null) {
      packetsWaitingForPmt.push(packet);
    } else {
      processPes(packet);
      parsedPackets.push(packet);
    }
  };

  var parsePsi = function(psi) {
    var offset = 0;
    var payload = psi.data;

    // PSI packets may be split into multiple sections and those
    // sections may be split into multiple packets. If a PSI
    // section starts in this packet, the payload_unit_start_indicator
    // will be true and the first byte of the payload will indicate
    // the offset from the current position to the start of the
    // section.
    if (psi.payloadUnitStartIndicator) {
      offset += payload[offset] + 1;
    }

    psi.data = payload.subarray(offset);

    if (psi.type === 'pat') {
      parsePat(psi);
    } else {
      parsePmt(psi);
    }
  };

  var parsePat = function(pat) {
    var payload = pat.data;

    pat.section_number = payload[7]; // eslint-disable-line camelcase
    pat.last_section_number = payload[8]; // eslint-disable-line camelcase

    // skip the PSI header and parse the first PMT entry
    pmtPid = (payload[10] & 0x1F) << 8 | payload[11];
    pat.pmtPid = pmtPid;

    while (packetsWaitingForPmtPid.length) {
      processPmtOrPes(packetsWaitingForPmtPid.shift());
    }
  };

  /**
   * Parse out the relevant fields of a Program Map Table (PMT).
   * @param payload {Uint8Array} the PMT-specific portion of an MP2T
   * packet. The first byte in this array should be the table_id
   * field.
   * @param pmt {object} the object that should be decorated with
   * fields parsed from the PMT.
   */
  var parsePmt = function(pmt) {
    var sectionLength, tableEnd, programInfoLength, offset;

    var payload = pmt.data;

    // PMTs can be sent ahead of the time when they should actually
    // take effect. We don't believe this should ever be the case
    // for HLS but we'll ignore "forward" PMT declarations if we see
    // them. Future PMT declarations have the current_next_indicator
    // set to zero.
    if (!(payload[5] & 0x01)) {
      return;
    }

    // overwrite any existing program map table
    programMapTable = {};

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

    // record the map on the packet as well
    pmt.programMapTable = programMapTable;

    // if there are any packets waiting for a PMT to be found, process them now
    while (packetsWaitingForPmt.length) {
      var packet = packetsWaitingForPmt.shift();
      processPes(packet);
      parsedPackets.push(packet);
    }
  };

  var processPes = function(pes) {
    pes.streamType = programMapTable[pes.pid];
    pes.type = 'pes';
  };

  var parsePacket = function(packet) {
    var
      result = {},
      offset = 4;

    result.payloadUnitStartIndicator = !!(packet[1] & 0x40);

    // pid is a 13-bit field starting at the last bit of packet[1]
    result.pid = packet[1] & 0x1f;
    result.pid <<= 8;
    result.pid |= packet[2];

    // if an adaption field is present, its length is specified by the
    // fifth byte of the TS packet header. The adaptation field is
    // used to add stuffing to PES packets that don't fill a complete
    // TS packet, and to specify some forms of timing and control data
    // that we do not currently use.
    if (((packet[3] & 0x30) >>> 4) > 0x01) {
      offset += packet[offset] + 1;
    }

    result.data = packet.subarray(offset);

    // parse the rest of the packet based on the type
    if (result.pid === 0) {
      result.type = 'pat';
      parsePsi(result);
      parsedPackets.push(result);
      return;
    }

    if(pmtPid === null) {
      packetsWaitingForPmtPid.push(result);
      return;
    }

    processPmtOrPes(result);
  };

  packets.forEach(function(packet) {
    parsePacket(packet);
  });

  return parsedPackets;
};

var parsePesPackets = function(packets) {
  var
    video = {
      data: [],
      size: 0,
      info: []
    },
    audio = {
      data: [],
      size: 0,
      info: []
    };

  var parsePes = function(payload, pes) {
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
      pes.pts /= 90000;
      pes.dts /= 90000;
    }
  };

  var flushStream = function(stream, type) {
    var
      packetData = new Uint8Array(stream.size),
      event = {
        type: type
      },
      i = 0,
      fragment;

    // do nothing if there is no buffered data
    if (!stream.data.length) {
      return;
    }
    event.trackId = stream.data[0].pid;

    // reassemble the packet
    while (stream.data.length) {
      fragment = stream.data.shift();

      packetData.set(fragment.data, i);
      i += fragment.data.byteLength;
    }

    // parse assembled packet's PES header
    parsePes(packetData, event);

    stream.size = 0;

    stream.info.push(event);
  };

  var parsePacket = function(packet, first) {
    ({
      pat: function() {
        // do not care about PAT data for now
      },
      pes: function() {
        var stream, type;
        switch (packet.streamType) {
          case StreamTypes.H264_STREAM_TYPE:
            stream = video;
            type = 'video';
            break;
          case StreamTypes.ADTS_STREAM_TYPE:
            stream = audio;
            type = 'audio';
            break;
          default:
            // ignore unknown stream types
            return;
        }

        if (first && stream.info.length === 1) {
          return;
        }

        if (!first && stream.info.length === 2) {
          return;
        }

        // if a new packet is starting, we can flush the completed
        // packet
        if (packet.payloadUnitStartIndicator) {
          if (!first) {
            stream.data.unshift(packet);
            stream.size += packet.data.byteLength;
          }
          flushStream(stream, type);
        }

        // buffer this fragment until we are sure we've received the
        // complete payload
        if (first) {
          stream.data.push(packet);
        } else {
          stream.data.unshift(packet);
        }
        stream.size += packet.data.byteLength;
      },
      pmt: function() {
        // do not care about PMT data for now
      }
    })[packet.type]();
  };

  var i = 0;
  var packet;

  while ((video.info.length === 0 || audio.info.length === 0) || i === packets.length) {
    packet = packets[i];
    parsePacket(packet, true);
    i++;
  }

  video.data = [];
  video.size = 0;
  audio.data = [];
  audio.size = 0;
  i = packets.length - 1;

  while((video.info.length === 1 || audio.info.length === 1) || i === -1) {
    packet = packets[i];
    parsePacket(packet, false);
    i--;
  }

  var result = {};

  if (video.info.length > 1) {
    result.video = [video.info[0], video.info[video.info.length - 1]];
  }
  if (audio.info.length > 1) {
    result.audio = [audio.info[0], audio.info[audio.info.length - 1]];
  }

  return result;
};

var inspectTs = function(data) {
  var tsPackets = parseTransportStream(data);
  var pesPackets = parseTransportStreamPackets(tsPackets);
  return parsePesPackets(pesPackets);
};

module.exports = {
  inspect: inspectTs
};
