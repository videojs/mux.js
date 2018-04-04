'use strict';

var mp2t = require('../lib/m2ts'),
    codecs = require('../lib/codecs'),
    aac = require('../lib/aac'),
    flv = require('../lib/flv'),
    id3Generator = require('./utils/id3-generator'),
    mp4 = require('../lib/mp4'),
    QUnit = require('qunit'),
    testSegment = require('./utils/test-segment'),
    testMiddlePatPMT = require('./utils/test-middle-pat-pmt'),
    mp4AudioProperties = require('../lib/mp4/transmuxer').AUDIO_PROPERTIES,
    mp4VideoProperties = require('../lib/mp4/transmuxer').VIDEO_PROPERTIES,
    clock = require('../lib/utils/clock'),
    TransportPacketStream = mp2t.TransportPacketStream,
    transportPacketStream,
    TransportParseStream = mp2t.TransportParseStream,
    transportParseStream,
    ElementaryStream = mp2t.ElementaryStream,
    elementaryStream,
    TimestampRolloverStream = mp2t.TimestampRolloverStream,
    timestampRolloverStream,
    AacStream = aac,
    H264Stream = codecs.h264.H264Stream,
    h264Stream,

    VideoSegmentStream = mp4.VideoSegmentStream,
    videoSegmentStream,
    AudioSegmentStream = mp4.AudioSegmentStream,
    audioSegmentStream,

    AdtsStream = codecs.adts,
    adtsStream,
    Transmuxer = mp4.Transmuxer,
    FlvTransmuxer = flv.Transmuxer,
    transmuxer,
    NalByteStream = codecs.h264.NalByteStream,
    nalByteStream,

    MP2T_PACKET_LENGTH = mp2t.MP2T_PACKET_LENGTH,
    H264_STREAM_TYPE = mp2t.H264_STREAM_TYPE,
    ADTS_STREAM_TYPE = mp2t.ADTS_STREAM_TYPE,
    METADATA_STREAM_TYPE = mp2t.METADATA_STREAM_TYPE,
    packetize,

    PAT,
    generatePMT,
    PMT,
    validateTrack,
    validateTrackFragment,

    pesHeader,
    transportPacket,
    videoPes,
    adtsFrame,
    audioPes,
    timedMetadataPes;

mp4.tools = require('../lib/tools/mp4-inspector');

QUnit.module('MP2T Packet Stream', {
  setup: function() {
    transportPacketStream = new TransportPacketStream();
  }
});
QUnit.test('tester', function() {
  QUnit.ok(true, 'did not throw');
});
QUnit.test('empty input does not error', function() {
  transportPacketStream.push(new Uint8Array([]));
  QUnit.ok(true, 'did not throw');
});
QUnit.test('parses a generic packet', function() {
  var
    datas = [],
    packet = new Uint8Array(188);

  packet[0] = 0x47; // Sync-byte

  transportPacketStream.on('data', function(event) {
    datas.push(event);
  });
  transportPacketStream.push(packet);
  transportPacketStream.flush();

  QUnit.equal(1, datas.length, 'fired one event');
  QUnit.equal(datas[0].byteLength, 188, 'delivered the packet');
});

QUnit.test('buffers partial packets', function() {
  var
    datas = [],
    partialPacket1 = new Uint8Array(187),
    partialPacket2 = new Uint8Array(189);

  partialPacket1[0] = 0x47; // Sync-byte
  partialPacket2[1] = 0x47; // Sync-byte

  transportPacketStream.on('data', function(event) {
    datas.push(event);
  });
  transportPacketStream.push(partialPacket1);

  QUnit.equal(0, datas.length, 'did not fire an event');

  transportPacketStream.push(partialPacket2);
  transportPacketStream.flush();

  QUnit.equal(2, datas.length, 'fired events');
  QUnit.equal(188, datas[0].byteLength, 'parsed the first packet');
  QUnit.equal(188, datas[1].byteLength, 'parsed the second packet');
});

QUnit.test('parses multiple packets delivered at once', function() {
  var datas = [], packetStream = new Uint8Array(188 * 3);

  packetStream[0] = 0x47; // Sync-byte
  packetStream[188] = 0x47; // Sync-byte
  packetStream[376] = 0x47; // Sync-byte

  transportPacketStream.on('data', function(event) {
    datas.push(event);
  });

  transportPacketStream.push(packetStream);
  transportPacketStream.flush();

  QUnit.equal(3, datas.length, 'fired three events');
  QUnit.equal(188, datas[0].byteLength, 'parsed the first packet');
  QUnit.equal(188, datas[1].byteLength, 'parsed the second packet');
  QUnit.equal(188, datas[2].byteLength, 'parsed the third packet');
});

QUnit.test('resyncs packets', function() {
  var datas = [], packetStream = new Uint8Array(188 * 3 - 2);

  packetStream[0] = 0x47; // Sync-byte
  packetStream[186] = 0x47; // Sync-byte
  packetStream[374] = 0x47; // Sync-byte

  transportPacketStream.on('data', function(event) {
    datas.push(event);
  });

  transportPacketStream.push(packetStream);
  transportPacketStream.flush();

  QUnit.equal(datas.length, 2, 'fired three events');
  QUnit.equal(datas[0].byteLength, 188, 'parsed the first packet');
  QUnit.equal(datas[1].byteLength, 188, 'parsed the second packet');
});

QUnit.test('buffers extra after multiple packets', function() {
  var datas = [], packetStream = new Uint8Array(188 * 2 + 10);

  packetStream[0] = 0x47; // Sync-byte
  packetStream[188] = 0x47; // Sync-byte
  packetStream[376] = 0x47; // Sync-byte

  transportPacketStream.on('data', function(event) {
    datas.push(event);
  });

  transportPacketStream.push(packetStream);
  QUnit.equal(2, datas.length, 'fired three events');
  QUnit.equal(188, datas[0].byteLength, 'parsed the first packet');
  QUnit.equal(188, datas[1].byteLength, 'parsed the second packet');

  transportPacketStream.push(new Uint8Array(178));
  transportPacketStream.flush();

  QUnit.equal(3, datas.length, 'fired a final event');
  QUnit.equal(188, datas[2].length, 'parsed the finel packet');
});

QUnit.module('MP2T TransportParseStream', {
  setup: function() {
    transportPacketStream = new TransportPacketStream();
    transportParseStream = new TransportParseStream();

    transportPacketStream.pipe(transportParseStream);
  }
});

QUnit.test('parses generic packet properties', function() {
  var packet;
  transportParseStream.on('data', function(data) {
    packet = data;
  });

  transportParseStream.push(packetize(PAT));
  transportParseStream.push(packetize(generatePMT({})));
  transportParseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0001 tsc:01 afc:10 cc:11 padding: 00
    0x40, 0x01, 0x6c
  ]));

  QUnit.ok(packet.payloadUnitStartIndicator, 'parsed payload_unit_start_indicator');
  QUnit.ok(packet.pid, 'parsed PID');
});

QUnit.test('parses piped data events', function() {
  var packet;
  transportParseStream.on('data', function(data) {
    packet = data;
  });

  transportParseStream.push(packetize(PAT));
  transportParseStream.push(packetize(generatePMT({})));
  transportParseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0001 tsc:01 afc:10 cc:11 padding: 00
    0x40, 0x01, 0x6c
  ]));

  QUnit.ok(packet, 'parsed a packet');
});

QUnit.test('parses a data packet with adaptation fields', function() {
  var packet;
  transportParseStream.on('data', function(data) {
    packet = data;
  });

  transportParseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0000 tsc:01 afc:10 cc:11 afl:00 0000 00 stuffing:00 0000 00 pscp:00 0001 padding:0000
    0x40, 0x00, 0x6c, 0x00, 0x00, 0x10
  ]));
  QUnit.strictEqual(packet.type, 'pat', 'parsed the packet type');
});

QUnit.test('parses a PES packet', function() {
  var packet;
  transportParseStream.on('data', function(data) {
    packet = data;
  });

  // setup a program map table
  transportParseStream.programMapTable = {
    video: 0x0010,
    'timed-metadata': {}
  };

  transportParseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0010 tsc:01 afc:01 cc:11 padding:00
    0x40, 0x02, 0x5c
  ]));
  QUnit.strictEqual(packet.type, 'pes', 'parsed a PES packet');
});

QUnit.test('parses packets with variable length adaptation fields and a payload', function() {
  var packet;
  transportParseStream.on('data', function(data) {
    packet = data;
  });

  // setup a program map table
  transportParseStream.programMapTable = {
    video: 0x0010,
    'timed-metadata': {}
  };

  transportParseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0010 tsc:01 afc:11 cc:11 afl:00 0000 11 stuffing:00 0000 0000 00 pscp:00 0001
    0x40, 0x02, 0x7c, 0x0c, 0x00, 0x01
  ]));
  QUnit.strictEqual(packet.type, 'pes', 'parsed a PES packet');
});

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

QUnit.test('parses the program map table pid from the program association table (PAT)', function() {
  var packet;
  transportParseStream.on('data', function(data) {
    packet = data;
  });

  transportParseStream.push(new Uint8Array(PAT));
  QUnit.ok(packet, 'parsed a packet');
  QUnit.strictEqual(0x0010, transportParseStream.pmtPid, 'parsed PMT pid');
});

QUnit.test('does not parse PES packets until after the PES has been parsed', function() {
  var pesCount = 0;

  transportParseStream.on('data', function(data) {
    if (data.type === 'pmt') {
      QUnit.equal(pesCount, 0, 'have not yet parsed any PES packets');
    } else if (data.type === 'pes') {
      pesCount++;
    }
  });

  transportPacketStream.push(testMiddlePatPMT);
});

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
        0x00, 0x00
      ]);
    }

    // crc
    return PMT.concat([0x00, 0x00, 0x00, 0x00]);
};

PMT = [
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
  0x00, 0x00,
  // h264
  // st:0001 1010 r:000 epid:0 0000 0001 0001
  0x1b, 0x00, 0x11,
  // r:0000 esil:0000 0000 0000
  0x00, 0x00,
  // adts
  // st:0000 1111 r:000 epid:0 0000 0001 0010
  0x0f, 0x00, 0x12,
  // r:0000 esil:0000 0000 0000
  0x00, 0x00,

  // timed metadata
  // st:0001 0111 r:000 epid:0 0000 0001 0011
  0x15, 0x00, 0x13,
  // r:0000 esil:0000 0000 0000
  0x00, 0x00,

  // crc
  0x00, 0x00, 0x00, 0x00
];

QUnit.test('parse the elementary streams from a program map table', function() {
  var packet;
  transportParseStream.on('data', function(data) {
    packet = data;
  });
  transportParseStream.pmtPid = 0x0010;

  transportParseStream.push(new Uint8Array(PMT.concat(0, 0, 0, 0, 0)));

  QUnit.ok(packet, 'parsed a packet');
  QUnit.ok(transportParseStream.programMapTable, 'parsed a program map');
  QUnit.strictEqual(transportParseStream.programMapTable.video, 0x11, 'associated h264 with pid 0x11');
  QUnit.strictEqual(transportParseStream.programMapTable.audio, 0x12, 'associated adts with pid 0x12');
  QUnit.deepEqual(transportParseStream.programMapTable, packet.programMapTable, 'recorded the PMT');
});

pesHeader = function(first, pts, dataLength) {
  if (!dataLength) {
    dataLength = 0;
  } else {
    // Add the pes header length (only the portion after the
    // pes_packet_length field)
    dataLength += 3;
  }

  // PES_packet(), Rec. ITU-T H.222.0, Table 2-21
  var result = [
    // pscp:0000 0000 0000 0000 0000 0001
    0x00, 0x00, 0x01,
    // sid:0000 0000 ppl:0000 0000 0000 0000
    0x00, 0x00, 0x00,
    // 10 psc:00 pp:0 dai:1 c:0 ooc:0
    0x84,
    // pdf:?0 ef:1 erf:0 dtmf:0 acif:0 pcf:0 pef:0
    0x20 | (pts ? 0x80 : 0x00),
    // phdl:0000 0000
    (first ? 0x01 : 0x00) + (pts ? 0x05 : 0x00)
  ];

  // Only store 15 bits of the PTS for QUnit.testing purposes
  if (pts) {
    var
      pts32 = Math.floor(pts / 2), // right shift by 1
      leftMostBit = ((pts32 & 0x80000000) >>> 31) & 0x01,
      firstThree;

    pts = pts & 0xffffffff;        // remove left most bit
    firstThree = (leftMostBit << 3) | (((pts & 0xc0000000) >>> 29) & 0x06) | 0x01;
    result.push((0x2 << 4) | firstThree);
    result.push((pts >>> 22) & 0xff);
    result.push(((pts >>> 14) | 0x01) & 0xff);
    result.push((pts >>> 7) & 0xff);
    result.push(((pts << 1) | 0x01) & 0xff);

    // Add the bytes spent on the pts info
    dataLength += 5;
  }
  if (first) {
    result.push(0x00);
    dataLength += 1;
  }

  // Finally set the pes_packet_length field
  result[4] = (dataLength & 0x0000FF00) >> 8;
  result[5] = dataLength & 0x000000FF;

  return result;
};

/**
 * Helper function to create transport stream PES packets
 * @param pid {uint8} - the program identifier (PID)
 * @param data {arraylike} - the payload bytes
 * @payload first {boolean} - true if this PES should be a payload
 * unit start
 */
transportPacket = function(pid, data, first, pts, isVideoData) {
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
  result = result.concat(pesHeader(first, pts, isVideoData ? 0 : data.length));

  return result.concat(data);
};

/**
 * Helper function to create video PES packets
 * @param data {arraylike} - the payload bytes
 * @payload first {boolean} - true if this PES should be a payload
 * unit start
 */
videoPes = function(data, first, pts) {
  return transportPacket(0x11, [
    // NAL unit start code
    0x00, 0x00, 0x01
  ].concat(data), first, pts, true);
};

/**
 * Helper function to create audio ADTS frame header
 * @param dataLength {number} - the payload byte count
 */
adtsFrame = function(dataLength) {
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

timedMetadataPes = function(data) {
  var id3 = id3Generator;
  return transportPacket(0x13, id3.id3Tag(id3.id3Frame('PRIV', 0x00, 0x01)));
};

QUnit.module('MP2T ElementaryStream', {
  setup: function() {
    elementaryStream = new ElementaryStream();
  }
});

packetize = function(data) {
  var packet = new Uint8Array(MP2T_PACKET_LENGTH);
  packet.set(data);
  return packet;
};

QUnit.test('parses metadata events from PSI packets', function() {
  var
    metadatas = [],
    datas = 0,
    sortById = function(left, right) {
      return left.id - right.id;
    };
  elementaryStream.on('data', function(data) {
    if (data.type === 'metadata') {
      metadatas.push(data);
    }
    datas++;
  });
  elementaryStream.push({
    type: 'pat'
  });
  elementaryStream.push({
    type: 'pmt',
    programMapTable: {
      video: 1,
      audio: 2,
      'timed-metadata': {}
    }
  });

  QUnit.equal(1, datas, 'data fired');
  QUnit.equal(1, metadatas.length, 'metadata generated');
  metadatas[0].tracks.sort(sortById);
  QUnit.deepEqual(metadatas[0].tracks, [{
    id: 1,
    codec: 'avc',
    type: 'video',
    timelineStartInfo: {
      baseMediaDecodeTime: 0
    }
  }, {
    id: 2,
    codec: 'adts',
    type: 'audio',
    timelineStartInfo: {
      baseMediaDecodeTime: 0
    }
  }], 'identified two tracks');
});

QUnit.test('parses standalone program stream packets', function() {
  var
    packets = [],
    packetData = [0x01, 0x02],
    pesHead = pesHeader(false, 7, 2);

  elementaryStream.on('data', function(packet) {
    packets.push(packet);
  });
  elementaryStream.push({
    type: 'pes',
    streamType: ADTS_STREAM_TYPE,
    payloadUnitStartIndicator: true,
    data: new Uint8Array(pesHead.concat(packetData))
  });
  elementaryStream.flush();

  QUnit.equal(packets.length, 1, 'built one packet');
  QUnit.equal(packets[0].type, 'audio', 'identified audio data');
  QUnit.equal(packets[0].data.byteLength, packetData.length, 'parsed the correct payload size');
  QUnit.equal(packets[0].pts, 7, 'correctly parsed the pts value');
});

QUnit.test('aggregates program stream packets from the transport stream', function() {
  var
    events = [],
    packetData = [0x01, 0x02],
    pesHead = pesHeader(false, 7);

  elementaryStream.on('data', function(event) {
    events.push(event);
  });

  elementaryStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    payloadUnitStartIndicator: true,
    data: new Uint8Array(pesHead.slice(0, 4)) // Spread PES Header across packets
  });

  QUnit.equal(events.length, 0, 'buffers partial packets');

  elementaryStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(pesHead.slice(4).concat(packetData))
  });
  elementaryStream.flush();

  QUnit.equal(events.length, 1, 'built one packet');
  QUnit.equal(events[0].type, 'video', 'identified video data');
  QUnit.equal(events[0].pts, 7, 'correctly parsed the pts');
  QUnit.equal(events[0].data.byteLength, packetData.length, 'concatenated transport packets');
});

QUnit.test('parses an elementary stream packet with just a pts', function() {
  var packet;
  elementaryStream.on('data', function(data) {
    packet = data;
  });

  elementaryStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    payloadUnitStartIndicator: true,
    data: new Uint8Array([
      // pscp:0000 0000 0000 0000 0000 0001
      0x00, 0x00, 0x01,
      // sid:0000 0000 ppl:0000 0000 0000 1001
      0x00, 0x00, 0x09,
      // 10 psc:00 pp:0 dai:1 c:0 ooc:0
      0x84,
      // pdf:10 ef:1 erf:0 dtmf:0 acif:0 pcf:0 pef:0
      0xc0,
      // phdl:0000 0101 '0010' pts:111 mb:1 pts:1111 1111
      0x05, 0xFF, 0xFF,
      // pts:1111 111 mb:1 pts:1111 1111 pts:1111 111 mb:1
      0xFF, 0xFF, 0xFF,
      // "data":0101
      0x11
    ])
  });
  elementaryStream.flush();

  QUnit.ok(packet, 'parsed a packet');
  QUnit.equal(packet.data.byteLength, 1, 'parsed a single data byte');
  QUnit.equal(packet.data[0], 0x11, 'parsed the data');
  // 2^33-1 is the maximum value of a 33-bit unsigned value
  QUnit.equal(packet.pts, Math.pow(2, 33) - 1, 'parsed the pts');
});

QUnit.test('parses an elementary stream packet with a pts and dts', function() {
  var packet;
  elementaryStream.on('data', function(data) {
    packet = data;
  });

  elementaryStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    payloadUnitStartIndicator: true,
    data: new Uint8Array([
      // pscp:0000 0000 0000 0000 0000 0001
      0x00, 0x00, 0x01,
      // sid:0000 0000 ppl:0000 0000 0000 1110
      0x00, 0x00, 0x0e,
      // 10 psc:00 pp:0 dai:1 c:0 ooc:0
      0x84,
      // pdf:11 ef:1 erf:0 dtmf:0 acif:0 pcf:0 pef:0
      0xe0,
      // phdl:0000 1010 '0011' pts:000 mb:1 pts:0000 0000
      0x0a, 0x21, 0x00,
      // pts:0000 000 mb:1 pts:0000 0000 pts:0000 100 mb:1
      0x01, 0x00, 0x09,
      // '0001' dts:000 mb:1 dts:0000 0000 dts:0000 000 mb:1
      0x11, 0x00, 0x01,
      // dts:0000 0000 dts:0000 010 mb:1
      0x00, 0x05,
      // "data":0101
      0x11
    ])
  });
  elementaryStream.flush();

  QUnit.ok(packet, 'parsed a packet');
  QUnit.equal(packet.data.byteLength, 1, 'parsed a single data byte');
  QUnit.equal(packet.data[0], 0x11, 'parsed the data');
  QUnit.equal(packet.pts, 4, 'parsed the pts');
  QUnit.equal(packet.dts, 2, 'parsed the dts');
});

QUnit.test('parses an elementary stream packet without a pts or dts', function() {
  var packet;
  elementaryStream.on('data', function(data) {
    packet = data;
  });

  elementaryStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    payloadUnitStartIndicator: true,
    data: new Uint8Array(pesHeader().concat([0xaf, 0x01]))
  });
  elementaryStream.flush();

  QUnit.ok(packet, 'parsed a packet');
  QUnit.equal(packet.data.byteLength, 2, 'parsed two data bytes');
  QUnit.equal(packet.data[0], 0xaf, 'parsed the first data byte');
  QUnit.equal(packet.data[1], 0x01, 'parsed the second data byte');
  QUnit.ok(!packet.pts, 'did not parse a pts');
  QUnit.ok(!packet.dts, 'did not parse a dts');
});

QUnit.test('won\'t emit non-video packets if the PES_packet_length is larger than the contents', function() {
  var events = [];
  var pesHead = pesHeader(false, 1, 5);

  elementaryStream.on('data', function(event) {
    events.push(event);
  });

  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(pesHead.concat([1]))
  });
  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: ADTS_STREAM_TYPE,
    data: new Uint8Array(pesHead.concat([1]))
  });
  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: METADATA_STREAM_TYPE,
    // data larger than 5 byte dataLength, should still emit event
    data: new Uint8Array(pesHead.concat([1, 1, 1, 1, 1, 1, 1, 1, 1]))
  });

  QUnit.equal(0, events.length, 'buffers partial packets');

  elementaryStream.flush();
  QUnit.equal(events.length, 2, 'emitted 2 packets');
  QUnit.equal(events[0].type, 'video', 'identified video data');
  QUnit.equal(events[1].type, 'timed-metadata', 'identified timed-metadata');
});

QUnit.test('buffers audio and video program streams individually', function() {
  var events = [];
  var pesHead = pesHeader(false, 1, 2);

  elementaryStream.on('data', function(event) {
    events.push(event);
  });

  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(pesHead.concat([1]))
  });
  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: ADTS_STREAM_TYPE,
    data: new Uint8Array(pesHead.concat([1]))
  });
  QUnit.equal(0, events.length, 'buffers partial packets');

  elementaryStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  elementaryStream.push({
    type: 'pes',
    streamType: ADTS_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  elementaryStream.flush();
  QUnit.equal(2, events.length, 'parsed a complete packet');
  QUnit.equal('video', events[0].type, 'identified video data');
  QUnit.equal('audio', events[1].type, 'identified audio data');
});

QUnit.test('flushes the buffered packets when a new one of that type is started', function() {
  var packets = [];
  var pesHead = pesHeader(false, 1, 2);

  elementaryStream.on('data', function(packet) {
    packets.push(packet);
  });
  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(pesHead.concat([1]))
  });
  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: ADTS_STREAM_TYPE,
    data: new Uint8Array(pesHead.concat([1, 2]))
  });
  elementaryStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  QUnit.equal(packets.length, 0, 'buffers packets by type');

  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(pesHead.concat([1]))
  });
  QUnit.equal(packets.length, 1, 'built one packet');
  QUnit.equal(packets[0].type, 'video', 'identified video data');
  QUnit.equal(packets[0].data.byteLength, 2, 'concatenated packets');

  elementaryStream.flush();
  QUnit.equal(packets.length, 3, 'built two more packets');
  QUnit.equal(packets[1].type, 'video', 'identified video data');
  QUnit.equal(packets[1].data.byteLength, 1, 'parsed the video payload');
  QUnit.equal(packets[2].type, 'audio', 'identified audio data');
  QUnit.equal(packets[2].data.byteLength, 2, 'parsed the audio payload');
});

QUnit.test('buffers and emits timed-metadata', function() {
  var packets = [];
  var pesHead = pesHeader(false, 1, 4);

  elementaryStream.on('data', function(packet) {
    packets.push(packet);
  });

  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: METADATA_STREAM_TYPE,
    data: new Uint8Array(pesHead.concat([0, 1]))
  });
  elementaryStream.push({
    type: 'pes',
    streamType: METADATA_STREAM_TYPE,
    data: new Uint8Array([2, 3])
  });
  QUnit.equal(packets.length, 0, 'buffers metadata until the next start indicator');

  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: METADATA_STREAM_TYPE,
    data: new Uint8Array(pesHead.concat([4, 5]))
  });
  elementaryStream.push({
    type: 'pes',
    streamType: METADATA_STREAM_TYPE,
    data: new Uint8Array([6, 7])
  });
  QUnit.equal(packets.length, 1, 'built a packet');
  QUnit.equal(packets[0].type, 'timed-metadata', 'identified timed-metadata');
  QUnit.deepEqual(packets[0].data, new Uint8Array([0, 1, 2, 3]), 'concatenated the data');

  elementaryStream.flush();
  QUnit.equal(packets.length, 2, 'flushed a packet');
  QUnit.equal(packets[1].type, 'timed-metadata', 'identified timed-metadata');
  QUnit.deepEqual(packets[1].data, new Uint8Array([4, 5, 6, 7]), 'included the data');
});

QUnit.test('drops packets with unknown stream types', function() {
  var packets = [];
  elementaryStream.on('data', function(packet) {
    packets.push(packet);
  });
  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    data: new Uint8Array(1)
  });
  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    data: new Uint8Array(1)
  });

  QUnit.equal(packets.length, 0, 'ignored unknown packets');
});

QUnit.module('MP2T TimestampRolloverStream', {
  setup: function() {
    timestampRolloverStream = new TimestampRolloverStream('audio');
    elementaryStream = new ElementaryStream();
    elementaryStream.pipe(timestampRolloverStream);
  }
});

QUnit.test('Correctly parses rollover PTS', function() {
  var
    maxTS = 8589934592,
    packets = [],
    packetData = [0x01, 0x02],
    pesHeadOne = pesHeader(false, maxTS - 400, 2),
    pesHeadTwo = pesHeader(false, maxTS - 100, 2),
    pesHeadThree = pesHeader(false, maxTS, 2),
    pesHeadFour = pesHeader(false, 50, 2);

  timestampRolloverStream.on('data', function(packet) {
    packets.push(packet);
  });
  elementaryStream.push({
    type: 'pes',
    streamType: ADTS_STREAM_TYPE,
    payloadUnitStartIndicator: true,
    data: new Uint8Array(pesHeadOne.concat(packetData))
  });
  elementaryStream.push({
    type: 'pes',
    streamType: ADTS_STREAM_TYPE,
    payloadUnitStartIndicator: true,
    data: new Uint8Array(pesHeadTwo.concat(packetData))
  });
  elementaryStream.push({
    type: 'pes',
    streamType: ADTS_STREAM_TYPE,
    payloadUnitStartIndicator: true,
    data: new Uint8Array(pesHeadThree.concat(packetData))
  });
  elementaryStream.push({
    type: 'pes',
    streamType: ADTS_STREAM_TYPE,
    payloadUnitStartIndicator: true,
    data: new Uint8Array(pesHeadFour.concat(packetData))
  });
  elementaryStream.flush();

  QUnit.equal(packets.length, 4, 'built four packets');
  QUnit.equal(packets[0].type, 'audio', 'identified audio data');
  QUnit.equal(packets[0].data.byteLength, packetData.length, 'parsed the correct payload size');
  QUnit.equal(packets[0].pts, maxTS - 400, 'correctly parsed the pts value');
  QUnit.equal(packets[1].pts, maxTS - 100, 'Does not rollover on minor change');
  QUnit.equal(packets[2].pts, maxTS, 'correctly parses the max pts value');
  QUnit.equal(packets[3].pts, maxTS + 50, 'correctly parsed the rollover pts value');
});

QUnit.test('Correctly parses multiple PTS rollovers', function() {
  var
    maxTS = 8589934592,
    packets = [],
    packetData = [0x01, 0x02],
    pesArray = [pesHeader(false, 1, 2),
                pesHeader(false, Math.floor(maxTS * (1 / 3)), 2),
                pesHeader(false, Math.floor(maxTS * (2 / 3)), 2),
                pesHeader(false, 1, 2),
                pesHeader(false, Math.floor(maxTS * (1 / 3)), 2),
                pesHeader(false, Math.floor(maxTS * (2 / 3)), 2),
                pesHeader(false, 1, 2),
                pesHeader(false, Math.floor(maxTS * (1 / 3)), 2),
                pesHeader(false, Math.floor(maxTS * (2 / 3)), 2),
                pesHeader(false, 1, 2)];

  timestampRolloverStream.on('data', function(packet) {
    packets.push(packet);
  });

  while (pesArray.length > 0) {
    elementaryStream.push({
      type: 'pes',
      streamType: ADTS_STREAM_TYPE,
      payloadUnitStartIndicator: true,
      data: new Uint8Array(pesArray.shift().concat(packetData))
    });
    elementaryStream.flush();
  }


  QUnit.equal(packets.length, 10, 'built ten packets');
  QUnit.equal(packets[0].pts, 1, 'correctly parsed the pts value');
  QUnit.equal(packets[1].pts, Math.floor(maxTS * (1 / 3)), 'correctly parsed the pts value');
  QUnit.equal(packets[2].pts, Math.floor(maxTS * (2 / 3)), 'correctly parsed the pts value');
  QUnit.equal(packets[3].pts, maxTS + 1, 'correctly parsed the pts value');
  QUnit.equal(packets[4].pts, maxTS + Math.floor(maxTS * (1 / 3)), 'correctly parsed the pts value');
  QUnit.equal(packets[5].pts, maxTS + Math.floor(maxTS * (2 / 3)), 'correctly parsed the pts value');
  QUnit.equal(packets[6].pts, (2 * maxTS) + 1, 'correctly parsed the pts value');
  QUnit.equal(packets[7].pts, (2 * maxTS) + Math.floor(maxTS * (1 / 3)), 'correctly parsed the pts value');
  QUnit.equal(packets[8].pts, (2 * maxTS) + Math.floor(maxTS * (2 / 3)), 'correctly parsed the pts value');
  QUnit.equal(packets[9].pts, (3 * maxTS) + 1, 'correctly parsed the pts value');
});

QUnit.module('H264 Stream', {
  setup: function() {
    h264Stream = new H264Stream();
  }
});

QUnit.test('properly parses seq_parameter_set_rbsp nal units', function() {
  var
    data,
    expectedRBSP = new Uint8Array([
      0x42, 0xc0, 0x1e, 0xd9,
      0x00, 0xb4, 0x35, 0xf9,
      0xe1, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x00, 0x00,
      0x3c, 0x0f, 0x16, 0x2e,
      0x48
    ]),
    expectedConfig = {
      profileIdc: 66,
      levelIdc: 30,
      profileCompatibility: 192,
      width: 720,
      height: 404
    };

  h264Stream.on('data', function(event) {
    data = event;
  });

  // QUnit.test SPS:
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x67, 0x42, 0xc0, 0x1e,
      0xd9, 0x00, 0xb4, 0x35,
      0xf9, 0xe1, 0x00, 0x00,
      0x03, 0x00, 0x01, 0x00,
      0x00, 0x03, 0x00, 0x3c,
      0x0f, 0x16, 0x2e, 0x48,
      0x00, 0x00, 0x01
    ])
  });

  QUnit.ok(data, 'generated a data event');
  QUnit.equal(data.nalUnitType, 'seq_parameter_set_rbsp', 'identified an sequence parameter set');
  QUnit.deepEqual(data.escapedRBSP, expectedRBSP, 'properly removed Emulation Prevention Bytes from the RBSP');

  QUnit.deepEqual(data.config, expectedConfig, 'parsed the sps');
});

QUnit.test('Properly parses seq_parameter_set VUI nal unit', function() {
  var
    data,
    expectedConfig = {
      profileIdc: 66,
      levelIdc: 30,
      profileCompatibility: 192,
      width: 64,
      height: 16
    };

  h264Stream.on('data', function(event) {
    data = event;
  });

  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x67, 0x42, 0xc0, 0x1e,
      0xd9, 0xff, 0xff, 0xff,
      0xff, 0xe1, 0x00, 0x00,
      0x03, 0x00, 0x01, 0x00,
      0x00, 0x03, 0x00, 0x3c,
      0x0f, 0x16, 0x2e, 0x48,
      0xff, 0x00, 0x00, 0x01
    ])
  });

  QUnit.ok(data, 'generated a data event');
  QUnit.equal(data.nalUnitType, 'seq_parameter_set_rbsp', 'identified an sequence parameter set');
  QUnit.deepEqual(data.config, expectedConfig, 'parsed the sps');
});

QUnit.test('unpacks nal units from simple byte stream framing', function() {
  var data;
  h264Stream.on('data', function(event) {
    data = event;
  });

  // the simplest byte stream framing:
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x09, 0x07,
      0x00, 0x00, 0x01
    ])
  });

  QUnit.ok(data, 'generated a data event');
  QUnit.equal(data.nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');
  QUnit.equal(data.data.length, 2, 'calculated nal unit length');
  QUnit.equal(data.data[1], 7, 'read a payload byte');
});

QUnit.test('unpacks nal units from byte streams split across pushes', function() {
  var data;
  h264Stream.on('data', function(event) {
    data = event;
  });

  // handles byte streams split across pushes
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x09, 0x07, 0x06, 0x05,
      0x04
    ])
  });
  QUnit.ok(!data, 'buffers NAL units across events');

  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x03, 0x02, 0x01,
      0x00, 0x00, 0x01
    ])
  });
  QUnit.ok(data, 'generated a data event');
  QUnit.equal(data.nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');
  QUnit.equal(data.data.length, 8, 'calculated nal unit length');
  QUnit.equal(data.data[1], 7, 'read a payload byte');
});

QUnit.test('buffers nal unit trailing zeros across pushes', function() {
  var data = [];
  h264Stream.on('data', function(event) {
    data.push(event);
  });

  // lots of zeros after the nal, stretching into the next push
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x09, 0x07, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00
    ])
  });
  QUnit.equal(data.length, 1, 'delivered the first nal');

  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00,
      0x00, 0x00, 0x01,
      0x09, 0x06,
      0x00, 0x00, 0x01
    ])
  });
  QUnit.equal(data.length, 2, 'generated data events');
  QUnit.equal(data[0].data.length, 2, 'ignored trailing zeros');
  QUnit.equal(data[0].data[0], 0x09, 'found the first nal start');
  QUnit.equal(data[1].data.length, 2, 'found the following nal start');
  QUnit.equal(data[1].data[0], 0x09, 'found the second nal start');
});

QUnit.test('unpacks nal units from byte streams with split sync points', function() {
  var data;
  h264Stream.on('data', function(event) {
    data = event;
  });

  // handles sync points split across pushes
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x09, 0x07,
      0x00])
  });
  QUnit.ok(!data, 'buffers NAL units across events');

  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x01
    ])
  });
  QUnit.ok(data, 'generated a data event');
  QUnit.equal(data.nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');
  QUnit.equal(data.data.length, 2, 'calculated nal unit length');
  QUnit.equal(data.data[1], 7, 'read a payload byte');
});

QUnit.test('parses nal unit types', function() {
  var data;
  h264Stream.on('data', function(event) {
    data = event;
  });

  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x09
    ])
  });
  h264Stream.flush();

  QUnit.ok(data, 'generated a data event');
  QUnit.equal(data.nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');

  data = null;
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x07,
      0x27, 0x42, 0xe0, 0x0b,
      0xa9, 0x18, 0x60, 0x9d,
      0x80, 0x35, 0x06, 0x01,
      0x06, 0xb6, 0xc2, 0xb5,
      0xef, 0x7c, 0x04
    ])
  });
  h264Stream.flush();
  QUnit.ok(data, 'generated a data event');
  QUnit.equal(data.nalUnitType, 'seq_parameter_set_rbsp', 'identified a sequence parameter set');

  data = null;
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x08, 0x01
    ])
  });
  h264Stream.flush();
  QUnit.ok(data, 'generated a data event');
  QUnit.equal(data.nalUnitType, 'pic_parameter_set_rbsp', 'identified a picture parameter set');

  data = null;
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x05, 0x01
    ])
  });
  h264Stream.flush();
  QUnit.ok(data, 'generated a data event');
  QUnit.equal(data.nalUnitType, 'slice_layer_without_partitioning_rbsp_idr', 'identified a key frame');

  data = null;
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x06, 0x01
    ])
  });
  h264Stream.flush();
  QUnit.ok(data, 'generated a data event');
  QUnit.equal(data.nalUnitType, 'sei_rbsp', 'identified a supplemental enhancement information unit');
});

// MP4 expects H264 (aka AVC) data to be in storage format. Storage
// format is optimized for reliable, random-access media in contrast
// to the byte stream format that retransmits metadata regularly to
// allow decoders to quickly begin operation from wherever in the
// broadcast they begin receiving.
// Details on the byte stream format can be found in Annex B of
// Recommendation ITU-T H.264.
// The storage format is described in ISO/IEC 14496-15
QUnit.test('strips byte stream framing during parsing', function() {
  var data = [];
  h264Stream.on('data', function(event) {
    data.push(event);
  });

  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      // -- NAL unit start
      // zero_byte
      0x00,
      // start_code_prefix_one_3bytes
      0x00, 0x00, 0x01,
      // nal_unit_type (picture parameter set)
      0x08,
      // fake data
      0x01, 0x02, 0x03, 0x04,
      0x05, 0x06, 0x07,
      // trailing_zero_8bits * 5
      0x00, 0x00, 0x00, 0x00,
      0x00,

      // -- NAL unit start
      // zero_byte
      0x00,
      // start_code_prefix_one_3bytes
      0x00, 0x00, 0x01,
      // nal_unit_type (access_unit_delimiter_rbsp)
      0x09,
      // fake data
      0x06, 0x05, 0x04, 0x03,
      0x02, 0x01, 0x00
    ])
  });
  h264Stream.flush();

  QUnit.equal(data.length, 2, 'parsed two NAL units');
  QUnit.deepEqual(new Uint8Array([
    0x08,
    0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07
  ]), new Uint8Array(data[0].data), 'parsed the first NAL unit');
  QUnit.deepEqual(new Uint8Array([
    0x09,
    0x06, 0x05, 0x04, 0x03,
    0x02, 0x01, 0x00
  ]), new Uint8Array(data[1].data), 'parsed the second NAL unit');
});

QUnit.test('can be reset', function() {
  var input = {
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x09, 0x07,
      0x00, 0x00, 0x01
    ])
  }, data = [];
  // only the laQUnit.test event is relevant for this QUnit.test
  h264Stream.on('data', function(event) {
    data.push(event);
  });

  h264Stream.push(input);
  h264Stream.flush();
  h264Stream.push(input);
  h264Stream.flush();

  QUnit.equal(data.length, 2, 'generated two data events');
  QUnit.equal(data[1].nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');
  QUnit.equal(data[1].data.length, 2, 'calculated nal unit length');
  QUnit.equal(data[1].data[1], 7, 'read a payload byte');
});

QUnit.module('VideoSegmentStream', {
  setup: function() {
    var track = {};
    var options = {};
    videoSegmentStream = new VideoSegmentStream(track, options);
    videoSegmentStream.track = track;
    videoSegmentStream.options = options;
    videoSegmentStream.track.timelineStartInfo = {
      dts: 10,
      pts: 10,
      baseMediaDecodeTime: 0
    };
  }
});

// see ISO/IEC 14496-15, Section 5 "AVC elementary streams and sample definitions"
QUnit.test('concatenates NAL units into AVC elementary streams', function() {
  var segment, boxes;
  videoSegmentStream.on('data', function(data) {
    segment = data.boxes;
  });
  videoSegmentStream.push({
    nalUnitType: 'access_unit_delimiter_rbsp',
    data: new Uint8Array([0x09, 0x01])
  });
  videoSegmentStream.push({
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    data: new Uint8Array([0x05, 0x01])
  });
  videoSegmentStream.push({
    data: new Uint8Array([
      0x08,
      0x01, 0x02, 0x03
    ])
  });
  videoSegmentStream.push({
    data: new Uint8Array([
      0x08,
      0x04, 0x03, 0x02, 0x01, 0x00
    ])
  });
  videoSegmentStream.flush();

  QUnit.ok(segment, 'generated a data event');
  boxes = mp4.tools.inspect(segment);
  QUnit.equal(boxes[1].byteLength,
        (2 + 4) + (2 + 4) + (4 + 4) + (4 + 6),
        'wrote the correct number of bytes');
  QUnit.deepEqual(new Uint8Array(segment.subarray(boxes[0].size + 8)), new Uint8Array([
    0, 0, 0, 2,
    0x09, 0x01,
    0, 0, 0, 2,
    0x05, 0x01,
    0, 0, 0, 4,
    0x08, 0x01, 0x02, 0x03,
    0, 0, 0, 6,
    0x08, 0x04, 0x03, 0x02, 0x01, 0x00
  ]), 'wrote an AVC stream into the mdat');
});

QUnit.test('infers sample durations from DTS values', function() {
   var segment, boxes, samples;
   videoSegmentStream.on('data', function(data) {
     segment = data.boxes;
   });
   videoSegmentStream.push({
     data: new Uint8Array([0x09, 0x01]),
     nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 1
   });
   videoSegmentStream.push({
     data: new Uint8Array([0x09, 0x01]),
     nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 1
   });
   videoSegmentStream.push({
     data: new Uint8Array([0x09, 0x01]),
     nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 2
   });
   videoSegmentStream.push({
     data: new Uint8Array([0x09, 0x01]),
     nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 4
   });
   videoSegmentStream.flush();
  boxes = mp4.tools.inspect(segment);
  samples = boxes[0].boxes[1].boxes[2].samples;
  QUnit.equal(samples.length, 3, 'generated three samples');
  QUnit.equal(samples[0].duration, 1, 'set the first sample duration');
  QUnit.equal(samples[1].duration, 2, 'set the second sample duration');
  QUnit.equal(samples[2].duration, 2, 'inferred the final sample duration');
});

QUnit.test('filters pre-IDR samples and calculate duration correctly', function() {
  var segment, boxes, samples;
  videoSegmentStream.on('data', function(data) {
    segment = data.boxes;
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp',
    dts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 2
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 4
  });
  videoSegmentStream.flush();

  boxes = mp4.tools.inspect(segment);
  samples = boxes[0].boxes[1].boxes[2].samples;
  QUnit.equal(samples.length, 2, 'generated two samples, filters out pre-IDR');
  QUnit.equal(samples[0].duration, 3, 'set the first sample duration');
  QUnit.equal(samples[1].duration, 3, 'set the second sample duration');
});

QUnit.test('holds onto the last GOP and prepends the subsequent push operation with that GOP', function() {
  var segment, boxes, samples;

  videoSegmentStream.track.timelineStartInfo.dts = 0;

  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x00, 0x00]),
    nalUnitType: 'seq_parameter_set_rbsp',
    config: {},
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x00, 0x00]),
    nalUnitType: 'pic_parameter_set_rbsp',
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x66, 0x66]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x02]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 2,
    pts: 2
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x03]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 3,
    pts: 3
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x99, 0x99]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 3,
    pts: 3
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x04]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 4,
    pts: 4
  });
  videoSegmentStream.flush();

  videoSegmentStream.on('data', function(data) {
    segment = data.boxes;
  });

  videoSegmentStream.push({
    data: new Uint8Array([0x02, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 5,
    pts: 5
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x02, 0x02]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 6,
    pts: 6
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x00, 0x00]),
    nalUnitType: 'seq_parameter_set_rbsp',
    config: {},
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x00, 0x00]),
    nalUnitType: 'pic_parameter_set_rbsp',
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x11, 0x11]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 6,
    pts: 6
  });
  videoSegmentStream.flush();

  boxes = mp4.tools.inspect(segment);
  samples = boxes[0].boxes[1].boxes[2].samples;
  QUnit.equal(samples.length, 4, 'generated four samples, two from previous segment');
  QUnit.equal(samples[0].size, 12, 'first sample is an AUD + IDR pair');
  QUnit.equal(samples[1].size, 6, 'second sample is an AUD');
  QUnit.equal(samples[2].size, 6, 'third sample is an AUD');
  QUnit.equal(samples[3].size, 24, 'fourth sample is an AUD + PPS + SPS + IDR');
});

QUnit.test('doesn\'t prepend the last GOP if the next segment has earlier PTS', function() {
  var segment, boxes, samples;

  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 10,
    pts: 10
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x66, 0x66]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 10,
    pts: 10
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x02]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 11,
    pts: 11
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x03]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 12,
    pts: 12
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x99, 0x99]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 12,
    pts: 12
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x04]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 13,
    pts: 13
  });
  videoSegmentStream.flush();

  videoSegmentStream.on('data', function(data) {
    segment = data.boxes;
  });

  videoSegmentStream.push({
    data: new Uint8Array([0x02, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 5,
    pts: 5
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x02, 0x02]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 6,
    pts: 6
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x11, 0x11]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 6,
    pts: 6
  });
  videoSegmentStream.flush();

  boxes = mp4.tools.inspect(segment);
  samples = boxes[0].boxes[1].boxes[2].samples;
  QUnit.equal(samples.length, 1, 'generated one sample');
  QUnit.equal(samples[0].size, 12, 'first sample is an AUD + IDR pair');
});

QUnit.test('doesn\'t prepend the last GOP if the next segment has different PPS or SPS', function() {
  var segment, boxes, samples;

  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x00, 0x00]),
    nalUnitType: 'seq_parameter_set_rbsp',
    config: {},
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x00, 0x00]),
    nalUnitType: 'pic_parameter_set_rbsp',
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x66, 0x66]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x02]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 2,
    pts: 2
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x03]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 3,
    pts: 3
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x99, 0x99]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 3,
    pts: 3
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x04]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 4,
    pts: 4
  });
  videoSegmentStream.flush();

  videoSegmentStream.on('data', function(data) {
    segment = data.boxes;
  });

  videoSegmentStream.push({
    data: new Uint8Array([0x02, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 5,
    pts: 5
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x02, 0x02]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 6,
    pts: 6
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x00, 0x01]),
    nalUnitType: 'seq_parameter_set_rbsp',
    config: {},
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x00, 0x01]),
    nalUnitType: 'pic_parameter_set_rbsp',
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x11, 0x11]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 6,
    pts: 6
  });
  videoSegmentStream.flush();

  boxes = mp4.tools.inspect(segment);
  samples = boxes[0].boxes[1].boxes[2].samples;
  QUnit.equal(samples.length, 1, 'generated one sample');
  QUnit.equal(samples[0].size, 24, 'first sample is an AUD + PPS + SPS + IDR');
});

QUnit.test('doesn\'t prepend the last GOP if the next segment is more than 1 seconds in the future', function() {
  var segment, boxes, samples;

  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x66, 0x66]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x02]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 2,
    pts: 2
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x03]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 3,
    pts: 3
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x99, 0x99]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 3,
    pts: 3
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01, 0x04]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 4,
    pts: 4
  });
  videoSegmentStream.flush();

  videoSegmentStream.on('data', function(data) {
    segment = data.boxes;
  });

  videoSegmentStream.push({
    data: new Uint8Array([0x02, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 1000000,
    pts: 1000000
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x02, 0x02]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 1000001,
    pts: 1000001
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x11, 0x11]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 1000001,
    pts: 1000001
  });
  videoSegmentStream.flush();

  boxes = mp4.tools.inspect(segment);
  samples = boxes[0].boxes[1].boxes[2].samples;
  QUnit.equal(samples.length, 1, 'generated one sample');
  QUnit.equal(samples[0].size, 12, 'first sample is an AUD + IDR pair');
});

QUnit.test('track values from seq_parameter_set_rbsp should be cleared by a flush', function() {
  var track;
  videoSegmentStream.on('data', function(data) {
    track = data.track;
  });
  videoSegmentStream.push({
    data: new Uint8Array([0xFF]),
    nalUnitType: 'access_unit_delimiter_rbsp'
  });
  videoSegmentStream.push({
    data: new Uint8Array([0xFF]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr'
  });
  videoSegmentStream.push({
    data: new Uint8Array([0xFF]),
    nalUnitType: 'seq_parameter_set_rbsp',
    config: {
      width: 123,
      height: 321,
      profileIdc: 1,
      levelIdc: 2,
      profileCompatibility: 3
    },
    dts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x88]),
    nalUnitType: 'seq_parameter_set_rbsp',
    config: {
      width: 1234,
      height: 4321,
      profileIdc: 4,
      levelIdc: 5,
      profileCompatibility: 6
    },
    dts: 1
  });
  videoSegmentStream.flush();

  QUnit.equal(track.width, 123, 'width is set by first SPS');
  QUnit.equal(track.height, 321, 'height is set by first SPS');
  QUnit.equal(track.sps[0][0], 0xFF, 'first sps is 0xFF');
  QUnit.equal(track.profileIdc, 1, 'profileIdc is set by first SPS');
  QUnit.equal(track.levelIdc, 2, 'levelIdc is set by first SPS');
  QUnit.equal(track.profileCompatibility, 3, 'profileCompatibility is set by first SPS');

  videoSegmentStream.push({
    data: new Uint8Array([0x99]),
    nalUnitType: 'seq_parameter_set_rbsp',
    config: {
      width: 300,
      height: 200,
      profileIdc: 11,
      levelIdc: 12,
      profileCompatibility: 13
    },
    dts: 1
  });
  videoSegmentStream.flush();

  QUnit.equal(track.width, 300, 'width is set by first SPS after flush');
  QUnit.equal(track.height, 200, 'height is set by first SPS after flush');
  QUnit.equal(track.sps.length, 1, 'there is one sps');
  QUnit.equal(track.sps[0][0], 0x99, 'first sps is 0x99');
  QUnit.equal(track.profileIdc, 11, 'profileIdc is set by first SPS after flush');
  QUnit.equal(track.levelIdc, 12, 'levelIdc is set by first SPS after flush');
  QUnit.equal(track.profileCompatibility, 13, 'profileCompatibility is set by first SPS after flush');
});

QUnit.test('track pps from pic_parameter_set_rbsp should be cleared by a flush', function() {
  var track;
  videoSegmentStream.on('data', function(data) {
    track = data.track;
  });
  videoSegmentStream.push({
    data: new Uint8Array([0xFF]),
    nalUnitType: 'access_unit_delimiter_rbsp'
  });
  videoSegmentStream.push({
    data: new Uint8Array([0xFF]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr'
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x01]),
    nalUnitType: 'pic_parameter_set_rbsp',
    dts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x02]),
    nalUnitType: 'pic_parameter_set_rbsp',
    dts: 1
  });
  videoSegmentStream.flush();

  QUnit.equal(track.pps[0][0], 0x01, 'first pps is 0x01');

  videoSegmentStream.push({
    data: new Uint8Array([0x03]),
    nalUnitType: 'pic_parameter_set_rbsp',
    dts: 1
  });
  videoSegmentStream.flush();

  QUnit.equal(track.pps[0][0], 0x03, 'first pps is 0x03 after a flush');
});

QUnit.test('calculates compositionTimeOffset values from the PTS/DTS', function() {
  var segment, boxes, samples;
  videoSegmentStream.on('data', function(data) {
    segment = data.boxes;
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 1,
    pts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 1,
    pts: 2
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 1,
    pts: 4
  });
  videoSegmentStream.flush();

  boxes = mp4.tools.inspect(segment);
  samples = boxes[0].boxes[1].boxes[2].samples;
  QUnit.equal(samples.length, 3, 'generated three samples');
  QUnit.equal(samples[0].compositionTimeOffset, 0, 'calculated compositionTimeOffset');
  QUnit.equal(samples[1].compositionTimeOffset, 1, 'calculated compositionTimeOffset');
  QUnit.equal(samples[2].compositionTimeOffset, 3, 'calculated compositionTimeOffset');
});

QUnit.test('calculates baseMediaDecodeTime values from the first DTS ever seen and subsequent segments\' lowest DTS', function() {
  var segment, boxes, tfdt;
  videoSegmentStream.on('data', function(data) {
    segment = data.boxes;
  });

  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 100,
    pts: 100
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 100,
    pts: 100
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 200,
    pts: 200
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 300,
    pts: 300
  });
  videoSegmentStream.flush();

  boxes = mp4.tools.inspect(segment);
  tfdt = boxes[0].boxes[1].boxes[1];
  QUnit.equal(tfdt.baseMediaDecodeTime, 90, 'calculated baseMediaDecodeTime');
});

QUnit.test('doesn\'t adjust baseMediaDecodeTime when configured to keep original timestamps', function() {
  videoSegmentStream.options.keepOriginalTimestamps = true;

  var segment, boxes, tfdt;
  videoSegmentStream.on('data', function(data) {
    segment = data.boxes;
  });

  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 100,
    pts: 100
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 100,
    pts: 100
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 200,
    pts: 200
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 300,
    pts: 300
  });
  videoSegmentStream.flush();

  boxes = mp4.tools.inspect(segment);
  tfdt = boxes[0].boxes[1].boxes[1];
  QUnit.equal(tfdt.baseMediaDecodeTime, 100, 'calculated baseMediaDecodeTime');
});

QUnit.test('calculates baseMediaDecodeTime values relative to a customizable baseMediaDecodeTime', function() {
  var segment, boxes, tfdt, baseMediaDecodeTimeValue;

  // Set the baseMediaDecodeTime to something over 2^32 to ensure
  // that the version 1 TFDT box is being created correctly
  baseMediaDecodeTimeValue = Math.pow(2, 32) + 100;

  videoSegmentStream.track.timelineStartInfo = {
    dts: 10,
    pts: 10,
    baseMediaDecodeTime: baseMediaDecodeTimeValue
  };
  videoSegmentStream.on('data', function(data) {
    segment = data.boxes;
  });

  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 100,
    pts: 100
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 100,
    pts: 100
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 200,
    pts: 200
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 300,
    pts: 300
  });
  videoSegmentStream.flush();

  boxes = mp4.tools.inspect(segment);
  tfdt = boxes[0].boxes[1].boxes[1];

  // The timeline begins at 10 and the first sample has a dts of
  // 100, so the baseMediaDecodeTime should be equal to (100 - 10)
  QUnit.equal(tfdt.baseMediaDecodeTime, baseMediaDecodeTimeValue + 90, 'calculated baseMediaDecodeTime');
});

QUnit.test('do not subtract the first frame\'s compositionTimeOffset from baseMediaDecodeTime', function() {
  var segment, boxes, tfdt;
  videoSegmentStream.track.timelineStartInfo = {
    dts: 10,
    pts: 10,
    baseMediaDecodeTime: 100
  };
  videoSegmentStream.on('data', function(data) {
    segment = data.boxes;
  });

  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 50,
    pts: 60
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 50,
    pts: 60
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 100,
    pts: 110
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 150,
    pts: 160
  });
  videoSegmentStream.flush();

  boxes = mp4.tools.inspect(segment);
  tfdt = boxes[0].boxes[1].boxes[1];

  // The timelineStartInfo's bMDT is 100 and that corresponds to a dts/pts of 10
  // The first frame has a dts 50 so the bMDT is calculated as: (50 - 10) + 100 = 140
  QUnit.equal(tfdt.baseMediaDecodeTime, 140, 'calculated baseMediaDecodeTime');
});

QUnit.test('aignGopsAtStart_ filters gops appropriately', function() {
  var gopsToAlignWith, gops, actual, expected;

  // atog === arrayToGops
  var atog = function(list) {
    var mapped = list.map(function(item) {
      return {
        pts: item,
        dts: item,
        nalCount: 1,
        duration: 1,
        byteLength: 1
      };
    });

    mapped.byteLength = mapped.length;
    mapped.nalCount = mapped.length;
    mapped.duration = mapped.length;
    mapped.dts = mapped[0].dts;
    mapped.pts = mapped[0].pts;

    return mapped;
  };

  // no gops to trim, all gops start after any alignment candidates
  gopsToAlignWith = atog([0, 2, 4, 6, 8]);
  gops = atog([10, 12, 13, 14, 16]);
  expected = atog([10, 12, 13, 14, 16]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'no gops to trim, all gops start after any alignment candidates');

  // no gops to trim, first gop has a match with first alignment candidate
  gopsToAlignWith = atog([0, 2, 4, 6, 8]);
  gops = atog([0, 2, 4, 6, 8]);
  expected = atog([0, 2, 4, 6, 8]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'no gops to trim, first gop has a match with first alignment candidate');

  // no gops to trim, first gop has a match with last alignment candidate
  gopsToAlignWith = atog([0, 2, 4, 6, 8]);
  gops = atog([8, 10, 12, 13, 14, 16]);
  expected = atog([8, 10, 12, 13, 14, 16]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'no gops to trim, first gop has a match with last alignment candidate');

  // no gops to trim, first gop has a match with an alignment candidate
  gopsToAlignWith = atog([0, 2, 4, 6, 8]);
  gops = atog([6, 9, 10, 12, 13, 14, 16]);
  expected = atog([6, 9, 10, 12, 13, 14, 16]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'no gops to trim, first gop has a match with an alignment candidate');

  // all gops trimmed, all gops come before first alignment candidate
  gopsToAlignWith = atog([10, 12, 13, 14, 16]);
  gops = atog([0, 2, 4, 6, 8]);
  expected = null;
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'all gops trimmed, all gops come before first alignment candidate');

  // all gops trimmed, all gops come before last alignment candidate, no match found
  gopsToAlignWith = atog([10, 12, 13, 14, 16]);
  gops = atog([0, 2, 4, 6, 8, 11, 15]);
  expected = null;
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'all gops trimmed, all gops come before last alignment candidate, no match found');

  // all gops trimmed, all gops contained between alignment candidates, no match found
  gopsToAlignWith = atog([6, 10, 12, 13, 14, 16]);
  gops = atog([7, 8, 9, 11, 15]);
  expected = null;
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'all gops trimmed, all gops contained between alignment candidates, no match found');

  // some gops trimmed, some gops before first alignment candidate
  // match on first alignment candidate
  gopsToAlignWith = atog([9, 10, 13, 16]);
  gops = atog([7, 8, 9, 10, 12]);
  expected = atog([9, 10, 12]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, some gops before first alignment candidate,' +
    'match on first alignment candidate');

  // some gops trimmed, some gops before first alignment candidate
  // match on an alignment candidate
  gopsToAlignWith = atog([9, 10, 13, 16]);
  gops = atog([7, 8, 11, 13, 14]);
  expected = atog([13, 14]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, some gops before first alignment candidate,' +
    'match on an alignment candidate');

  // some gops trimmed, some gops before first alignment candidate
  // match on last alignment candidate
  gopsToAlignWith = atog([9, 10, 13, 16]);
  gops = atog([7, 8, 11, 12, 15, 16]);
  expected = atog([16]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, some gops before first alignment candidate,' +
    'match on last alignment candidate');

  // some gops trimmed, some gops after last alignment candidate
  // match on an alignment candidate
  gopsToAlignWith = atog([0, 3, 6, 9, 10]);
  gops = atog([4, 5, 9, 11, 13]);
  expected = atog([9, 11, 13]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, some gops after last alignment candidate,' +
    'match on an alignment candidate');

  // some gops trimmed, some gops after last alignment candidate
  // match on last alignment candidate
  gopsToAlignWith = atog([0, 3, 6, 9, 10]);
  gops = atog([4, 5, 7, 10, 13]);
  expected = atog([10, 13]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, some gops after last alignment candidate,' +
    'match on last alignment candidate');

  // some gops trimmed, some gops after last alignment candidate
  // no match found
  gopsToAlignWith = atog([0, 3, 6, 9, 10]);
  gops = atog([4, 5, 7, 13, 15]);
  expected = atog([13, 15]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, some gops after last alignment candidate,' +
    'no match found');

  // some gops trimmed, gops contained between alignment candidates
  // match with an alignment candidate
  gopsToAlignWith = atog([0, 3, 6, 9, 10]);
  gops = atog([2, 4, 6, 8]);
  expected = atog([6, 8]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, gops contained between alignment candidates,' +
    'match with an alignment candidate');

  // some gops trimmed, alignment candidates contained between gops
  // no match
  gopsToAlignWith = atog([3, 6, 9, 10]);
  gops = atog([0, 2, 4, 8, 11, 13]);
  expected = atog([11, 13]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, alignment candidates contained between gops,' +
    'no match');

  // some gops trimmed, alignment candidates contained between gops
  // match with first alignment candidate
  gopsToAlignWith = atog([3, 6, 9, 10]);
  gops = atog([0, 2, 3, 4, 5, 9, 10, 11]);
  expected = atog([3, 4, 5, 9, 10, 11]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, alignment candidates contained between gops,' +
    'match with first alignment candidate');

  // some gops trimmed, alignment candidates contained between gops
  // match with last alignment candidate
  gopsToAlignWith = atog([3, 6, 9, 10]);
  gops = atog([0, 2, 4, 8, 10, 13, 15]);
  expected = atog([10, 13, 15]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, alignment candidates contained between gops,' +
    'match with last alignment candidate');

  // some gops trimmed, alignment candidates contained between gops
  // match with an alignment candidate
  gopsToAlignWith = atog([3, 6, 9, 10]);
  gops = atog([0, 2, 4, 6, 9, 11, 13]);
  expected = atog([6, 9, 11, 13]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtStart_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, alignment candidates contained between gops,' +
    'match with an alignment candidate');
});

QUnit.test('alignGopsAtEnd_ filters gops appropriately', function() {
  var gopsToAlignWith, gops, actual, expected;

  // atog === arrayToGops
  var atog = function(list) {
    var mapped = list.map(function(item) {
      return {
        pts: item,
        dts: item,
        nalCount: 1,
        duration: 1,
        byteLength: 1
      };
    });

    mapped.byteLength = mapped.length;
    mapped.nalCount = mapped.length;
    mapped.duration = mapped.length;
    mapped.dts = mapped[0].dts;
    mapped.pts = mapped[0].pts;

    return mapped;
  };

  // no gops to trim, all gops start after any alignment candidates
  gopsToAlignWith = atog([0, 2, 4, 6, 8]);
  gops = atog([10, 12, 13, 14, 16]);
  expected = atog([10, 12, 13, 14, 16]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'no gops to trim, all gops start after any alignment candidates');

  // no gops to trim, first gop has a match with first alignment candidate
  gopsToAlignWith = atog([0, 2, 4, 6, 8]);
  gops = atog([0, 1, 3, 5, 7]);
  expected = atog([0, 1, 3, 5, 7]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'no gops to trim, first gop has a match with first alignment candidate');

  // no gops to trim, first gop has a match with last alignment candidate
  gopsToAlignWith = atog([0, 2, 4, 6, 8]);
  gops = atog([8, 10, 12, 13, 14, 16]);
  expected = atog([8, 10, 12, 13, 14, 16]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'no gops to trim, first gop has a match with last alignment candidate');

  // no gops to trim, first gop has a match with an alignment candidate
  gopsToAlignWith = atog([0, 2, 4, 6, 8]);
  gops = atog([6, 9, 10, 12, 13, 14, 16]);
  expected = atog([6, 9, 10, 12, 13, 14, 16]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'no gops to trim, first gop has a match with an alignment candidate');

  // all gops trimmed, all gops come before first alignment candidate
  gopsToAlignWith = atog([10, 12, 13, 14, 16]);
  gops = atog([0, 2, 4, 6, 8]);
  expected = null;
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'all gops trimmed, all gops come before first alignment candidate');

  // all gops trimmed, all gops come before last alignment candidate, no match found
  gopsToAlignWith = atog([10, 12, 13, 14, 16]);
  gops = atog([0, 2, 4, 6, 8, 11, 15]);
  expected = null;
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'all gops trimmed, all gops come before last alignment candidate, no match found');

  gopsToAlignWith = atog([10, 12, 13, 14, 16]);
  gops = atog([8, 11, 15]);
  expected = null;
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'all gops trimmed, all gops come before last alignment candidate, no match found');

  // all gops trimmed, all gops contained between alignment candidates, no match found
  gopsToAlignWith = atog([6, 10, 12, 13, 14, 16]);
  gops = atog([7, 8, 9, 11, 15]);
  expected = null;
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'all gops trimmed, all gops contained between alignment candidates, no match found');

  // some gops trimmed, some gops before first alignment candidate
  // match on first alignment candidate
  gopsToAlignWith = atog([9, 11, 13, 16]);
  gops = atog([7, 8, 9, 10, 12]);
  expected = atog([9, 10, 12]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, some gops before first alignment candidate,' +
    'match on first alignment candidate');

  // some gops trimmed, some gops before first alignment candidate
  // match on an alignment candidate
  gopsToAlignWith = atog([9, 10, 11, 13, 16]);
  gops = atog([7, 8, 11, 13, 14, 15]);
  expected = atog([13, 14, 15]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, some gops before first alignment candidate,' +
    'match on an alignment candidate');

  // some gops trimmed, some gops before first alignment candidate
  // match on last alignment candidate
  gopsToAlignWith = atog([9, 10, 13, 16]);
  gops = atog([7, 8, 11, 12, 15, 16]);
  expected = atog([16]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, some gops before first alignment candidate,' +
    'match on last alignment candidate');

  // some gops trimmed, some gops after last alignment candidate
  // match on an alignment candidate
  gopsToAlignWith = atog([0, 3, 6, 9, 10]);
  gops = atog([4, 5, 6, 9, 11, 13]);
  expected = atog([9, 11, 13]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, some gops after last alignment candidate,' +
    'match on an alignment candidate');

  // some gops trimmed, some gops after last alignment candidate
  // match on last alignment candidate
  gopsToAlignWith = atog([0, 3, 6, 9, 10]);
  gops = atog([4, 5, 7, 9, 10, 13]);
  expected = atog([10, 13]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, some gops after last alignment candidate,' +
    'match on last alignment candidate');

  // some gops trimmed, some gops after last alignment candidate
  // no match found
  gopsToAlignWith = atog([0, 3, 6, 9, 10]);
  gops = atog([4, 5, 7, 13, 15]);
  expected = atog([13, 15]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, some gops after last alignment candidate,' +
    'no match found');

  // some gops trimmed, gops contained between alignment candidates
  // match with an alignment candidate
  gopsToAlignWith = atog([0, 3, 6, 9, 10]);
  gops = atog([2, 4, 6, 8]);
  expected = atog([6, 8]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, gops contained between alignment candidates,' +
    'match with an alignment candidate');

  // some gops trimmed, alignment candidates contained between gops
  // no match
  gopsToAlignWith = atog([3, 6, 9, 10]);
  gops = atog([0, 2, 4, 8, 11, 13]);
  expected = atog([11, 13]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, alignment candidates contained between gops,' +
    'no match');

  // some gops trimmed, alignment candidates contained between gops
  // match with first alignment candidate
  gopsToAlignWith = atog([3, 6, 9, 10]);
  gops = atog([0, 2, 3, 4, 5, 11]);
  expected = atog([3, 4, 5, 11]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, alignment candidates contained between gops,' +
    'match with first alignment candidate');

  // some gops trimmed, alignment candidates contained between gops
  // match with last alignment candidate
  gopsToAlignWith = atog([3, 6, 9, 10]);
  gops = atog([0, 2, 4, 8, 10, 13, 15]);
  expected = atog([10, 13, 15]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, alignment candidates contained between gops,' +
    'match with last alignment candidate');

  // some gops trimmed, alignment candidates contained between gops
  // match with an alignment candidate
  gopsToAlignWith = atog([3, 6, 9, 10]);
  gops = atog([0, 2, 4, 6, 9, 11, 13]);
  expected = atog([9, 11, 13]);
  videoSegmentStream.alignGopsWith(gopsToAlignWith);
  actual = videoSegmentStream.alignGopsAtEnd_(gops);
  QUnit.deepEqual(actual, expected,
    'some gops trimmed, alignment candidates contained between gops,' +
    'match with an alignment candidate');
});

QUnit.module('ADTS Stream', {
  setup: function() {
    adtsStream = new AdtsStream();
  }
});

QUnit.test('generates AAC frame events from ADTS bytes', function() {
  var frames = [];
  adtsStream.on('data', function(frame) {
    frames.push(frame);
  });
  adtsStream.push({
    type: 'audio',
    data: new Uint8Array([
      0xff, 0xf1,       // no CRC
      0x10,             // AAC Main, 44.1KHz
      0xbc, 0x01, 0x20, // 2 channels, frame length 9 bytes
      0x00,             // one AAC per ADTS frame
      0x12, 0x34,       // AAC payload
      0x56, 0x78        // extra junk that should be ignored
    ])
  });

  QUnit.equal(frames.length, 1, 'generated one frame');
  QUnit.deepEqual(new Uint8Array(frames[0].data),
            new Uint8Array([0x12, 0x34]),
            'extracted AAC frame');
  QUnit.equal(frames[0].channelcount, 2, 'parsed channelcount');
  QUnit.equal(frames[0].samplerate, 44100, 'parsed samplerate');

  // Chrome only supports 8, 16, and 32 bit sample sizes. Assuming the
  // default value of 16 in ISO/IEC 14496-12 AudioSampleEntry is
  // acceptable.
  QUnit.equal(frames[0].samplesize, 16, 'parsed samplesize');
});

QUnit.test('parses across packets', function() {
  var frames = [];
  adtsStream.on('data', function(frame) {
    frames.push(frame);
  });
  adtsStream.push({
    type: 'audio',
    data: new Uint8Array([
      0xff, 0xf1,       // no CRC
      0x10,             // AAC Main, 44.1KHz
      0xbc, 0x01, 0x20, // 2 channels, frame length 9 bytes
      0x00,             // one AAC per ADTS frame
      0x12, 0x34        // AAC payload 1
    ])
  });
  adtsStream.push({
    type: 'audio',
    data: new Uint8Array([
      0xff, 0xf1,       // no CRC
      0x10,             // AAC Main, 44.1KHz
      0xbc, 0x01, 0x20, // 2 channels, frame length 9 bytes
      0x00,             // one AAC per ADTS frame
      0x9a, 0xbc,       // AAC payload 2
      0xde, 0xf0        // extra junk that should be ignored
    ])
  });

  QUnit.equal(frames.length, 2, 'parsed two frames');
  QUnit.deepEqual(new Uint8Array(frames[1].data),
            new Uint8Array([0x9a, 0xbc]),
            'extracted the second AAC frame');
});

QUnit.test('parses frames segmented across packet', function() {
  var frames = [];
  adtsStream.on('data', function(frame) {
    frames.push(frame);
  });
  adtsStream.push({
    type: 'audio',
    data: new Uint8Array([
      0xff, 0xf1,       // no CRC
      0x10,             // AAC Main, 44.1KHz
      0xbc, 0x01, 0x20, // 2 channels, frame length 9 bytes
      0x00,             // one AAC per ADTS frame
      0x12        // incomplete AAC payload 1
    ])
  });
  adtsStream.push({
    type: 'audio',
    data: new Uint8Array([
      0x34,             // remainder of the previous frame's payload
      0xff, 0xf1,       // no CRC
      0x10,             // AAC Main, 44.1KHz
      0xbc, 0x01, 0x20, // 2 channels, frame length 9 bytes
      0x00,             // one AAC per ADTS frame
      0x9a, 0xbc,       // AAC payload 2
      0xde, 0xf0        // extra junk that should be ignored
    ])
  });

  QUnit.equal(frames.length, 2, 'parsed two frames');
  QUnit.deepEqual(new Uint8Array(frames[0].data),
            new Uint8Array([0x12, 0x34]),
            'extracted the first AAC frame');
  QUnit.deepEqual(new Uint8Array(frames[1].data),
            new Uint8Array([0x9a, 0xbc]),
            'extracted the second AAC frame');
});

QUnit.test('resyncs data in aac frames that contain garbage', function() {
  var frames = [];
  adtsStream.on('data', function(frame) {
    frames.push(frame);
  });

  adtsStream.push({
    type: 'audio',
    data: new Uint8Array([
      0x67,             // garbage
      0xff, 0xf1,       // no CRC
      0x10,             // AAC Main, 44.1KHz
      0xbc, 0x01, 0x20, // 2 channels, frame length 9 bytes
      0x00,             // one AAC per ADTS frame
      0x9a, 0xbc,       // AAC payload 1
      0xde, 0xf0        // extra junk that should be ignored
    ])
  });
  adtsStream.push({
    type: 'audio',
    data: new Uint8Array([
      0x67,             // garbage
      0xff, 0xf1,       // no CRC
      0x10,             // AAC Main, 44.1KHz
      0xbc, 0x01, 0x20, // 2 channels, frame length 9 bytes
      0x00,             // one AAC per ADTS frame
      0x12, 0x34        // AAC payload 2
    ])
  });

  QUnit.equal(frames.length, 2, 'parsed two frames');
  QUnit.deepEqual(new Uint8Array(frames[0].data),
            new Uint8Array([0x9a, 0xbc]),
            'extracted the first AAC frame');
  QUnit.deepEqual(new Uint8Array(frames[1].data),
            new Uint8Array([0x12, 0x34]),
            'extracted the second AAC frame');
});

QUnit.test('ignores audio "MPEG version" bit in adts header', function() {
  var frames = [];
  adtsStream.on('data', function(frame) {
    frames.push(frame);
  });
  adtsStream.push({
    type: 'audio',
    data: new Uint8Array([
      0xff, 0xf8,       // MPEG-2 audio, CRC
      0x10,             // AAC Main, 44.1KHz
      0xbc, 0x01, 0x60, // 2 channels, frame length 11 bytes
      0x00,             // one AAC per ADTS frame
      0xfe, 0xdc,       // "CRC"
      0x12, 0x34        // AAC payload 2
    ])
  });

  QUnit.equal(frames.length, 1, 'parsed a frame');
  QUnit.deepEqual(new Uint8Array(frames[0].data),
            new Uint8Array([0x12, 0x34]),
            'skipped the CRC');
});

QUnit.test('skips CRC bytes', function() {
  var frames = [];
  adtsStream.on('data', function(frame) {
    frames.push(frame);
  });
  adtsStream.push({
    type: 'audio',
    data: new Uint8Array([
      0xff, 0xf0,       // with CRC
      0x10,             // AAC Main, 44.1KHz
      0xbc, 0x01, 0x60, // 2 channels, frame length 11 bytes
      0x00,             // one AAC per ADTS frame
      0xfe, 0xdc,       // "CRC"
      0x12, 0x34        // AAC payload 2
    ])
  });

  QUnit.equal(frames.length, 1, 'parsed a frame');
  QUnit.deepEqual(new Uint8Array(frames[0].data),
            new Uint8Array([0x12, 0x34]),
            'skipped the CRC');
});

QUnit.module('AudioSegmentStream', {
  setup: function() {
    var track = {
      type: 'audio',
      samplerate: 90e3 // no scaling
    };
    audioSegmentStream = new AudioSegmentStream(track);
    audioSegmentStream.track = track;
    audioSegmentStream.track.timelineStartInfo = {
      dts: 111,
      pts: 111,
      baseMediaDecodeTime: 0
    };
  }
});

QUnit.test('fills audio gaps taking into account audio sample rate', function() {
  var
    events = [],
    boxes,
    numSilentFrames,
    videoGap = 0.29,
    audioGap = 0.49,
    expectedFillSeconds = audioGap - videoGap,
    sampleRate = 44100,
    frameDuration = Math.ceil(90e3 / (sampleRate / 1024)),
    frameSeconds = clock.videoTsToSeconds(frameDuration),
    audioBMDT,
    offsetSeconds = clock.videoTsToSeconds(111),
    startingAudioBMDT = clock.secondsToAudioTs(10 + audioGap - offsetSeconds, sampleRate);

  audioSegmentStream.on('data', function(event) {
    events.push(event);
  });

  audioSegmentStream.setAudioAppendStart(clock.secondsToVideoTs(10));
  audioSegmentStream.setVideoBaseMediaDecodeTime(clock.secondsToVideoTs(10 + videoGap));

  audioSegmentStream.push({
    channelcount: 2,
    samplerate: sampleRate,
    pts: clock.secondsToVideoTs(10 + audioGap),
    dts: clock.secondsToVideoTs(10 + audioGap),
    data: new Uint8Array([1])
  });

  audioSegmentStream.flush();

  numSilentFrames = Math.floor(expectedFillSeconds / frameSeconds);

  QUnit.equal(events.length, 1, 'a data event fired');
  QUnit.equal(events[0].track.samples.length, 1 + numSilentFrames, 'generated samples');
  QUnit.equal(events[0].track.samples[0].size, 364, 'silent sample');
  QUnit.equal(events[0].track.samples[7].size, 364, 'silent sample');
  QUnit.equal(events[0].track.samples[8].size, 1, 'normal sample');
  boxes = mp4.tools.inspect(events[0].boxes);

  audioBMDT = boxes[0].boxes[1].boxes[1].baseMediaDecodeTime;

  QUnit.equal(
    audioBMDT,
    // should always be rounded up so as not to overfill
    Math.ceil(startingAudioBMDT -
              clock.secondsToAudioTs(numSilentFrames * frameSeconds, sampleRate)),
    'filled the gap to the nearest frame');
  QUnit.equal(
    Math.floor(clock.audioTsToVideoTs(audioBMDT, sampleRate) -
               clock.secondsToVideoTs(10 + videoGap)),
    Math.floor(clock.secondsToVideoTs(expectedFillSeconds) % frameDuration -
               clock.secondsToVideoTs(offsetSeconds)),
               'filled all but frame remainder between video start and audio start');
});

QUnit.test('fills audio gaps with existing frame if odd sample rate', function() {
  var
    events = [],
    boxes,
    numSilentFrames,
    videoGap = 0.29,
    audioGap = 0.49,
    expectedFillSeconds = audioGap - videoGap,
    sampleRate = 90e3, // we don't have matching silent frames
    frameDuration = Math.ceil(90e3 / (sampleRate / 1024)),
    frameSeconds = clock.videoTsToSeconds(frameDuration),
    audioBMDT,
    offsetSeconds = clock.videoTsToSeconds(111),
    startingAudioBMDT = clock.secondsToAudioTs(10 + audioGap - offsetSeconds, sampleRate);

  audioSegmentStream.on('data', function(event) {
    events.push(event);
  });

  audioSegmentStream.setAudioAppendStart(clock.secondsToVideoTs(10));
  audioSegmentStream.setVideoBaseMediaDecodeTime(clock.secondsToVideoTs(10 + videoGap));

  audioSegmentStream.push({
    channelcount: 2,
    samplerate: sampleRate,
    pts: clock.secondsToVideoTs(10 + audioGap),
    dts: clock.secondsToVideoTs(10 + audioGap),
    data: new Uint8Array([1])
  });

  audioSegmentStream.flush();

  numSilentFrames = Math.floor(expectedFillSeconds / frameSeconds);

  QUnit.equal(events.length, 1, 'a data event fired');
  QUnit.equal(events[0].track.samples.length, 1 + numSilentFrames, 'generated samples');
  QUnit.equal(events[0].track.samples[0].size, 1, 'copied sample');
  QUnit.equal(events[0].track.samples[7].size, 1, 'copied sample');
  QUnit.equal(events[0].track.samples[8].size, 1, 'normal sample');
  boxes = mp4.tools.inspect(events[0].boxes);

  audioBMDT = boxes[0].boxes[1].boxes[1].baseMediaDecodeTime;

  QUnit.equal(
    audioBMDT,
    // should always be rounded up so as not to overfill
    Math.ceil(startingAudioBMDT -
              clock.secondsToAudioTs(numSilentFrames * frameSeconds, sampleRate)),
    'filled the gap to the nearest frame');
  QUnit.equal(
    Math.floor(clock.audioTsToVideoTs(audioBMDT, sampleRate) -
               clock.secondsToVideoTs(10 + videoGap)),
    Math.floor(clock.secondsToVideoTs(expectedFillSeconds) % frameDuration -
               clock.secondsToVideoTs(offsetSeconds)),
               'filled all but frame remainder between video start and audio start');
});

QUnit.test('fills audio gaps with smaller of audio gap and audio-video gap', function() {
  var
    events = [],
    boxes,
    offsetSeconds = clock.videoTsToSeconds(111),
    videoGap = 0.29,
    sampleRate = 44100,
    frameDuration = Math.ceil(90e3 / (sampleRate / 1024)),
    frameSeconds = clock.videoTsToSeconds(frameDuration),
    // audio gap smaller, should be used as fill
    numSilentFrames = 1,
    // buffer for imprecise numbers
    audioGap = frameSeconds + offsetSeconds + 0.001,
    oldAudioEnd = 10.5,
    audioBMDT;

  audioSegmentStream.on('data', function(event) {
    events.push(event);
  });

  audioSegmentStream.setAudioAppendStart(clock.secondsToVideoTs(oldAudioEnd));
  audioSegmentStream.setVideoBaseMediaDecodeTime(clock.secondsToVideoTs(10 + videoGap));

  audioSegmentStream.push({
    channelcount: 2,
    samplerate: sampleRate,
    pts: clock.secondsToVideoTs(oldAudioEnd + audioGap),
    dts: clock.secondsToVideoTs(oldAudioEnd + audioGap),
    data: new Uint8Array([1])
  });

  audioSegmentStream.flush();

  QUnit.equal(events.length, 1, 'a data event fired');
  QUnit.equal(events[0].track.samples.length, 1 + numSilentFrames, 'generated samples');
  QUnit.equal(events[0].track.samples[0].size, 364, 'silent sample');
  QUnit.equal(events[0].track.samples[1].size, 1, 'normal sample');
  boxes = mp4.tools.inspect(events[0].boxes);

  audioBMDT = boxes[0].boxes[1].boxes[1].baseMediaDecodeTime;

  QUnit.equal(
    Math.floor(clock.secondsToVideoTs(oldAudioEnd + audioGap) -
               clock.audioTsToVideoTs(audioBMDT, sampleRate) -
               clock.secondsToVideoTs(offsetSeconds)),
    Math.floor(frameDuration + 0.001),
    'filled length of audio gap only');
});

QUnit.test('does not fill audio gaps if no audio append start time', function() {
  var
    events = [],
    boxes,
    videoGap = 0.29,
    audioGap = 0.49;

  audioSegmentStream.on('data', function(event) {
    events.push(event);
  });

  audioSegmentStream.setVideoBaseMediaDecodeTime((10 + videoGap) * 90e3);

  audioSegmentStream.push({
    channelcount: 2,
    samplerate: 90e3,
    pts: (10 + audioGap) * 90e3,
    dts: (10 + audioGap) * 90e3,
    data: new Uint8Array([1])
  });

  audioSegmentStream.flush();

  QUnit.equal(events.length, 1, 'a data event fired');
  QUnit.equal(events[0].track.samples.length, 1, 'generated samples');
  QUnit.equal(events[0].track.samples[0].size, 1, 'normal sample');
  boxes = mp4.tools.inspect(events[0].boxes);
  QUnit.equal(boxes[0].boxes[1].boxes[1].baseMediaDecodeTime,
              (10 + audioGap) * 90e3 - 111,
              'did not fill gap');
});

QUnit.test('does not fill audio gap if no video base media decode time', function() {
  var
    events = [],
    boxes,
    audioGap = 0.49;

  audioSegmentStream.on('data', function(event) {
    events.push(event);
  });

  audioSegmentStream.setAudioAppendStart(10 * 90e3);

  audioSegmentStream.push({
    channelcount: 2,
    samplerate: 90e3,
    pts: (10 + audioGap) * 90e3,
    dts: (10 + audioGap) * 90e3,
    data: new Uint8Array([1])
  });

  audioSegmentStream.flush();

  QUnit.equal(events.length, 1, 'a data event fired');
  QUnit.equal(events[0].track.samples.length, 1, 'generated samples');
  QUnit.equal(events[0].track.samples[0].size, 1, 'normal sample');
  boxes = mp4.tools.inspect(events[0].boxes);
  QUnit.equal(boxes[0].boxes[1].boxes[1].baseMediaDecodeTime,
              (10 + audioGap) * 90e3 - 111,
              'did not fill the gap');
});

QUnit.test('does not fill audio gaps greater than a half second', function() {
  var
    events = [],
    boxes,
    videoGap = 0.01,
    audioGap = videoGap + 0.51;

  audioSegmentStream.on('data', function(event) {
    events.push(event);
  });

  audioSegmentStream.setAudioAppendStart(10 * 90e3);
  audioSegmentStream.setVideoBaseMediaDecodeTime((10 + videoGap) * 90e3);

  audioSegmentStream.push({
    channelcount: 2,
    samplerate: 90e3,
    pts: (10 + audioGap) * 90e3,
    dts: (10 + audioGap) * 90e3,
    data: new Uint8Array([1])
  });

  audioSegmentStream.flush();

  QUnit.equal(events.length, 1, 'a data event fired');
  QUnit.equal(events[0].track.samples.length, 1, 'generated samples');
  QUnit.equal(events[0].track.samples[0].size, 1, 'normal sample');
  boxes = mp4.tools.inspect(events[0].boxes);
  QUnit.equal(boxes[0].boxes[1].boxes[1].baseMediaDecodeTime,
              (10 + audioGap) * 90e3 - 111,
              'did not fill gap');
});

QUnit.test('does not fill audio gaps smaller than a frame duration', function() {
  var
    events = [],
    boxes,
    offsetSeconds = clock.videoTsToSeconds(111),
    // audio gap small enough that it shouldn't be filled
    audioGap = 0.001,
    newVideoStart = 10,
    oldAudioEnd = 10.3,
    newAudioStart = oldAudioEnd + audioGap + offsetSeconds;

  audioSegmentStream.on('data', function(event) {
    events.push(event);
  });

  // the real audio gap is tiny, but the gap between the new video and audio segments
  // would be large enough to fill
  audioSegmentStream.setAudioAppendStart(clock.secondsToVideoTs(oldAudioEnd));
  audioSegmentStream.setVideoBaseMediaDecodeTime(clock.secondsToVideoTs(newVideoStart));

  audioSegmentStream.push({
    channelcount: 2,
    samplerate: 90e3,
    pts: clock.secondsToVideoTs(newAudioStart),
    dts: clock.secondsToVideoTs(newAudioStart),
    data: new Uint8Array([1])
  });

  audioSegmentStream.flush();

  QUnit.equal(events.length, 1, 'a data event fired');
  QUnit.equal(events[0].track.samples.length, 1, 'generated samples');
  QUnit.equal(events[0].track.samples[0].size, 1, 'normal sample');
  boxes = mp4.tools.inspect(events[0].boxes);
  QUnit.equal(boxes[0].boxes[1].boxes[1].baseMediaDecodeTime,
              clock.secondsToVideoTs(newAudioStart - offsetSeconds),
              'did not fill gap');
});

QUnit.test('ensures baseMediaDecodeTime for audio is not negative', function() {
  var events = [], boxes;

  audioSegmentStream.on('data', function(event) {
    events.push(event);
  });
  audioSegmentStream.track.timelineStartInfo.baseMediaDecodeTime = 10;
  audioSegmentStream.setEarliestDts(111);
  audioSegmentStream.push({
    channelcount: 2,
    samplerate: 90e3,
    pts: 111 - 10 - 1, // before the earliest DTS
    dts: 111 - 10 - 1, // before the earliest DTS
    data: new Uint8Array([0])
  });
  audioSegmentStream.push({
    channelcount: 2,
    samplerate: 90e3,
    pts: 111 - 10 + 2, // after the earliest DTS
    dts: 111 - 10 + 2, // after the earliest DTS
    data: new Uint8Array([1])
  });
  audioSegmentStream.flush();

  QUnit.equal(events.length, 1, 'a data event fired');
  QUnit.equal(events[0].track.samples.length, 1, 'generated only one sample');
  boxes = mp4.tools.inspect(events[0].boxes);
  QUnit.equal(boxes[0].boxes[1].boxes[1].baseMediaDecodeTime, 2, 'kept the later sample');
});

QUnit.test('audio track metadata takes on the value of the last metadata seen', function() {
  var events = [];

  audioSegmentStream.on('data', function(event) {
    events.push(event);
  });

  audioSegmentStream.push({
    channelcount: 2,
    samplerate: 90e3,
    pts: 100,
    dts: 100,
    data: new Uint8Array([0])
  });
  audioSegmentStream.push({
    channelcount: 4,
    samplerate: 10000,
    pts: 111,
    dts: 111,
    data: new Uint8Array([1])
  });
  audioSegmentStream.flush();

  QUnit.equal(events.length, 1, 'a data event fired');
  QUnit.equal(events[0].track.samples.length, 2, 'generated two samples');
  QUnit.equal(events[0].track.samplerate, 10000, 'kept the later samplerate');
  QUnit.equal(events[0].track.channelcount, 4, 'kept the later channelcount');
});

QUnit.module('Transmuxer - options');

QUnit.test('no options creates combined output', function() {
  var
    segments = [],
    boxes,
    initSegment,
    transmuxer = new Transmuxer();

  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true,
    hasAudio: true
  })));

  transmuxer.push(packetize(audioPes([
    0x19, 0x47
  ], true)));
  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true)));
  transmuxer.push(packetize(videoPes([
      0x08, 0x01 // pic_parameter_set_rbsp
  ], true)));
  transmuxer.push(packetize(videoPes([
    0x07, // seq_parameter_set_rbsp
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], false)));
  transmuxer.push(packetize(videoPes([
      0x05, 0x01 // slice_layer_without_partitioning_rbsp_idr
  ], true)));
  transmuxer.flush();

  QUnit.equal(segments.length, 1, 'generated a combined video and audio segment');
  QUnit.equal(segments[0].type, 'combined', 'combined is the segment type');

  boxes = mp4.tools.inspect(segments[0].data);
  initSegment = mp4.tools.inspect(segments[0].initSegment);
  QUnit.equal(initSegment.length, 2, 'generated 2 init segment boxes');
  QUnit.equal('ftyp', initSegment[0].type, 'generated an ftyp box');
  QUnit.equal('moov', initSegment[1].type, 'generated a single moov box');
  QUnit.equal(boxes.length, 4, 'generated 4 top-level boxes');
  QUnit.equal('moof', boxes[0].type, 'generated a first moof box');
  QUnit.equal('mdat', boxes[1].type, 'generated a first mdat box');
  QUnit.equal('moof', boxes[2].type, 'generated a second moof box');
  QUnit.equal('mdat', boxes[3].type, 'generated a second mdat box');
});

QUnit.test('can specify that we want to generate separate audio and video segments', function() {
  var
    segments = [],
    segmentLengthOnDone,
    boxes,
    initSegment,
    transmuxer = new Transmuxer({remux: false});

  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });
  transmuxer.on('done', function(segment) {
    if (!segmentLengthOnDone) {
      segmentLengthOnDone = segments.length;
    }
  });

  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true,
    hasAudio: true
  })));

  transmuxer.push(packetize(audioPes([
    0x19, 0x47
  ], true)));
  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true)));
  transmuxer.push(packetize(videoPes([
      0x08, 0x01 // pic_parameter_set_rbsp
  ], true)));
  transmuxer.push(packetize(videoPes([
    0x07, // seq_parameter_set_rbsp
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], false)));
  transmuxer.push(packetize(videoPes([
      0x05, 0x01 // slice_layer_without_partitioning_rbsp_idr
  ], true)));
  transmuxer.flush();

  QUnit.equal(segmentLengthOnDone, 2, 'emitted both segments before triggering done');
  QUnit.equal(segments.length, 2, 'generated a video and an audio segment');
  QUnit.ok(segments[0].type === 'video' || segments[1].type === 'video', 'one segment is video');
  QUnit.ok(segments[0].type === 'audio' || segments[1].type === 'audio', 'one segment is audio');

  boxes = mp4.tools.inspect(segments[0].data);
  initSegment = mp4.tools.inspect(segments[0].initSegment);
  QUnit.equal(initSegment.length, 2, 'generated 2 top-level initSegment boxes');
  QUnit.equal(boxes.length, 2, 'generated 2 top-level boxes');
  QUnit.equal('ftyp', initSegment[0].type, 'generated an ftyp box');
  QUnit.equal('moov', initSegment[1].type, 'generated a moov box');
  QUnit.equal('moof', boxes[0].type, 'generated a moof box');
  QUnit.equal('mdat', boxes[1].type, 'generated a mdat box');

  boxes = mp4.tools.inspect(segments[1].data);
  initSegment = mp4.tools.inspect(segments[1].initSegment);
  QUnit.equal(initSegment.length, 2, 'generated 2 top-level initSegment boxes');
  QUnit.equal(boxes.length, 2, 'generated 2 top-level boxes');
  QUnit.equal('ftyp', initSegment[0].type, 'generated an ftyp box');
  QUnit.equal('moov', initSegment[1].type, 'generated a moov box');
  QUnit.equal('moof', boxes[0].type, 'generated a moof box');
  QUnit.equal('mdat', boxes[1].type, 'generated a mdat box');
});

QUnit.module('MP4 - Transmuxer', {
  setup: function() {
    transmuxer = new Transmuxer();
  }
});

QUnit.test('generates a video init segment', function() {
  var segments = [], boxes;
  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true
  })));

  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true)));
  transmuxer.push(packetize(videoPes([
      0x08, 0x01 // pic_parameter_set_rbsp
  ], true)));
  transmuxer.push(packetize(videoPes([
    0x07, // seq_parameter_set_rbsp
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], false)));
  transmuxer.push(packetize(videoPes([
      0x05, 0x01 // slice_layer_without_partitioning_rbsp_idr
  ], true)));
  transmuxer.flush();

  QUnit.equal(segments.length, 1, 'generated a segment');
  QUnit.ok(segments[0].data, 'wrote data in the init segment');
  QUnit.equal(segments[0].type, 'video', 'video is the segment type');
  QUnit.ok(segments[0].info, 'video info is alongside video segments/bytes');

  mp4VideoProperties.forEach(function(prop) {
    QUnit.ok(segments[0].info[prop], 'video info has ' + prop);
  });

  boxes = mp4.tools.inspect(segments[0].initSegment);
  QUnit.equal('ftyp', boxes[0].type, 'generated an ftyp box');
  QUnit.equal('moov', boxes[1].type, 'generated a moov box');
});

QUnit.test('generates an audio init segment', function() {
  var segments = [], boxes;
  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasAudio: true
  })));
  transmuxer.push(packetize(audioPes([
    0x19, 0x47
  ], true)));
  transmuxer.flush();

  QUnit.equal(segments.length, 1, 'generated a segment');
  QUnit.ok(segments[0].data, 'wrote data in the init segment');
  QUnit.equal(segments[0].type, 'audio', 'audio is the segment type');
  QUnit.ok(segments[0].info, 'audio info is alongside audio segments/bytes');
  mp4AudioProperties.forEach(function(prop) {
    QUnit.ok(segments[0].info[prop], 'audio info has ' + prop);
  });

  boxes = mp4.tools.inspect(segments[0].initSegment);
  QUnit.equal('ftyp', boxes[0].type, 'generated an ftyp box');
  QUnit.equal('moov', boxes[1].type, 'generated a moov box');
});

QUnit.test('buffers video samples until flushed', function() {
  var samples = [], offset, boxes, initSegment;
  transmuxer.on('data', function(data) {
    samples.push(data);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true
  })));

  // buffer a NAL
  transmuxer.push(packetize(videoPes([0x09, 0x01], true)));
  transmuxer.push(packetize(videoPes([0x05, 0x02])));

  // add an access_unit_delimiter_rbsp
  transmuxer.push(packetize(videoPes([0x09, 0x03])));
  transmuxer.push(packetize(videoPes([0x00, 0x04])));
  transmuxer.push(packetize(videoPes([0x00, 0x05])));

  // flush everything
  transmuxer.flush();
  QUnit.equal(samples.length, 1, 'emitted one event');
  boxes = mp4.tools.inspect(samples[0].data);
  initSegment = mp4.tools.inspect(samples[0].initSegment);
  QUnit.equal(boxes.length, 2, 'generated two boxes');
  QUnit.equal(initSegment.length, 2, 'generated two init segment boxes');
  QUnit.equal(boxes[0].type, 'moof', 'the first box is a moof');
  QUnit.equal(boxes[1].type, 'mdat', 'the second box is a mdat');

  offset = boxes[0].size + 8;
  QUnit.deepEqual(new Uint8Array(samples[0].data.subarray(offset)),
            new Uint8Array([
              0, 0, 0, 2,
              0x09, 0x01,
              0, 0, 0, 2,
              0x05, 0x02,
              0, 0, 0, 2,
              0x09, 0x03,
              0, 0, 0, 2,
              0x00, 0x04,
              0, 0, 0, 2,
              0x00, 0x05]),
            'concatenated NALs into an mdat');
});

QUnit.test('creates a metadata stream', function() {
  transmuxer.push(packetize(PAT));
  QUnit.ok(transmuxer.transmuxPipeline_.metadataStream, 'created a metadata stream');
});

QUnit.test('pipes timed metadata to the metadata stream', function() {
  var metadatas = [];
  transmuxer.push(packetize(PAT));
  transmuxer.transmuxPipeline_.metadataStream.on('data', function(data) {
    metadatas.push(data);
  });
  transmuxer.push(packetize(PMT));
  transmuxer.push(packetize(timedMetadataPes([0x03])));

  transmuxer.flush();
  QUnit.equal(metadatas.length, 1, 'emitted timed metadata');
});

QUnit.test('pipeline dynamically configures itself based on input', function() {
  var id3 = id3Generator;

  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasAudio: true
  })));
  transmuxer.push(packetize(timedMetadataPes([0x03])));
  transmuxer.flush();
  QUnit.equal(transmuxer.transmuxPipeline_.type, 'ts', 'detected TS file data');

  transmuxer.push(new Uint8Array(id3.id3Tag(id3.id3Frame('PRIV', 0x00, 0x01))));
  transmuxer.flush();
  QUnit.equal(transmuxer.transmuxPipeline_.type, 'aac', 'detected AAC file data');
});

QUnit.test('reuses audio track object when the pipeline reconfigures itself', function() {
  var boxes, segments = [],
    id3Tag = new Uint8Array(73),
    streamTimestamp = 'com.apple.streaming.transportStreamTimestamp',
    priv = 'PRIV',
    i,
    adtsPayload;

  id3Tag[0] = 73;
  id3Tag[1] = 68;
  id3Tag[2] = 51;
  id3Tag[3] = 4;
  id3Tag[9] = 63;
  id3Tag[17] = 53;
  id3Tag[70] = 13;
  id3Tag[71] = 187;
  id3Tag[72] = 160;

  for (i = 0; i < priv.length; i++) {
    id3Tag[i + 10] = priv.charCodeAt(i);
  }
  for (i = 0; i < streamTimestamp.length; i++) {
    id3Tag[i + 20] = streamTimestamp.charCodeAt(i);
  }

  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });

  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(packetize(generatePMT({
    hasAudio: true
  }))));
  transmuxer.push(packetize(audioPes([0x19, 0x47], true, 10000)));
  transmuxer.flush();

  boxes = mp4.tools.inspect(segments[0].data);

  QUnit.equal(boxes[0].boxes[1].boxes[1].baseMediaDecodeTime,
    0,
    'first segment starts at 0 pts');

  adtsPayload = new Uint8Array(adtsFrame(2).concat([0x19, 0x47]));

  transmuxer.push(id3Tag);
  transmuxer.push(adtsPayload);
  transmuxer.flush();

  boxes = mp4.tools.inspect(segments[1].data);

  QUnit.equal(boxes[0].boxes[1].boxes[1].baseMediaDecodeTime,
    // The first segment had a PTS of 10,000 and the second segment 900,000
    // Audio PTS is specified in a clock equal to samplerate (44.1khz)
    // So you have to take the different between the PTSs (890,000)
    // and transform it from 90khz to 44.1khz clock
    Math.floor((900000 - 10000) / (90000 / 44100)),
    'second segment starts at the right time');
});

validateTrack = function(track, metadata) {
  var mdia;
  QUnit.equal(track.type, 'trak', 'wrote the track type');
  QUnit.equal(track.boxes.length, 2, 'wrote track children');
  QUnit.equal(track.boxes[0].type, 'tkhd', 'wrote the track header');
  if (metadata) {
    if (metadata.trackId) {
      QUnit.equal(track.boxes[0].trackId, metadata.trackId, 'wrote the track id');
    }
    if (metadata.width) {
      QUnit.equal(track.boxes[0].width, metadata.width, 'wrote the width');
    }
    if (metadata.height) {
      QUnit.equal(track.boxes[0].height, metadata.height, 'wrote the height');
    }
  }

  mdia = track.boxes[1];
  QUnit.equal(mdia.type, 'mdia', 'wrote the media');
  QUnit.equal(mdia.boxes.length, 3, 'wrote the mdia children');

  QUnit.equal(mdia.boxes[0].type, 'mdhd', 'wrote the media header');
  QUnit.equal(mdia.boxes[0].language, 'und', 'the language is undefined');
  QUnit.equal(mdia.boxes[0].duration, 0xffffffff, 'the duration is at maximum');

  QUnit.equal(mdia.boxes[1].type, 'hdlr', 'wrote the media handler');

  QUnit.equal(mdia.boxes[2].type, 'minf', 'wrote the media info');
};

validateTrackFragment = function(track, segment, metadata, type) {
  var tfhd, trun, sdtp, i, j, sample, nalUnitType;
  QUnit.equal(track.type, 'traf', 'wrote a track fragment');

  if (type === 'video') {
    QUnit.equal(track.boxes.length, 4, 'wrote four track fragment children');
  } else if (type === 'audio') {
    QUnit.equal(track.boxes.length, 3, 'wrote three track fragment children');
  }

  tfhd = track.boxes[0];
  QUnit.equal(tfhd.type, 'tfhd', 'wrote a track fragment header');
  QUnit.equal(tfhd.trackId, metadata.trackId, 'wrote the track id');

  QUnit.equal(track.boxes[1].type,
        'tfdt',
        'wrote a track fragment decode time box');
  QUnit.ok(track.boxes[1].baseMediaDecodeTime >= 0, 'base decode time is non-negative');

  trun = track.boxes[2];
  QUnit.ok(trun.dataOffset >= 0, 'set data offset');

  QUnit.equal(trun.dataOffset,
        metadata.mdatOffset + 8,
        'trun data offset is the size of the moof');

  QUnit.ok(trun.samples.length > 0, 'generated media samples');
  for (i = 0, j = metadata.baseOffset + trun.dataOffset;
       i < trun.samples.length;
       i++) {
    sample = trun.samples[i];
    QUnit.ok(sample.size > 0, 'wrote a positive size for sample ' + i);
    if (type === 'video') {
      QUnit.ok(sample.duration > 0, 'wrote a positive duration for sample ' + i);
      QUnit.ok(sample.compositionTimeOffset >= 0,
         'wrote a positive composition time offset for sample ' + i);
      QUnit.ok(sample.flags, 'wrote sample flags');
      QUnit.equal(sample.flags.isLeading, 0, 'the leading nature is unknown');

      QUnit.notEqual(sample.flags.dependsOn, 0, 'sample dependency is not unknown');
      QUnit.notEqual(sample.flags.dependsOn, 4, 'sample dependency is valid');
      nalUnitType = segment[j + 4] & 0x1F;
      QUnit.equal(nalUnitType, 9, 'samples begin with an access_unit_delimiter_rbsp');

      QUnit.equal(sample.flags.isDependedOn, 0, 'dependency of other samples is unknown');
      QUnit.equal(sample.flags.hasRedundancy, 0, 'sample redundancy is unknown');
      QUnit.equal(sample.flags.degradationPriority, 0, 'sample degradation priority is zero');
      // If current sample is Key frame
      if (sample.flags.dependsOn === 2) {
        QUnit.equal(sample.flags.isNonSyncSample, 0, 'samples_is_non_sync_sample flag is zero');
      } else {
        QUnit.equal(sample.flags.isNonSyncSample, 1, 'samples_is_non_sync_sample flag is one');
      }
    } else {
      QUnit.equal(sample.duration, 1024,
            'aac sample duration is always 1024');
    }
    j += sample.size; // advance to the next sample in the mdat
  }

  if (type === 'video') {
    sdtp = track.boxes[3];
    QUnit.equal(trun.samples.length,
          sdtp.samples.length,
          'wrote an QUnit.equal number of trun and sdtp samples');
    for (i = 0; i < sdtp.samples.length; i++) {
      sample = sdtp.samples[i];
      QUnit.notEqual(sample.dependsOn, 0, 'sample dependency is not unknown');
      QUnit.equal(trun.samples[i].flags.dependsOn,
            sample.dependsOn,
            'wrote a consistent dependsOn');
      QUnit.equal(trun.samples[i].flags.isDependedOn,
            sample.isDependedOn,
            'wrote a consistent isDependedOn');
      QUnit.equal(trun.samples[i].flags.hasRedundancy,
            sample.hasRedundancy,
            'wrote a consistent hasRedundancy');
    }
  }
};

QUnit.test('parses an example mp2t file and generates combined media segments', function() {
  var
    segments = [],
    i, j, boxes, mfhd, trackType = 'video', trackId = 256, baseOffset = 0, initSegment;

  transmuxer.on('data', function(segment) {
    if (segment.type === 'combined') {
      segments.push(segment);
    }
  });
  transmuxer.push(testSegment);
  transmuxer.flush();

  QUnit.equal(segments.length, 1, 'generated one combined segment');

  boxes = mp4.tools.inspect(segments[0].data);
  initSegment = mp4.tools.inspect(segments[0].initSegment);
  QUnit.equal(boxes.length, 4, 'combined segments are composed of 4 boxes');
  QUnit.equal(initSegment.length, 2, 'init segment is composed of 2 boxes');
  QUnit.equal(initSegment[0].type, 'ftyp', 'the first box is an ftyp');
  QUnit.equal(initSegment[1].type, 'moov', 'the second box is a moov');
  QUnit.equal(initSegment[1].boxes[0].type, 'mvhd', 'generated an mvhd');
  validateTrack(initSegment[1].boxes[1], {
    trackId: 256
  });
  validateTrack(initSegment[1].boxes[2], {
    trackId: 257
  });

  for (i = 0; i < boxes.length; i += 2) {
    QUnit.equal(boxes[i].type, 'moof', 'first box is a moof');
    QUnit.equal(boxes[i].boxes.length, 2, 'the moof has two children');

    mfhd = boxes[i].boxes[0];
    QUnit.equal(mfhd.type, 'mfhd', 'mfhd is a child of the moof');

    QUnit.equal(boxes[i + 1].type, 'mdat', 'second box is an mdat');

    // Only do even numbered boxes because the odd-offsets will be mdat
    if (i % 2 === 0) {
      for (j = 0; j < i; j++) {
        baseOffset += boxes[j].size;
      }

      validateTrackFragment(boxes[i].boxes[1], segments[0].data, {
        trackId: trackId++,
        width: 388,
        height: 300,
        baseOffset: baseOffset,
        mdatOffset: boxes[i].size
      }, trackType);

      baseOffset = 0;
      trackType = 'audio';
    }
  }
});

QUnit.test('can be reused for multiple TS segments', function() {
  var
    boxes = [],
    initSegments = [];

  transmuxer.on('data', function(segment) {
    if (segment.type === 'combined') {
      boxes.push(mp4.tools.inspect(segment.data));
      initSegments.push(mp4.tools.inspect(segment.initSegment));
    }
  });
  transmuxer.push(testSegment);
  transmuxer.flush();
  transmuxer.push(testSegment);
  transmuxer.flush();

  QUnit.equal(boxes.length, 2, 'generated two combined segments');
  QUnit.equal(initSegments.length, 2, 'generated two combined init segments');

  QUnit.deepEqual(initSegments[0][0], initSegments[1][0], 'generated identical ftyps');
  QUnit.deepEqual(initSegments[0][1], initSegments[1][1], 'generated identical moovs');

  QUnit.deepEqual(boxes[0][0].boxes[1],
            boxes[1][0].boxes[1],
            'generated identical video trafs');
  QUnit.equal(boxes[0][0].boxes[0].sequenceNumber,
        0,
        'set the correct video sequence number');
  QUnit.equal(boxes[1][0].boxes[0].sequenceNumber,
        1,
        'set the correct video sequence number');
  QUnit.deepEqual(boxes[0][1],
            boxes[1][1],
            'generated identical video mdats');

  QUnit.deepEqual(boxes[0][2].boxes[3],
            boxes[1][2].boxes[3],
            'generated identical audio trafs');
  QUnit.equal(boxes[0][2].boxes[0].sequenceNumber,
        0,
        'set the correct audio sequence number');
  QUnit.equal(boxes[1][2].boxes[0].sequenceNumber,
        1,
        'set the correct audio sequence number');
  QUnit.deepEqual(boxes[0][3],
            boxes[1][3],
            'generated identical audio mdats');
});

QUnit.module('NalByteStream', {
  setup: function() {
    nalByteStream = new NalByteStream();
  }
});

QUnit.test('parses nal units with 4-byte start code', function() {
  var nalUnits = [];
  nalByteStream.on('data', function(data) {
    nalUnits.push(data);
  });

  nalByteStream.push({
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01, // start code
      0x09, 0xFF, // Payload
      0x00, 0x00, 0x00 // end code
    ])
  });

  QUnit.equal(nalUnits.length, 1, 'found one nal');
  QUnit.deepEqual(nalUnits[0], new Uint8Array([0x09, 0xFF]), 'has the proper payload');
});

QUnit.test('parses nal units with 3-byte start code', function() {
  var nalUnits = [];
  nalByteStream.on('data', function(data) {
    nalUnits.push(data);
  });

  nalByteStream.push({
    data: new Uint8Array([
      0x00, 0x00, 0x01, // start code
      0x09, 0xFF, // Payload
      0x00, 0x00, 0x00 // end code
    ])
  });

  QUnit.equal(nalUnits.length, 1, 'found one nal');
  QUnit.deepEqual(nalUnits[0], new Uint8Array([0x09, 0xFF]), 'has the proper payload');
});

QUnit.test('does not emit empty nal units', function() {
  var dataTriggerCount = 0;
  nalByteStream.on('data', function(data) {
    dataTriggerCount++;
  });

  // An empty nal unit is just two start codes:
  nalByteStream.push({
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01, // start code
      0x00, 0x00, 0x00, 0x01  // start code
    ])
  });
  QUnit.equal(dataTriggerCount, 0, 'emmited no nal units');
});

QUnit.test('parses multiple nal units', function() {
  var nalUnits = [];
  nalByteStream.on('data', function(data) {
    nalUnits.push(data);
  });

  nalByteStream.push({
    data: new Uint8Array([
      0x00, 0x00, 0x01, // start code
      0x09, 0xFF, // Payload
      0x00, 0x00, 0x00, // end code
      0x00, 0x00, 0x01, // start code
      0x12, 0xDD, // Payload
      0x00, 0x00, 0x00 // end code
    ])
  });

  QUnit.equal(nalUnits.length, 2, 'found two nals');
  QUnit.deepEqual(nalUnits[0], new Uint8Array([0x09, 0xFF]), 'has the proper payload');
  QUnit.deepEqual(nalUnits[1], new Uint8Array([0x12, 0xDD]), 'has the proper payload');
});

QUnit.test('parses nal units surrounded by an unreasonable amount of zero-bytes', function() {
  var nalUnits = [];
  nalByteStream.on('data', function(data) {
    nalUnits.push(data);
  });

  nalByteStream.push({
    data: new Uint8Array([
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x01, // start code
      0x09, 0xFF, // Payload
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, // end code
      0x00, 0x00, 0x01, // start code
      0x12, 0xDD, // Payload
      0x00, 0x00, 0x00, // end code
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00
    ])
  });

  QUnit.equal(nalUnits.length, 2, 'found two nals');
  QUnit.deepEqual(nalUnits[0], new Uint8Array([0x09, 0xFF]), 'has the proper payload');
  QUnit.deepEqual(nalUnits[1], new Uint8Array([0x12, 0xDD]), 'has the proper payload');
});

QUnit.test('parses nal units split across multiple packets', function() {
  var nalUnits = [];
  nalByteStream.on('data', function(data) {
    nalUnits.push(data);
  });

  nalByteStream.push({
    data: new Uint8Array([
      0x00, 0x00, 0x01, // start code
      0x09, 0xFF // Partial payload
    ])
  });
  nalByteStream.push({
    data: new Uint8Array([
      0x12, 0xDD, // Partial Payload
      0x00, 0x00, 0x00 // end code
    ])
  });

  QUnit.equal(nalUnits.length, 1, 'found two nals');
  QUnit.deepEqual(nalUnits[0], new Uint8Array([0x09, 0xFF, 0x12, 0xDD]), 'has the proper payload');
});

QUnit.module('FLV - Transmuxer', {
  setup: function() {
    transmuxer = new FlvTransmuxer();
  }
});

QUnit.test('generates video tags', function() {
  var segments = [];
  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true
  })));

  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true)));
  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true)));

  transmuxer.flush();

  QUnit.equal(segments[0].tags.audioTags.length, 0, 'generated no audio tags');
  QUnit.equal(segments[0].tags.videoTags.length, 2, 'generated a two video tags');
});

QUnit.test('drops nalUnits at the start of a segment not preceeded by an access_unit_delimiter_rbsp', function() {
  var segments = [];
  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true
  })));

  transmuxer.push(packetize(videoPes([
      0x08, 0x01 // pic_parameter_set_rbsp
  ], true)));
  transmuxer.push(packetize(videoPes([
    0x07, // seq_parameter_set_rbsp
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], false)));
  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true)));

  transmuxer.flush();

  QUnit.equal(segments[0].tags.audioTags.length, 0, 'generated no audio tags');
  QUnit.equal(segments[0].tags.videoTags.length, 1, 'generated a single video tag');
});

QUnit.test('generates audio tags', function() {
  var segments = [];
  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasAudio: true
  })));
  transmuxer.push(packetize(audioPes([
    0x19, 0x47
  ], true)));

  transmuxer.flush();

  QUnit.equal(segments[0].tags.audioTags.length, 3, 'generated three audio tags');
  QUnit.equal(segments[0].tags.videoTags.length, 0, 'generated no video tags');
});

QUnit.test('buffers video samples until flushed', function() {
  var segments = [];
  transmuxer.on('data', function(data) {
    segments.push(data);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true
  })));

  // buffer a NAL
  transmuxer.push(packetize(videoPes([0x09, 0x01], true)));
  transmuxer.push(packetize(videoPes([0x00, 0x02])));

  // add an access_unit_delimiter_rbsp
  transmuxer.push(packetize(videoPes([0x09, 0x03])));
  transmuxer.push(packetize(videoPes([0x00, 0x04])));
  transmuxer.push(packetize(videoPes([0x00, 0x05])));

  // flush everything
  transmuxer.flush();

  QUnit.equal(segments[0].tags.audioTags.length, 0, 'generated no audio tags');
  QUnit.equal(segments[0].tags.videoTags.length, 2, 'generated two video tags');
});

QUnit.test('does not buffer a duplicate video sample on subsequent flushes', function() {
  var segments = [];
  transmuxer.on('data', function(data) {
    segments.push(data);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true
  })));

  // buffer a NAL
  transmuxer.push(packetize(videoPes([0x09, 0x01], true)));
  transmuxer.push(packetize(videoPes([0x00, 0x02])));

  // add an access_unit_delimiter_rbsp
  transmuxer.push(packetize(videoPes([0x09, 0x03])));
  transmuxer.push(packetize(videoPes([0x00, 0x04])));
  transmuxer.push(packetize(videoPes([0x00, 0x05])));

  // flush everything
  transmuxer.flush();

  QUnit.equal(segments[0].tags.audioTags.length, 0, 'generated no audio tags');
  QUnit.equal(segments[0].tags.videoTags.length, 2, 'generated two video tags');

  segments = [];

  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true
  })));

  // buffer a NAL
  transmuxer.push(packetize(videoPes([0x09, 0x01], true)));
  transmuxer.push(packetize(videoPes([0x00, 0x02])));

  // add an access_unit_delimiter_rbsp
  transmuxer.push(packetize(videoPes([0x09, 0x03])));
  transmuxer.push(packetize(videoPes([0x00, 0x04])));
  transmuxer.push(packetize(videoPes([0x00, 0x05])));

  // flush everything
  transmuxer.flush();

  QUnit.equal(segments[0].tags.audioTags.length, 0, 'generated no audio tags');
  QUnit.equal(segments[0].tags.videoTags.length, 2, 'generated two video tags');
});

QUnit.test('emits done event when no audio data is present', function() {
  var segments = [];
  var done = false;

  transmuxer.on('data', function(data) {
    segments.push(data);
  });
  transmuxer.on('done', function() {
    done = true;
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true,
    hasAudio: true
  })));

  // buffer a NAL
  transmuxer.push(packetize(videoPes([0x09, 0x01], true)));
  transmuxer.push(packetize(videoPes([0x00, 0x02])));

  // add an access_unit_delimiter_rbsp
  transmuxer.push(packetize(videoPes([0x09, 0x03])));
  transmuxer.push(packetize(videoPes([0x00, 0x04])));
  transmuxer.push(packetize(videoPes([0x00, 0x05])));

  // flush everything
  transmuxer.flush();

  QUnit.equal(segments[0].tags.audioTags.length, 0, 'generated no audio tags');
  QUnit.equal(segments[0].tags.videoTags.length, 2, 'generated two video tags');
  QUnit.ok(done, 'emitted done event even though no audio data was given');
});

QUnit.module('AAC Stream');
QUnit.test('parses correct ID3 tag size', function() {
  var packetStream = new Uint8Array(10),
    aacStream = new AacStream(),
    parser = aacStream.parseId3TagSize;

  packetStream[9] = 63;
  QUnit.equal(parser(packetStream, 0), 73, 'ParseID3 correctly parsed a header without a footer');
});

QUnit.test('parses correct ADTS Frame size', function() {
  var packetStream = new Uint8Array(6),
    aacStream = new AacStream(),
    parser = aacStream.parseAdtsSize;
  packetStream[3] = 128;
  packetStream[4] = 29;
  packetStream[5] = 255;
  QUnit.equal(parser(packetStream, 0), 239, 'ParseADTS correctly parsed framesize');
});

QUnit.test('emits data after receiving push', function() {

  var array = new Uint8Array(109),
    aacStream,
    count = 0;
  aacStream = new AacStream();

  array[0] = 255;
  array[1] = 241;
  array[2] = 92;
  array[3] = 128;
  array[4] = 13;
  array[5] = 191;
  array[6] = 252;
  array[7] = 33;
  array[8] = 32;
  array[9] = 3;
  array[10] = 64;
  array[11] = 104;
  array[12] = 27;
  array[13] = 212;
  aacStream.setTimestamp(90);
  aacStream.on('data', function(frame) {
    if (frame.pts === 90 && frame.dts === 90) {
      count += 1;
    }
  });
  aacStream.push(array);
  QUnit.equal(count, 1);
});

QUnit.test('continues parsing after corrupted stream', function() {

  var array = new Uint8Array(10000),
    aacStream,
    adtsCount = 0,
    id3Count = 0;
  aacStream = new AacStream();
  // an ID3 frame
  array[0] = 73;
  array[1] = 68;
  array[2] = 51;
  array[3] = 4;
  array[4] = 0;
  array[5] = 0;
  array[6] = 0;
  array[7] = 0;
  array[8] = 0;
  array[9] = 63;
  array[10] = 80;
  array[11] = 82;
  array[12] = 73;
  array[13] = 86;

  // an atds frame
  array[1020] = 255;
  array[1021] = 241;
  array[1022] = 92;
  array[1023] = 128;
  array[1024] = 13;
  array[1025] = 191;
  array[1026] = 252;
  array[1027] = 33;
  array[1028] = 32;
  array[1029] = 3;
  array[1030] = 64;
  array[1031] = 104;
  array[1032] = 27;
  array[1033] = 212;

  aacStream.on('data', function(frame) {
    if (frame.type === 'timed-metadata') {
      id3Count += 1;
    } else if (frame.type === 'audio') {
      adtsCount += 1;
    }
  });
  aacStream.push(array);
  QUnit.equal(adtsCount, 1);
  QUnit.equal(id3Count, 1);
});
