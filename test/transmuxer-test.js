(function(window, muxjs) {
'use strict';

var
  TransportPacketStream = muxjs.mp2t.TransportPacketStream,
  transportPacketStream,
  TransportParseStream = muxjs.mp2t.TransportParseStream,
  transportParseStream,
  ElementaryStream = muxjs.mp2t.ElementaryStream,
  elementaryStream,
  H264Stream = muxjs.codecs.H264Stream,
  h264Stream,
  VideoSegmentStream = muxjs.mp4.VideoSegmentStream,
  videoSegmentStream,
  AudioSegmentStream = muxjs.mp4.AudioSegmentStream,
  audioSegmentStream,
  AacStream = muxjs.codecs.AacStream,
  aacStream,
  Transmuxer = muxjs.mp4.Transmuxer,
  FlvTransmuxer = muxjs.flv.Transmuxer,
  transmuxer,
  NalByteStream = muxjs.codecs.NalByteStream,
  nalByteStream,

  MP2T_PACKET_LENGTH = muxjs.mp2t.MP2T_PACKET_LENGTH,
  H264_STREAM_TYPE = muxjs.mp2t.H264_STREAM_TYPE,
  ADTS_STREAM_TYPE = muxjs.mp2t.ADTS_STREAM_TYPE,
  METADATA_STREAM_TYPE = muxjs.mp2t.METADATA_STREAM_TYPE,
  packetize,

  PAT,
  generatePMT,
  PMT,
  standalonePes,
  validateTrack,
  validateTrackFragment,

  pesHeader,
  transportPacket,
  videoPes,
  audioPes,
  timedMetadataPes;

module('MP2T Packet Stream', {
  setup: function() {
    transportPacketStream = new TransportPacketStream();
  }
});

test('empty input does not error', function() {
  transportPacketStream.push(new Uint8Array([]));
  ok(true, 'did not throw');
});
test('parses a generic packet', function() {
  var
    datas = [],
    packet = new Uint8Array(188);

  packet[0] = 0x47; // Sync-byte

  transportPacketStream.on('data', function(event) {
    datas.push(event);
  });
  transportPacketStream.push(packet);
  transportPacketStream.flush();

  equal(1, datas.length, 'fired one event');
  equal(datas[0].byteLength, 188, 'delivered the packet');
});

test('buffers partial packets', function() {
  var
    datas = [],
    partialPacket1 = new Uint8Array(187),
    partialPacket2 =  new Uint8Array(189);

  partialPacket1[0] = 0x47; // Sync-byte
  partialPacket2[1] = 0x47; // Sync-byte

  transportPacketStream.on('data', function(event) {
    datas.push(event);
  });
  transportPacketStream.push(partialPacket1);

  equal(0, datas.length, 'did not fire an event');

  transportPacketStream.push(partialPacket2);
  transportPacketStream.flush();

  equal(2, datas.length, 'fired events');
  equal(188, datas[0].byteLength, 'parsed the first packet');
  equal(188, datas[1].byteLength, 'parsed the second packet');
});

test('parses multiple packets delivered at once', function() {
  var datas = [], packetStream = new Uint8Array(188 * 3);

  packetStream[0] = 0x47; // Sync-byte
  packetStream[188] = 0x47; // Sync-byte
  packetStream[376] = 0x47; // Sync-byte

  transportPacketStream.on('data', function(event) {
    datas.push(event);
  });

  transportPacketStream.push(packetStream);
  transportPacketStream.flush();

  equal(3, datas.length, 'fired three events');
  equal(188, datas[0].byteLength, 'parsed the first packet');
  equal(188, datas[1].byteLength, 'parsed the second packet');
  equal(188, datas[2].byteLength, 'parsed the third packet');
});

test('resyncs packets', function() {
  var datas = [], packetStream = new Uint8Array(188 * 3 - 2);

  packetStream[0] = 0x47; // Sync-byte
  packetStream[186] = 0x47; // Sync-byte
  packetStream[374] = 0x47; // Sync-byte

  transportPacketStream.on('data', function(event) {
    datas.push(event);
  });

  transportPacketStream.push(packetStream);
  transportPacketStream.flush();

  equal(datas.length, 2, 'fired three events');
  equal(datas[0].byteLength, 188, 'parsed the first packet');
  equal(datas[1].byteLength, 188, 'parsed the second packet');
});

test('buffers extra after multiple packets', function() {
  var datas = [], packetStream = new Uint8Array(188 * 2 + 10);

  packetStream[0] = 0x47; // Sync-byte
  packetStream[188] = 0x47; // Sync-byte
  packetStream[376] = 0x47; // Sync-byte

  transportPacketStream.on('data', function(event) {
    datas.push(event);
  });

  transportPacketStream.push(packetStream);
  equal(2, datas.length, 'fired three events');
  equal(188, datas[0].byteLength, 'parsed the first packet');
  equal(188, datas[1].byteLength, 'parsed the second packet');

  transportPacketStream.push(new Uint8Array(178));
  transportPacketStream.flush();

  equal(3, datas.length, 'fired a final event');
  equal(188, datas[2].length, 'parsed the finel packet');
});

module('MP2T TransportParseStream', {
  setup: function() {
    transportPacketStream = new TransportPacketStream();
    transportParseStream = new TransportParseStream();

    transportPacketStream.pipe(transportParseStream);
  }
});

test('parses generic packet properties', function() {
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

  ok(packet.payloadUnitStartIndicator, 'parsed payload_unit_start_indicator');
  ok(packet.pid, 'parsed PID');
});

test('parses piped data events', function() {
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

  ok(packet, 'parsed a packet');
});

test('parses a data packet with adaptation fields', function() {
  var packet;
  transportParseStream.on('data', function(data) {
    packet = data;
  });

  transportParseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0000 tsc:01 afc:10 cc:11 afl:00 0000 00 stuffing:00 0000 00 pscp:00 0001 padding:0000
    0x40, 0x00, 0x6c, 0x00, 0x00, 0x10
  ]));
  strictEqual(packet.type, 'pat', 'parsed the packet type');
});

test('parses a PES packet', function() {
  var packet;
  transportParseStream.on('data', function(data) {
    packet = data;
  });

  // setup a program map table
  transportParseStream.programMapTable = {
    0x0010: muxjs.mp2t.H264_STREAM_TYPE
  };

  transportParseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0010 tsc:01 afc:01 cc:11 padding:00
    0x40, 0x02, 0x5c
  ]));
  strictEqual(packet.type, 'pes', 'parsed a PES packet');
});

test('parses packets with variable length adaptation fields and a payload', function() {
  var packet;
  transportParseStream.on('data', function(data) {
    packet = data;
  });

  // setup a program map table
  transportParseStream.programMapTable = {
    0x0010: muxjs.mp2t.H264_STREAM_TYPE
  };

  transportParseStream.push(new Uint8Array([
    0x47, // sync byte
    // tei:0 pusi:1 tp:0 pid:0 0000 0000 0010 tsc:01 afc:11 cc:11 afl:00 0000 11 stuffing:00 0000 0000 00 pscp:00 0001
    0x40, 0x02, 0x7c, 0x0c, 0x00, 0x01
  ]));
  strictEqual(packet.type, 'pes', 'parsed a PES packet');
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

test('parses the program map table pid from the program association table (PAT)', function() {
  var packet;
  transportParseStream.on('data', function(data) {
    packet = data;
  });

  transportParseStream.push(new Uint8Array(PAT));
  ok(packet, 'parsed a packet');
  strictEqual(0x0010, transportParseStream.pmtPid, 'parsed PMT pid');
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
        0x00, 0x00,
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

test('parse the elementary streams from a program map table', function() {
  var packet;
  transportParseStream.on('data', function(data) {
    packet = data;
  });
  transportParseStream.pmtPid = 0x0010;

  transportParseStream.push(new Uint8Array(PMT.concat(0, 0, 0, 0, 0)));

  ok(packet, 'parsed a packet');
  ok(transportParseStream.programMapTable, 'parsed a program map');
  strictEqual(0x1b, transportParseStream.programMapTable[0x11], 'associated h264 with pid 0x11');
  strictEqual(0x0f, transportParseStream.programMapTable[0x12], 'associated adts with pid 0x12');
  strictEqual(transportParseStream.programMapTable[0], undefined, 'ignored trailing stuffing bytes');
  deepEqual(transportParseStream.programMapTable, packet.programMapTable, 'recorded the PMT');
});

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

  // Only store 15 bits of the PTS for testing purposes
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
 * Helper function to create video PES packets
 * @param data {arraylike} - the payload bytes
 * @payload first {boolean} - true if this PES should be a payload
 * unit start
 */
videoPes = function(data, first, pts) {
  return transportPacket(0x11, [
    // NAL unit start code
    0x00, 0x00, 0x01
  ].concat(data), first, pts);
};
standalonePes = videoPes([0xaf, 0x01], true);

/**
 * Helper function to create audio PES packets
 * @param data {arraylike} - the payload bytes
 * @payload first {boolean} - true if this PES should be a payload
 * unit start
 */
audioPes = function(data, first, pts) {
  var frameLength = data.length + 7;
  return transportPacket(0x12, [
    0xff, 0xf1,                            // no CRC
    0x10,                                  // AAC Main, 44.1KHz
    0xb0 | ((frameLength & 0x1800) >> 11), // 2 channels
    (frameLength & 0x7f8) >> 3,
    ((frameLength & 0x07) << 5) + 7,       // frame length in bytes
    0x00                                   // one AAC per ADTS frame
  ].concat(data), first, pts);
};

timedMetadataPes = function(data) {
  var id3 = muxjs.id3;
  return transportPacket(0x13, id3.id3Tag(id3.id3Frame('PRIV', 0x00, 0x01)));
};

module('MP2T ElementaryStream', {
  setup: function() {
    elementaryStream = new ElementaryStream();
  }
});

packetize = function(data) {
  var packet = new Uint8Array(MP2T_PACKET_LENGTH);
  packet.set(data);
  return packet;
};

test('parses metadata events from PSI packets', function() {
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
      1: 0x1b,
      2: 0x0f
    }
  });

  equal(1, datas, 'data fired');
  equal(1, metadatas.length, 'metadata generated');
  metadatas[0].tracks.sort(sortById);
  deepEqual(metadatas[0].tracks, [{
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

test('parses standalone program stream packets', function() {
  var
    packets = [],
    packetData = [0x01, 0x02],
    pesHead = pesHeader(false, 7);

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

  equal(packets.length, 1, 'built one packet');
  equal(packets[0].type, 'audio', 'identified audio data');
  equal(packets[0].data.byteLength, packetData.length, 'parsed the correct payload size');
  equal(packets[0].pts, 7, 'correctly parsed the pts value');
});

test('aggregates program stream packets from the transport stream', function() {
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

  equal(events.length, 0, 'buffers partial packets');

  elementaryStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(pesHead.slice(4).concat(packetData))
  });
  elementaryStream.flush();

  equal(events.length, 1, 'built one packet');
  equal(events[0].type, 'video', 'identified video data');
  equal(events[0].pts, 7, 'correctly parsed the pts');
  equal(events[0].data.byteLength, packetData.length, 'concatenated transport packets');
});

test('parses an elementary stream packet with just a pts', function() {
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

  ok(packet, 'parsed a packet');
  equal(packet.data.byteLength, 1, 'parsed a single data byte');
  equal(packet.data[0], 0x11, 'parsed the data');
  // 2^33-1 is the maximum value of a 33-bit unsigned value
  equal(packet.pts, Math.pow(2, 33) - 1, 'parsed the pts');
});

test('parses an elementary stream packet with a pts and dts', function() {
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

  ok(packet, 'parsed a packet');
  equal(packet.data.byteLength, 1, 'parsed a single data byte');
  equal(packet.data[0], 0x11, 'parsed the data');
  equal(packet.pts, 4, 'parsed the pts');
  equal(packet.dts, 2, 'parsed the dts');
});

test('parses an elementary stream packet without a pts or dts', function() {
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

  ok(packet, 'parsed a packet');
  equal(packet.data.byteLength, 2, 'parsed two data bytes');
  equal(packet.data[0], 0xaf, 'parsed the first data byte');
  equal(packet.data[1], 0x01, 'parsed the second data byte');
  ok(!packet.pts, 'did not parse a pts');
  ok(!packet.dts, 'did not parse a dts');
});

test('buffers audio and video program streams individually', function() {
  var events = [];
  elementaryStream.on('data', function(event) {
    events.push(event);
  });

  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: ADTS_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  equal(0, events.length, 'buffers partial packets');

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
  equal(2, events.length, 'parsed a complete packet');
  equal('video', events[0].type, 'identified video data');
  equal('audio', events[1].type, 'identified audio data');
});

test('flushes the buffered packets when a new one of that type is started', function() {
  var packets = [];
  elementaryStream.on('data', function(packet) {
    packets.push(packet);
  });
  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: ADTS_STREAM_TYPE,
    data: new Uint8Array(7)
  });
  elementaryStream.push({
    type: 'pes',
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  equal(0, packets.length, 'buffers packets by type');

  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: H264_STREAM_TYPE,
    data: new Uint8Array(1)
  });
  equal(1, packets.length, 'built one packet');
  equal('video', packets[0].type, 'identified video data');
  equal(2, packets[0].data.byteLength, 'concatenated packets');

  elementaryStream.flush();
  equal(3, packets.length, 'built two more packets');
  equal('video', packets[1].type, 'identified video data');
  equal(1, packets[1].data.byteLength, 'parsed the video payload');
  equal('audio', packets[2].type, 'identified audio data');
  equal(7, packets[2].data.byteLength, 'parsed the audio payload');
});

test('buffers and emits timed-metadata', function() {
  var packets = [];
  elementaryStream.on('data', function(packet) {
    packets.push(packet);
  });

  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: METADATA_STREAM_TYPE,
    data: new Uint8Array([0, 1])
  });
  elementaryStream.push({
    type: 'pes',
    streamType: METADATA_STREAM_TYPE,
    data: new Uint8Array([2, 3])
  });
  equal(packets.length, 0, 'buffers metadata until the next start indicator');

  elementaryStream.push({
    type: 'pes',
    payloadUnitStartIndicator: true,
    streamType: METADATA_STREAM_TYPE,
    data: new Uint8Array([4, 5])
  });
  equal(packets.length, 1, 'built a packet');
  equal(packets[0].type, 'timed-metadata', 'identified timed-metadata');
  deepEqual(packets[0].data, new Uint8Array([0, 1, 2, 3]), 'concatenated the data');

  elementaryStream.flush();
  equal(packets.length, 2, 'flushed a packet');
  equal(packets[1].type, 'timed-metadata', 'identified timed-metadata');
  deepEqual(packets[1].data, new Uint8Array([4, 5]), 'included the data');
});

test('drops packets with unknown stream types', function() {
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

  equal(packets.length, 0, 'ignored unknown packets');
});

module('H264 Stream', {
  setup: function() {
    h264Stream = new H264Stream();
  }
});

test('properly parses seq_parameter_set_rbsp nal units', function() {
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

  // test SPS:
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

  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'seq_parameter_set_rbsp', 'identified an sequence parameter set');
  deepEqual(data.escapedRBSP, expectedRBSP, 'properly removed Emulation Prevention Bytes from the RBSP');

  deepEqual(data.config, expectedConfig, 'parsed the sps');
});

test('unpacks nal units from simple byte stream framing', function() {
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

  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');
  equal(data.data.length, 2, 'calculated nal unit length');
  equal(data.data[1], 7, 'read a payload byte');
});

test('unpacks nal units from byte streams split across pushes', function() {
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
  ok(!data, 'buffers NAL units across events');

  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x03, 0x02, 0x01,
      0x00, 0x00, 0x01
    ])
  });
  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');
  equal(data.data.length, 8, 'calculated nal unit length');
  equal(data.data[1], 7, 'read a payload byte');
});

test('buffers nal unit trailing zeros across pushes', function() {
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
  equal(data.length, 1, 'delivered the first nal');

  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00,
      0x00, 0x00, 0x01,
      0x09, 0x06,
      0x00, 0x00, 0x01
    ])
  });
  equal(data.length, 2, 'generated data events');
  equal(data[0].data.length, 2, 'ignored trailing zeros');
  equal(data[0].data[0], 0x09, 'found the first nal start');
  equal(data[1].data.length, 2, 'found the following nal start');
  equal(data[1].data[0], 0x09, 'found the second nal start');
});

test('unpacks nal units from byte streams with split sync points', function() {
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
  ok(!data, 'buffers NAL units across events');

  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x01
    ])
  });
  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');
  equal(data.data.length, 2, 'calculated nal unit length');
  equal(data.data[1], 7, 'read a payload byte');
});

test('parses nal unit types', function() {
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

  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');

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
  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'seq_parameter_set_rbsp', 'identified a sequence parameter set');

  data = null;
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x08, 0x01
    ])
  });
  h264Stream.flush();
  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'pic_parameter_set_rbsp', 'identified a picture parameter set');

  data = null;
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x05, 0x01
    ])
  });
  h264Stream.flush();
  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'slice_layer_without_partitioning_rbsp_idr', 'identified a key frame');

  data = null;
  h264Stream.push({
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x06, 0x01
    ])
  });
  h264Stream.flush();
  ok(data, 'generated a data event');
  equal(data.nalUnitType, 'sei_rbsp', 'identified a supplemental enhancement information unit');
});

// MP4 expects H264 (aka AVC) data to be in storage format. Storage
// format is optimized for reliable, random-access media in contrast
// to the byte stream format that retransmits metadata regularly to
// allow decoders to quickly begin operation from wherever in the
// broadcast they begin receiving.
// Details on the byte stream format can be found in Annex B of
// Recommendation ITU-T H.264.
// The storage format is described in ISO/IEC 14496-15
test('strips byte stream framing during parsing', function() {
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

  equal(data.length, 2, 'parsed two NAL units');
  deepEqual(new Uint8Array([
    0x08,
    0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07
  ]), new Uint8Array(data[0].data), 'parsed the first NAL unit');
  deepEqual(new Uint8Array([
    0x09,
    0x06, 0x05, 0x04, 0x03,
    0x02, 0x01, 0x00
  ]), new Uint8Array(data[1].data), 'parsed the second NAL unit');
});

test('can be reset', function() {
  var input = {
    type: 'video',
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x09, 0x07,
      0x00, 0x00, 0x01
    ])
  }, data = [];
  // only the latest event is relevant for this test
  h264Stream.on('data', function(event) {
    data.push(event);
  });

  h264Stream.push(input);
  h264Stream.flush();
  h264Stream.push(input);
  h264Stream.flush();

  equal(data.length, 2, 'generated two data events');
  equal(data[1].nalUnitType, 'access_unit_delimiter_rbsp', 'identified an access unit delimiter');
  equal(data[1].data.length, 2, 'calculated nal unit length');
  equal(data[1].data[1], 7, 'read a payload byte');
});

module('VideoSegmentStream', {
  setup: function() {
    var track = {};
    videoSegmentStream = new VideoSegmentStream(track);
    videoSegmentStream.track = track;
    videoSegmentStream.track.timelineStartInfo = {
      dts: 10,
      pts: 10,
      baseMediaDecodeTime: 0
    };
  }
});

// see ISO/IEC 14496-15, Section 5 "AVC elementary streams and sample definitions"
test('concatenates NAL units into AVC elementary streams', function() {
  var segment, boxes;
  videoSegmentStream.on('data', function(data) {
    segment = data.boxes;
  });
  videoSegmentStream.push({
    nalUnitType: 'access_unit_delimiter_rbsp',
    data: new Uint8Array([0x09, 0x01])
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

  ok(segment, 'generated a data event');
  boxes = muxjs.tools.inspectMp4(segment);
  equal(boxes[1].byteLength,
        (2 + 4) + (4 + 4) + (4 + 6),
        'wrote the correct number of bytes');
  deepEqual(new Uint8Array(segment.subarray(boxes[0].size + 8)), new Uint8Array([
    0, 0, 0, 2,
    0x09, 0x01,
    0, 0, 0, 4,
    0x08, 0x01, 0x02, 0x03,
    0, 0, 0, 6,
    0x08, 0x04, 0x03, 0x02, 0x01, 0x00
  ]), 'wrote an AVC stream into the mdat');
});

test('infers sample durations from DTS values', function() {
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

  boxes = muxjs.tools.inspectMp4(segment);
  samples = boxes[0].boxes[1].boxes[2].samples;
  equal(samples.length, 3, 'generated three samples');
  equal(samples[0].duration, 1, 'set the first sample duration');
  equal(samples[1].duration, 2, 'set the second sample duration');
  equal(samples[2].duration, 2, 'inferred the final sample duration');
});

test('filters pre-IDR samples and caluculate duration correctly', function() {
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
    dts: 2
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'slice_layer_without_partitioning_rbsp_idr',
    dts: 1
  });
  videoSegmentStream.push({
    data: new Uint8Array([0x09, 0x01]),
    nalUnitType: 'access_unit_delimiter_rbsp',
    dts: 4
  });
  videoSegmentStream.flush();

  boxes = muxjs.tools.inspectMp4(segment);
  samples = boxes[0].boxes[1].boxes[2].samples;
  equal(samples.length, 2, 'generated two samples, filters out pre-IDR');
  equal(samples[0].duration, 3, 'set the first sample duration');
  equal(samples[1].duration, 2, 'set the second sample duration');
});

test('track values from seq_parameter_set_rbsp should be cleared by a flush', function() {
  var track;
  videoSegmentStream.on('data', function(data) {
    track = data.track;
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

  equal(track.width, 123, 'width is set by first SPS');
  equal(track.height, 321, 'height is set by first SPS');
  equal(track.sps[0][0], 0xFF, 'first sps is 0xFF');
  equal(track.profileIdc, 1, 'profileIdc is set by first SPS');
  equal(track.levelIdc, 2, 'levelIdc is set by first SPS');
  equal(track.profileCompatibility, 3, 'profileCompatibility is set by first SPS');

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

  equal(track.width, 300, 'width is set by first SPS after flush');
  equal(track.height, 200, 'height is set by first SPS after flush');
  equal(track.sps.length, 1, 'there is one sps');
  equal(track.sps[0][0], 0x99, 'first sps is 0x99');
  equal(track.profileIdc, 11, 'profileIdc is set by first SPS after flush');
  equal(track.levelIdc, 12, 'levelIdc is set by first SPS after flush');
  equal(track.profileCompatibility, 13, 'profileCompatibility is set by first SPS after flush');
});

test('track pps from pic_parameter_set_rbsp should be cleared by a flush', function() {
  var track;
  videoSegmentStream.on('data', function(data) {
    track = data.track;
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

  equal(track.pps[0][0], 0x01, 'first pps is 0x01');

  videoSegmentStream.push({
    data: new Uint8Array([0x03]),
    nalUnitType: 'pic_parameter_set_rbsp',
    dts: 1
  });
  videoSegmentStream.flush();

  equal(track.pps[0][0], 0x03, 'first pps is 0x03 after a flush');
});

test('calculates compositionTimeOffset values from the PTS and DTS', function() {
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

  boxes = muxjs.tools.inspectMp4(segment);
  samples = boxes[0].boxes[1].boxes[2].samples;
  equal(samples.length, 3, 'generated three samples');
  equal(samples[0].compositionTimeOffset, 0, 'calculated compositionTimeOffset');
  equal(samples[1].compositionTimeOffset, 1, 'calculated compositionTimeOffset');
  equal(samples[2].compositionTimeOffset, 3, 'calculated compositionTimeOffset');
});

test('calculates baseMediaDecodeTime values from the first DTS ever seen and subsequent segments\' lowest DTS', function() {
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

  boxes = muxjs.tools.inspectMp4(segment);
  tfdt = boxes[0].boxes[1].boxes[1];
  equal(tfdt.baseMediaDecodeTime, 90, 'calculated baseMediaDecodeTime');
});

test('calculates baseMediaDecodeTime values relative to a customizable baseMediaDecodeTime', function() {
  var segment, boxes, tfdt;
  videoSegmentStream.track.timelineStartInfo = {
    dts: 10,
    pts: 10,
    baseMediaDecodeTime: 1234
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

  boxes = muxjs.tools.inspectMp4(segment);
  tfdt = boxes[0].boxes[1].boxes[1];
  equal(tfdt.baseMediaDecodeTime, 1324, 'calculated baseMediaDecodeTime');
});

test('subtract the first frame\'s compositionTimeOffset from baseMediaDecodeTime', function() {
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

  boxes = muxjs.tools.inspectMp4(segment);
  tfdt = boxes[0].boxes[1].boxes[1];

  // The timelineStartInfo's bMDT is 100 and that corresponds to a dts/pts of 10
  // The first frame has a dts 50 so the bMDT is calculated as: (50 - 10) + 100 = 140
  // The first frame has a compositionTimeOffset of: 60 - 50 = 10
  // The final track's bMDT is therefore: 140 - 10 = 130
  equal(tfdt.baseMediaDecodeTime, 130, 'calculated baseMediaDecodeTime');
});

module('AAC Stream', {
  setup: function() {
    aacStream = new AacStream();
  }
});

test('generates AAC frame events from ADTS bytes', function() {
  var frames = [];
  aacStream.on('data', function(frame) {
    frames.push(frame);
  });
  aacStream.push({
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

  equal(frames.length, 1, 'generated one frame');
  deepEqual(new Uint8Array(frames[0].data),
            new Uint8Array([0x12, 0x34]),
            'extracted AAC frame');
  equal(frames[0].channelcount, 2, 'parsed channelcount');
  equal(frames[0].samplerate, 44100, 'parsed samplerate');

  // Chrome only supports 8, 16, and 32 bit sample sizes. Assuming the
  // default value of 16 in ISO/IEC 14496-12 AudioSampleEntry is
  // acceptable.
  equal(frames[0].samplesize, 16, 'parsed samplesize');
});

test('parses across packets', function() {
  var frames = [];
  aacStream.on('data', function(frame) {
    frames.push(frame);
  });
  aacStream.push({
    type: 'audio',
    data: new Uint8Array([
      0xff, 0xf1,       // no CRC
      0x10,             // AAC Main, 44.1KHz
      0xbc, 0x01, 0x20, // 2 channels, frame length 9 bytes
      0x00,             // one AAC per ADTS frame
      0x12, 0x34        // AAC payload 1
    ])
  });
  aacStream.push({
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

  equal(frames.length, 2, 'parsed two frames');
  deepEqual(new Uint8Array(frames[1].data),
            new Uint8Array([0x9a, 0xbc]),
            'extracted the second AAC frame');
});

test('parses frames segmented across packet', function() {
  var frames = [];
  aacStream.on('data', function(frame) {
    frames.push(frame);
  });
  aacStream.push({
    type: 'audio',
    data: new Uint8Array([
      0xff, 0xf1,       // no CRC
      0x10,             // AAC Main, 44.1KHz
      0xbc, 0x01, 0x20, // 2 channels, frame length 9 bytes
      0x00,             // one AAC per ADTS frame
      0x12        // incomplete AAC payload 1
    ])
  });
  aacStream.push({
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

  equal(frames.length, 2, 'parsed two frames');
  deepEqual(new Uint8Array(frames[0].data),
            new Uint8Array([0x12, 0x34]),
            'extracted the first AAC frame');
  deepEqual(new Uint8Array(frames[1].data),
            new Uint8Array([0x9a, 0xbc]),
            'extracted the second AAC frame');
});

test('resyncs data in aac frames that contain garbage', function() {
  var frames = [];
  aacStream.on('data', function(frame) {
    frames.push(frame);
  });

  aacStream.push({
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
  aacStream.push({
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

  equal(frames.length, 2, 'parsed two frames');
  deepEqual(new Uint8Array(frames[0].data),
            new Uint8Array([0x9a, 0xbc]),
            'extracted the first AAC frame');
  deepEqual(new Uint8Array(frames[1].data),
            new Uint8Array([0x12, 0x34]),
            'extracted the second AAC frame');
});

test('ignores audio "MPEG version" bit in adts header', function() {
  var frames = [];
  aacStream.on('data', function(frame) {
    frames.push(frame);
  });
  aacStream.push({
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

  equal(frames.length, 1, 'parsed a frame');
  deepEqual(new Uint8Array(frames[0].data),
            new Uint8Array([0x12, 0x34]),
            'skipped the CRC');
});

test('skips CRC bytes', function() {
  var frames = [];
  aacStream.on('data', function(frame) {
    frames.push(frame);
  });
  aacStream.push({
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

  equal(frames.length, 1, 'parsed a frame');
  deepEqual(new Uint8Array(frames[0].data),
            new Uint8Array([0x12, 0x34]),
            'skipped the CRC');
});

module('AudioSegmentStream', {
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

test('ensures baseMediaDecodeTime for audio is not negative', function() {
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

  equal(events.length, 1, 'a data event fired');
  equal(events[0].track.samples.length, 1, 'generated only one sample');
  boxes = muxjs.tools.inspectMp4(events[0].boxes);
  equal(boxes[0].boxes[1].boxes[1].baseMediaDecodeTime, 2, 'kept the later sample');
});

test('audio track metadata takes on the value of the last metadata seen', function() {
  var events = [], boxes;

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

  equal(events.length, 1, 'a data event fired');
  equal(events[0].track.samples.length, 2, 'generated two samples');
  equal(events[0].track.samplerate, 10000, 'kept the later samplerate');
  equal(events[0].track.channelcount, 4, 'kept the later channelcount');
});

module('Transmuxer - options');

test('no options creates combined output', function() {
  var
    segments = [],
    boxes,
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
  transmuxer.flush();

  equal(segments.length, 1, 'generated a combined video and audio segment');
  equal(segments[0].type, 'combined', 'combined is the segment type');

  boxes = muxjs.tools.inspectMp4(segments[0].data);
  equal(boxes.length, 6, 'generated 6 top-level boxes');
  equal('ftyp', boxes[0].type, 'generated an ftyp box');
  equal('moov', boxes[1].type, 'generated a single moov box');
  equal('moof', boxes[2].type, 'generated a first moof box');
  equal('mdat', boxes[3].type, 'generated a first mdat box');
  equal('moof', boxes[4].type, 'generated a second moof box');
  equal('mdat', boxes[5].type, 'generated a second mdat box');
});

test('can specify that we want to generate separate audio and video segments', function() {
  var
    segments = [],
    segmentLengthOnDone,
    boxes,
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
  transmuxer.flush();

  equal(segmentLengthOnDone, 2, 'emitted both segments before triggering done');
  equal(segments.length, 2, 'generated a video and an audio segment');
  ok(segments[0].type === 'video' || segments[1].type === 'video', 'one segment is video');
  ok(segments[0].type === 'audio' || segments[1].type === 'audio', 'one segment is audio');

  boxes = muxjs.tools.inspectMp4(segments[0].data);
  equal(boxes.length, 4, 'generated 4 top-level boxes');
  equal('ftyp', boxes[0].type, 'generated an ftyp box');
  equal('moov', boxes[1].type, 'generated a moov box');
  equal('moof', boxes[2].type, 'generated a moof box');
  equal('mdat', boxes[3].type, 'generated a mdat box');

  boxes = muxjs.tools.inspectMp4(segments[1].data);
  equal(boxes.length, 4, 'generated 4 top-level boxes');
  equal('ftyp', boxes[0].type, 'generated an ftyp box');
  equal('moov', boxes[1].type, 'generated a moov box');
  equal('moof', boxes[2].type, 'generated a moof box');
  equal('mdat', boxes[3].type, 'generated a mdat box');
});

module('MP4 - Transmuxer', {
  setup: function() {
    transmuxer = new Transmuxer();
  }
});

test('generates a video init segment', function() {
  var segments = [], boxes;
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
  transmuxer.flush();

  equal(segments.length, 1, 'generated a segment');
  ok(segments[0].data, 'wrote data in the init segment');
  equal(segments[0].type, 'video', 'video is the segment type');

  boxes = muxjs.tools.inspectMp4(segments[0].data);
  equal('ftyp', boxes[0].type, 'generated an ftyp box');
  equal('moov', boxes[1].type, 'generated a moov box');
});

test('generates an audio init segment', function() {
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

  equal(segments.length, 1, 'generated a segment');
  ok(segments[0].data, 'wrote data in the init segment');
  equal(segments[0].type, 'audio', 'audio is the segment type');

  boxes = muxjs.tools.inspectMp4(segments[0].data);
  equal('ftyp', boxes[0].type, 'generated an ftyp box');
  equal('moov', boxes[1].type, 'generated a moov box');
});

test('buffers video samples until flushed', function() {
  var samples = [], offset, boxes;
  transmuxer.on('data', function(data) {
    samples.push(data);
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
  equal(samples.length, 1, 'emitted one event');
  boxes = muxjs.tools.inspectMp4(samples[0].data);
  equal(boxes.length, 4, 'generated four boxes');
  equal(boxes[2].type, 'moof', 'the third box is a moof');
  equal(boxes[3].type, 'mdat', 'the fourth box is a mdat');

  offset = boxes[0].size + boxes[1].size + boxes[2].size + 8;
  deepEqual(new Uint8Array(samples[0].data.subarray(offset)),
            new Uint8Array([
              0, 0, 0, 2,
              0x09, 0x01,
              0, 0, 0, 2,
              0x00, 0x02,
              0, 0, 0, 2,
              0x09, 0x03,
              0, 0, 0, 2,
              0x00, 0x04,
              0, 0, 0, 2,
              0x00, 0x05]),
            'concatenated NALs into an mdat');
});

test('creates a metadata stream', function() {
  ok(transmuxer.metadataStream, 'created a metadata stream');
});

test('pipes timed metadata to the metadata stream', function() {
  var metadatas = [];
  transmuxer.metadataStream.on('data', function(data) {
    metadatas.push(data);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(PMT));
  transmuxer.push(packetize(timedMetadataPes([0x03])));

  transmuxer.flush();
  equal(metadatas.length, 1, 'emitted timed metadata');
});


validateTrack = function(track, metadata) {
  var mdia, handlerType;
  equal(track.type, 'trak', 'wrote the track type');
  equal(track.boxes.length, 2, 'wrote track children');
  equal(track.boxes[0].type, 'tkhd', 'wrote the track header');
  if (metadata) {
    if (metadata.trackId) {
      equal(track.boxes[0].trackId, metadata.trackId, 'wrote the track id');
    }
    if (metadata.width) {
      equal(track.boxes[0].width, metadata.width, 'wrote the width');
    }
    if (metadata.height) {
      equal(track.boxes[0].height, metadata.height, 'wrote the height');
    }
  }

  mdia = track.boxes[1];
  equal(mdia.type, 'mdia', 'wrote the media');
  equal(mdia.boxes.length, 3, 'wrote the mdia children');

  equal(mdia.boxes[0].type, 'mdhd', 'wrote the media header');
  equal(mdia.boxes[0].language, 'und', 'the language is undefined');
  equal(mdia.boxes[0].duration, 0xffffffff, 'the duration is at maximum');

  equal(mdia.boxes[1].type, 'hdlr', 'wrote the media handler');
  handlerType = mdia.boxes[1].handlerType;

  equal(mdia.boxes[2].type, 'minf', 'wrote the media info');
};

validateTrackFragment = function(track, segment, metadata, type) {
  var tfhd, trun, sdtp, i, j, sample, nalUnitType;
  equal(track.type, 'traf', 'wrote a track fragment');

  if (type === 'video') {
    equal(track.boxes.length, 4, 'wrote four track fragment children');
  } else if (type === 'audio') {
    equal(track.boxes.length, 3, 'wrote three track fragment children');
  }

  tfhd = track.boxes[0];
  equal(tfhd.type, 'tfhd', 'wrote a track fragment header');
  equal(tfhd.trackId, metadata.trackId, 'wrote the track id');

  equal(track.boxes[1].type,
        'tfdt',
        'wrote a track fragment decode time box');
  ok(track.boxes[1].baseMediaDecodeTime >= 0, 'base decode time is non-negative');

  trun = track.boxes[2];
  ok(trun.dataOffset >= 0, 'set data offset');

  equal(trun.dataOffset,
        metadata.mdatOffset + 8,
        'trun data offset is the size of the moof');

  ok(trun.samples.length > 0, 'generated media samples');
  for (i = 0, j = metadata.baseOffset + trun.dataOffset;
       i < trun.samples.length;
       i++) {
    sample = trun.samples[i];
    ok(sample.size > 0, 'wrote a positive size for sample ' + i);
    if (type === 'video') {
      ok(sample.duration > 0, 'wrote a positive duration for sample ' + i);
      ok(sample.compositionTimeOffset >= 0,
         'wrote a positive composition time offset for sample ' + i);
      ok(sample.flags, 'wrote sample flags');
      equal(sample.flags.isLeading, 0, 'the leading nature is unknown');

      notEqual(sample.flags.dependsOn, 0, 'sample dependency is not unknown');
      notEqual(sample.flags.dependsOn, 4, 'sample dependency is valid');
      nalUnitType = segment[j + 4] & 0x1F;
      equal(nalUnitType, 9, 'samples begin with an access_unit_delimiter_rbsp');

      equal(sample.flags.isDependedOn, 0, 'dependency of other samples is unknown');
      equal(sample.flags.hasRedundancy, 0, 'sample redundancy is unknown');
      equal(sample.flags.degradationPriority, 0, 'sample degradation priority is zero');
    } else {
      equal(sample.duration, 1024,
            'aac sample duration is always 1024');
    }
    j += sample.size; // advance to the next sample in the mdat
  }

  if (type === 'video') {
    sdtp = track.boxes[3];
    equal(trun.samples.length,
          sdtp.samples.length,
          'wrote an equal number of trun and sdtp samples');
    for (i = 0; i < sdtp.samples.length; i++) {
      sample = sdtp.samples[i];
      notEqual(sample.dependsOn, 0, 'sample dependency is not unknown');
      equal(trun.samples[i].flags.dependsOn,
            sample.dependsOn,
            'wrote a consistent dependsOn');
      equal(trun.samples[i].flags.isDependedOn,
            sample.isDependedOn,
            'wrote a consistent isDependedOn');
      equal(trun.samples[i].flags.hasRedundancy,
            sample.hasRedundancy,
            'wrote a consistent hasRedundancy');
    }
  }
};

test('parses an example mp2t file and generates combined media segments', function() {
  var
    segments = [],
    i, j, boxes, mfhd, trackType = 'video', trackId = 256, baseOffset = 0;

  transmuxer.on('data', function(segment) {
    if (segment.type === 'combined') {
      segments.push(segment);
    }
  });
  transmuxer.push(window.testSegment);
  transmuxer.flush();

  equal(segments.length, 1, 'generated one combined segment');

  boxes = muxjs.tools.inspectMp4(segments[0].data);
  equal(boxes.length, 6, 'combined segments are composed of six boxes');
  equal(boxes[0].type, 'ftyp', 'the first box is an ftyp');
  equal(boxes[1].type, 'moov', 'the second box is a moov');
  equal(boxes[1].boxes[0].type, 'mvhd', 'generated an mvhd');
  validateTrack(boxes[1].boxes[1], {
    trackId: 256
  });
  validateTrack(boxes[1].boxes[2], {
    trackId: 257
  });

  for (i = 2; i < boxes.length; i += 2) {
    equal(boxes[i].type, 'moof', 'first box is a moof');
    equal(boxes[i].boxes.length, 2, 'the moof has two children');

    mfhd = boxes[i].boxes[0];
    equal(mfhd.type, 'mfhd', 'mfhd is a child of the moof');

    equal(boxes[i + 1].type, 'mdat', 'second box is an mdat');

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

test('can be reused for multiple TS segments', function() {
  var
    segments = [],
    sequenceNumber = window.Infinity,
    i, boxes, mfhd;

  transmuxer.on('data', function(segment) {
    if (segment.type === 'combined') {
      segments.push(muxjs.tools.inspectMp4(segment.data));
    }
  });
  transmuxer.push(window.testSegment);
  transmuxer.flush();
  transmuxer.push(window.testSegment);
  transmuxer.flush();

  equal(segments.length, 2, 'generated two combined segments');
  deepEqual(segments[0][0],
            segments[1][0],
            'generated identical ftyps');
  deepEqual(segments[0][1],
            segments[1][1],
            'generated identical moovs');
  deepEqual(segments[0][2].boxes[1],
            segments[1][2].boxes[1],
            'generated identical video trafs');
  equal(segments[0][2].boxes[0].sequenceNumber,
        0,
        'set the correct video sequence number');
  equal(segments[1][2].boxes[0].sequenceNumber,
        1,
        'set the correct video sequence number');
  deepEqual(segments[0][3],
            segments[1][3],
            'generated identical video mdats');

  deepEqual(segments[0][4].boxes[3],
            segments[1][4].boxes[3],
            'generated identical audio trafs');
  equal(segments[0][4].boxes[0].sequenceNumber,
        0,
        'set the correct video sequence number');
  equal(segments[1][4].boxes[0].sequenceNumber,
        1,
        'set the correct video sequence number');
  deepEqual(segments[0][5],
            segments[1][5],
            'generated identical audio mdats');
});

module('NalByteStream', {
  setup: function() {
    nalByteStream = new NalByteStream();
  }
});

test('parses nal units with 4-byte start code', function(){
  var nalUnits = [];
  nalByteStream.on('data', function (data) {
    nalUnits.push(data);
  });

  nalByteStream.push({
    data: new Uint8Array([
      0x00, 0x00, 0x00, 0x01, // start code
      0x09, 0xFF, // Payload
      0x00, 0x00, 0x00 // end code
    ])
  });

  equal(nalUnits.length, 1, 'found one nal');
  deepEqual(nalUnits[0], new Uint8Array([0x09, 0xFF]), 'has the proper payload');
});

test('parses nal units with 3-byte start code', function(){
  var nalUnits = [];
  nalByteStream.on('data', function (data) {
    nalUnits.push(data);
  });

  nalByteStream.push({
    data: new Uint8Array([
      0x00, 0x00, 0x01, // start code
      0x09, 0xFF, // Payload
      0x00, 0x00, 0x00 // end code
    ])
  });

  equal(nalUnits.length, 1, 'found one nal');
  deepEqual(nalUnits[0], new Uint8Array([0x09, 0xFF]), 'has the proper payload');
});

test('parses multiple nal units', function(){
  var nalUnits = [];
  nalByteStream.on('data', function (data) {
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

  equal(nalUnits.length, 2, 'found two nals');
  deepEqual(nalUnits[0], new Uint8Array([0x09, 0xFF]), 'has the proper payload');
  deepEqual(nalUnits[1], new Uint8Array([0x12, 0xDD]), 'has the proper payload');
});

test('parses nal units surrounded by an unreasonable amount of zero-bytes', function(){
  var nalUnits = [];
  nalByteStream.on('data', function (data) {
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

  equal(nalUnits.length, 2, 'found two nals');
  deepEqual(nalUnits[0], new Uint8Array([0x09, 0xFF]), 'has the proper payload');
  deepEqual(nalUnits[1], new Uint8Array([0x12, 0xDD]), 'has the proper payload');
});

test('parses nal units split across multiple packets', function(){
  var nalUnits = [];
  nalByteStream.on('data', function (data) {
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

  equal(nalUnits.length, 1, 'found two nals');
  deepEqual(nalUnits[0], new Uint8Array([0x09, 0xFF, 0x12, 0xDD]), 'has the proper payload');
});

module('FLV - Transmuxer', {
  setup: function() {
    transmuxer = new FlvTransmuxer();
  }
});

test('generates video tags', function() {
  var segments = [], boxes;
  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });
  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true
  })));

  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter
  ], true)));
  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter
  ], true)));

  transmuxer.flush();

  equal(segments[0].tags.audioTags.length, 0, 'generated no audio tags');
  equal(segments[0].tags.videoTags.length, 2, 'generated a two video tags');
});

test('drops nalUnits at the start of a segment not preceeded by an access_unit_delimiter_rbsp', function() {
  var segments = [], boxes;
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
      0x09, 0x01 // access_unit_delimiter
  ], true)));

  transmuxer.flush();

  equal(segments[0].tags.audioTags.length, 0, 'generated no audio tags');
  equal(segments[0].tags.videoTags.length, 1, 'generated a single video tag');
});

test('generates an audio tags', function() {
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

  equal(segments[0].tags.audioTags.length, 3, 'generated three audio tags');
  equal(segments[0].tags.videoTags.length, 0, 'generated no video tags');
});

test('buffers video samples until flushed', function() {
  var segments = [], offset, boxes;
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

  equal(segments[0].tags.audioTags.length, 0, 'generated no audio tags');
  equal(segments[0].tags.videoTags.length, 2, 'generated two video tags');
});

})(window, window.muxjs);
