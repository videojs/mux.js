var mp2t = require('../lib/m2ts'),
    codecs = require('../lib/codecs'),
    flv = require('../lib/flv'),
    id3Generator = require('./utils/id3-generator'),
    mp4 = require('../lib/mp4'),
    QUnit = require('qunit'),
    testSegment = require('./utils/test-segment');

var

  TransportPacketStream = mp2t.TransportPacketStream,
  transportPacketStream,
  TransportParseStream = mp2t.TransportParseStream,
  transportParseStream,
  ElementaryStream = mp2t.ElementaryStream,
  elementaryStream,
  H264Stream = codecs.h264.H264Stream,
  h264Stream,

  VideoSegmentStream = mp4.VideoSegmentStream,
  videoSegmentStream,
  AudioSegmentStream = mp4.AudioSegmentStream,
  audioSegmentStream,

  AacStream = codecs.aac,
  aacStream,
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
  standalonePes,
  validateTrack,
  validateTrackFragment,

  pesHeader,
  transportPacket,
  videoPes,
  audioPes,
  SYNC_BYTE = 0x47,
  MP2T_PACKET_LENGTH = 188,
  timedMetadataPes;

QUnit.module('MP2T Packet Stream - Errors:', {
  beforeEach: function() {
    var self = this;
    this.errorCount = 0;
    this.dataCount = 0;
    this.transportPacketStream = new TransportPacketStream();
    this.transportPacketStream.on('error', function(error) {
      self.errorCount++;
    });
    this.transportPacketStream.on('data', function(data) {
      self.dataCount++;
    });

  },
});

QUnit.test('empty input with no buffer does not push data', function() {
  this.transportPacketStream.push(new Uint8Array([]));
  QUnit.equal(this.dataCount, 0, 'no data was pushed');
});

QUnit.test('invalid input does not push data', function() {
  this.transportPacketStream.push("Bad Data");
  QUnit.equal(this.dataCount, 0, 'no data was pushed');
});

QUnit.test('stream with no sync byte does not push data', function() {
  this.transportPacketStream.push(new Uint8Array(MP2T_PACKET_LENGTH * 2));
  QUnit.equal(this.dataCount, 0, 'no data was pushed');
});

QUnit.test('stream with 1 sync byte does not get pushed', function() {
  var packetStream = new Uint8Array(MP2T_PACKET_LENGTH);
  packetStream[0] = SYNC_BYTE;

  this.transportPacketStream.push(packetStream);
  QUnit.equal(this.dataCount, 0, 'no data was pushed');
});

QUnit.test('stream with 2 sync bytes pushes data once', function() {
  var packetStream = new Uint8Array(MP2T_PACKET_LENGTH * 2 + 1);
  packetStream[0] = SYNC_BYTE;
  packetStream[MP2T_PACKET_LENGTH] = SYNC_BYTE;

  this.transportPacketStream.push(packetStream);
  QUnit.equal(this.dataCount, 1, 'data was pushed');
});

QUnit.test('stream with 3 sync bytes pushes data twice', function() {
  var packetStream = new Uint8Array(MP2T_PACKET_LENGTH * 2 + 1);
  packetStream[0] = SYNC_BYTE;
  packetStream[MP2T_PACKET_LENGTH] = SYNC_BYTE;
  packetStream[MP2T_PACKET_LENGTH*2] = SYNC_BYTE;

  this.transportPacketStream.push(packetStream);
  QUnit.equal(this.dataCount, 2, 'data was pushed twice');
});

QUnit.test('stream with invalid first byte and two sync bytes pushes once', function() {
  var packetStream = new Uint8Array(MP2T_PACKET_LENGTH + 1);
  packetStream[1] = SYNC_BYTE;
  packetStream[MP2T_PACKET_LENGTH+1] = SYNC_BYTE;

  this.transportPacketStream.push(packetStream);
  this.transportPacketStream.flush();
  QUnit.equal(this.dataCount, 1, 'data was pushed once');
});

QUnit.test('invalid first sync byte thrown out. valid packet is parsed', function() {
  var packetStream = new Uint8Array(MP2T_PACKET_LENGTH + 55);
  packetStream[1] = SYNC_BYTE;
  packetStream[55] = SYNC_BYTE;
  packetStream[MP2T_PACKET_LENGTH+55] = SYNC_BYTE;

  this.transportPacketStream.push(packetStream);
  this.transportPacketStream.flush();
  QUnit.equal(this.dataCount, 1, 'data was pushed once');
});

QUnit.test('flush with nothing emitted causes an error', function() {
  this.transportPacketStream.flush();
  QUnit.equal(this.dataCount, 0, 'data was not pushed');
  QUnit.equal(this.errorCount, 1, 'error was reported');
});


QUnit.module('MP2T Parse Stream - Errors:', {
  beforeEach: function() {
    var self = this;
    this.errorCount = 0;
    this.dataCount = 0;
    this.transportParseStream = new TransportParseStream();
    this.transportParseStream.on('error', function(error) {
      self.errorCount++;
    });
    this.transportParseStream.on('data', function(data) {
      self.dataCount++;
    });

  },
});

QUnit.test('empty input with no buffer does not push data', function() {
  this.transportParseStream.push(new Uint8Array());
  QUnit.equal(this.dataCount, 0, 'no data was pushed');
  QUnit.equal(this.errorCount, 1, 'error was triggered');
});

QUnit.test('invalid input does not push data', function() {
  this.transportParseStream.push("Bad Data");
  QUnit.equal(this.dataCount, 0, 'no data was pushed');
  QUnit.equal(this.errorCount, 1, 'error was triggered');
});

QUnit.test('empty input with no buffer does not push data', function() {
  var packet = new Uint8Array(MP2T_PACKET_LENGTH);
  packet[0] = SYNC_BYTE;
  packet[1] = 0x02;

  this.transportParseStream.push(packet);
  QUnit.equal(this.dataCount, 0, 'no data was pushed');
  QUnit.equal(this.errorCount, 0, 'error was triggered');
});

QUnit.test('flush with nothing emitted causes an error', function() {
  this.transportParseStream.flush();
  QUnit.equal(this.dataCount, 0, 'data was not pushed');
  QUnit.equal(this.errorCount, 1, 'error was reported');
});


QUnit.module('MP2T Elementary Stream - Errors:', {
  beforeEach: function() {
    var self = this;
    this.errorCount = 0;
    this.dataCount = 0;
    this.elementaryStream = new ElementaryStream();
    this.elementaryStream.on('error', function(error) {
      self.errorCount++;
    });
    this.elementaryStream.on('data', function(data) {
      self.dataCount++;
    });

  },
});

QUnit.test('empty input errors', function() {
  this.elementaryStream.push();
  QUnit.equal(this.dataCount, 0, 'no data was pushed');
  QUnit.equal(this.errorCount, 1, 'error was triggered');
});

QUnit.test('no type key errors', function() {
  this.elementaryStream.push({});
  QUnit.equal(this.dataCount, 0, 'no data was pushed');
  QUnit.equal(this.errorCount, 1, 'error was triggered');
});

QUnit.test('unknown type key errors', function() {
  this.elementaryStream.push({
    type: 'foo'
  });
  QUnit.equal(this.dataCount, 0, 'no data was pushed');
  QUnit.equal(this.errorCount, 1, 'error was triggered');
});

QUnit.test('pes with no streamType key errors', function() {
  this.elementaryStream.push({
    type: 'pes',
  });
  QUnit.equal(this.dataCount, 0, 'no data was pushed');
  QUnit.equal(this.errorCount, 1, 'error was triggered');
});

QUnit.test('flush with nothing emitted causes an error', function() {
  this.elementaryStream.flush();
  QUnit.equal(this.dataCount, 0, 'data was not pushed');
  QUnit.equal(this.errorCount, 1, 'error was reported');
});

