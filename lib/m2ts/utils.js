var
  MP2T_PACKET_LENGTH = 188, // bytes
  packetize,
  PAT,
  generatePMT,
  audioPes,
  adtsFrame,
  transportPacket,
  pesHeader;

/**
  * Create an MP2T packet from an array of bytes
  *
  * @param data {Array} the bytes to add to the packet
  * @return {Uint8Array} the packet
  */
packetize = function(data) {
  var packet = new Uint8Array(MP2T_PACKET_LENGTH);
  packet.set(data);
  return packet;
};

/*
 Packet Header:
 | sb | tei pusi tp pid:5 | pid | tsc afc cc |
 with af:
 | afl | ... | <data> |
 without af:
 | <data> |

PAT:
 | pf? | ... |
 | tid | ssi '0' r sl:4 | sl | tsi:8 |
 | tsi | r vn cni | sn | lsn |

with program_number == '0':
 | pn | pn | r np:5 | np |
otherwise:
 | pn | pn | r pmp:5 | pmp |
*/

PAT = [
  0x47, // sync byte
  // tei:0 pusi:1 tp:0 pid:0 0000 0000 0000
  0x40, 0x00,
  // tsc:01 afc:01 cc:0000 pointer_field:0000 0000
  0x50, 0x00,
  // tid:0000 0000 ssi:0 0:0 r:00 sl:0000 0000 0000
  0x00, 0x00, 0x00,
  // tsi:0000 0000 0000 0000
  0x00, 0x00,
  // r:00 vn:00 000 cni:1 sn:0000 0000 lsn:0000 0000
  0x01, 0x00, 0x00,
  // pn:0000 0000 0000 0001
  0x00, 0x01,
  // r:000 pmp:0 0000 0010 0000
  0x00, 0x10,
  // crc32:0000 0000 0000 0000 0000 0000 0000 0000
  0x00, 0x00, 0x00, 0x00
];

/**
  * Generates a Program Map Table with any/all of video, audio, and metadata.
  * To specify that there is video, audio, and/or metadata, provide a truthy value
  * within the options object with the following keys:
  * - hasVideo
  * - hasAudio
  * - hasMetadata
  *
  * @param options {Object} whether PMT has video, audio, and metadata
  * @return {Array} the PMT bytes
  */
generatePMT = function(options) {
  var PMT = [
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0010 0000
    0x40, 0x10,
    // tsc:01 afc:01 cc:0000 pointer_field:0000 0000
    0x50, 0x00,
    // tid:0000 0010 ssi:0 0:0 r:00 sl:0000 0001 1100
    0x02, 0x00, 0x1c,
    // pn:0000 0000 0000 0001
    0x00, 0x01,
    // r:00 vn:00 000 cni:1 sn:0000 0000 lsn:0000 0000
    0x01, 0x00, 0x00,
    // r:000 ppid:0 0011 1111 1111
    0x03, 0xff,
    // r:0000 pil:0000 0000 0000
    0x00, 0x00];

    if (options.hasVideo) {
      // h264
      PMT = PMT.concat([
        // st:0001 1010 r:000 epid:0 0000 0001 0001
        0x1b, 0x00, 0x11,
        // r:0000 esil:0000 0000 0000
        0x00, 0x00
      ]);
    }

    if (options.hasAudio) {
      // adts
      PMT = PMT.concat([
        // st:0000 1111 r:000 epid:0 0000 0001 0010
        0x0f, 0x00, 0x12,
        // r:0000 esil:0000 0000 0000
        0x00, 0x00
      ]);
    }

    if (options.hasMetadata) {
      // timed metadata
      PMT = PMT.concat([
        // st:0001 0111 r:000 epid:0 0000 0001 0011
        0x15, 0x00, 0x13,
        // r:0000 esil:0000 0000 0000
        0x00, 0x00,
      ]);
    }

    // crc
    return PMT.concat([0x00, 0x00, 0x00, 0x00]);
};

/**
 * Helper function to create audio PES packets
 * @param data {arraylike} - the payload bytes
 * @payload first {boolean} - true if this PES should be a payload
 * unit start
 */
audioPes = function(data, first, pts) {
  return transportPacket(0x12,
    adtsFrame(data.length).concat(data),
    first, pts);
};

/**
 * Helper function to create transport stream PES packets
 * @param pid {uint8} - the program identifier (PID)
 * @param data {arraylike} - the payload bytes
 * @payload first {boolean} - true if this PES should be a payload
 * unit start
 */
transportPacket = function(pid, data, first, pts) {
  var
    adaptationFieldLength = 188 - data.length - 14 - (first ? 1 : 0) - (pts ? 5 : 0),
    // transport_packet(), Rec. ITU-T H.222.0, Table 2-2
    result = [
      // sync byte
      0x47,
      // tei:0 pusi:1 tp:0 pid:0 0000 0001 0001
      0x40, pid,
      // tsc:01 afc:11 cc:0000
      0x70
    ].concat([
      // afl
      adaptationFieldLength & 0xff,
      // di:0 rai:0 espi:0 pf:0 of:0 spf:0 tpdf:0 afef:0
      0x00
    ]),
    i;

  i = adaptationFieldLength - 1;
  while (i--) {
    // stuffing_bytes
    result.push(0xff);
  }

  // PES_packet(), Rec. ITU-T H.222.0, Table 2-21
  result = result.concat(pesHeader(first, pts));

  return result.concat(data);
};

/**
 * Helper function to create audio ADTS frame header
 * @param dataLength {number} - the payload byte count
 */
adtsFrame = function (dataLength) {
  var frameLength = dataLength + 7;
  return [
    0xff, 0xf1,                            // no CRC
    0x10,                                  // AAC Main, 44.1KHz
    0xb0 | ((frameLength & 0x1800) >> 11), // 2 channels
    (frameLength & 0x7f8) >> 3,
    ((frameLength & 0x07) << 5) + 7,       // frame length in bytes
    0x00                                   // one AAC per ADTS frame
  ];
};

/**
  * Generates a Packetized Elementary Stream header for testing purposes
  *
  * @param first {Boolean}
  * @param pts {Number} presentation timestamp
  * @return {Array} the PES header bytes
  */
pesHeader = function (first, pts) {
  // PES_packet(), Rec. ITU-T H.222.0, Table 2-21
  var result = [
    // pscp:0000 0000 0000 0000 0000 0001
    0x00, 0x00, 0x01,
    // sid:0000 0000 ppl:0000 0000 0000 0101
    0x00, 0x00, 0x05,
    // 10 psc:00 pp:0 dai:1 c:0 ooc:0
    0x84,
    // pdf:?0 ef:1 erf:0 dtmf:0 acif:0 pcf:0 pef:0
    0x20 | (pts ? 0x80 : 0x00),
    // phdl:0000 0000
    (first ? 0x01 : 0x00) + (pts ? 0x05 : 0x00)
  ];

  // Only store 15 bits of the PTS for QUnit.testing purposes
  if (pts) {
    result.push(0x21);
    result.push(0x00);
    result.push(0x01);
    result.push((pts & 0x7F80) >>> 7);
    result.push(((pts & 0x7F) << 1) | 1);
  }

  if (first) {
    result.push(0x00);
  }

  return result;
};


module.exports = {
  packetize: packetize,
  PAT: PAT,
  generatePMT: generatePMT,
  audioPes: audioPes,
  transportPacket: transportPacket,
  pesHeader: pesHeader,
  MP2T_PACKET_LENGTH: MP2T_PACKET_LENGTH,
  adtsFrame: adtsFrame
};
