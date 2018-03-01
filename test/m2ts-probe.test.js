'use strict';

var
  QUnit = require('qunit'),
  probe = require('../lib/m2ts/probe.js'),
  testSegment = require('./utils/test-segment.js'),
  stuffedPesPacket = require('./utils/test-stuffed-pes.js');

var SYNC_BYTE = 0x47;

/**
 * All subarray indices verified with the use of thumbcoil.
 */
var patPacket = testSegment.subarray(188, 376);
var pmtPid = 4095;
var programMapTable = {
  256: 0x1B,
  257: 0x0F
};
var pmtPacket = testSegment.subarray(376, 564);
var pesPacket = testSegment.subarray(564, 752);
var videoPacket = testSegment.subarray(564, 1692);
var videoNoKeyFramePacket = testSegment.subarray(1880, 2820);
var audioPacket = testSegment.subarray(6956, 7144);
var notPusiPacket = testSegment.subarray(1316, 1504);

QUnit.module('M2TS Probe');

QUnit.test('correctly parses packet type', function() {
  QUnit.equal(probe.parseType(patPacket), 'pat', 'parses pat type');
  QUnit.equal(probe.parseType(pmtPacket), null,
    'cannot determine type of pmt packet when pmt pid has not been parsed yet');
  QUnit.equal(probe.parseType(pmtPacket, pmtPid), 'pmt', 'parses pmt type');
  QUnit.equal(probe.parseType(pesPacket), null,
    'cannot determine type of pes packet when pmt pid has not been parsed yet');
  QUnit.equal(probe.parseType(pesPacket, pmtPid), 'pes', 'parses pes type');
});

QUnit.test('correctly parses pmt pid from pat packet', function() {
  QUnit.equal(probe.parsePat(patPacket), pmtPid, 'parses pmt pid from pat');
});

QUnit.test('correctly parses program map table from pmt packet', function() {
  QUnit.deepEqual(probe.parsePmt(pmtPacket), programMapTable, 'generates correct pmt');
});

QUnit.test('correctly parses payload unit start indicator', function() {
  QUnit.ok(probe.parsePayloadUnitStartIndicator(pesPacket),
    'detects payload unit start indicator');
  QUnit.ok(!probe.parsePayloadUnitStartIndicator(notPusiPacket),
    'detects no payload unit start indicator');
});

QUnit.test('correctly parses type of pes packet', function() {
  QUnit.equal(probe.parsePesType(videoPacket, programMapTable), 'video',
    'parses video pes type');
  QUnit.equal(probe.parsePesType(audioPacket, programMapTable), 'audio',
    'parses audio pes type');
});

QUnit.test('correctly parses dts and pts values of pes packet', function() {
  var videoPes = probe.parsePesTime(videoPacket);
  QUnit.equal(videoPes.dts, 126000, 'correct dts value');
  QUnit.equal(videoPes.pts, 126000, 'correct pts value');

  videoPes = probe.parsePesTime(stuffedPesPacket);
  QUnit.equal(videoPes, null,
    'correctly returned null when there is no packet data, only stuffing');
});

QUnit.test('correctly determines if video pes packet contains a key frame', function() {
  QUnit.ok(probe.videoPacketContainsKeyFrame(videoPacket), 'detects key frame in packet');
  QUnit.ok(!probe.videoPacketContainsKeyFrame(videoNoKeyFramePacket),
    'detects no key frame in packet');
});

QUnit.test('gets ADTS header offset from elementary stream starting at PES header',
function() {
  // 4 byte minimum TS header
  var tsHeader = [SYNC_BYTE, 65, 1, 18];
  // packet prefix start code is 0x000001, followed by header info
  var pesHeader = [0, 0, 1, 192, 14, 90, 132, 128, 5, 33, 1, 19, 8, 59];
  var adtsHeader = [255, 241, 76, 128, 20, 159, 252];
  var adtsData = [33, 121];
  var packet = new Uint8Array(
    tsHeader.concat(pesHeader).concat(adtsHeader).concat(adtsData));

  QUnit.equal(probe.getAdtsHeaderOffset(packet),
              tsHeader.length + pesHeader.length,
              'correctly gets ADTS header offset');
});

QUnit.test(
'gets ADTS header offset from elementary stream starting at PES header with ' +
  'an adaptation field',
function() {
  // 4 byte minimum TS header, adaptation field specified with 11 (adaptation field
  // followed by payload) as 0b00110000 in the last byte (decimal 48)
  var tsHeader = [SYNC_BYTE, 65, 1, 18, 48];
  // arbitrary length
  var adaptationFieldLength = 4;
  var adaptationField = [adaptationFieldLength - 1, 0, 0, 0];
  // packet prefix start code is 0x000001, followed by header info
  var pesHeader = [0, 0, 1, 192, 14, 90, 132, 128, 5, 33, 1, 19, 8, 59];
  var adtsHeader = [255, 241, 76, 128, 20, 159, 252];
  var adtsData = [33, 121];
  var packet = new Uint8Array(
    tsHeader
      .concat(adaptationField)
      .concat(pesHeader)
      .concat(adtsHeader)
      .concat(adtsData));

  QUnit.equal(probe.getAdtsHeaderOffset(packet),
              tsHeader.length + adaptationField.length + pesHeader.length,
              'correctly gets ADTS header offset');
});

QUnit.test('no ADTS header offset when no ADTS header', function() {
  // 4 byte minimum TS header
  var tsHeader = [SYNC_BYTE, 65, 1, 18];
  // packet prefix start code is 0x000001, followed by header info
  var pesHeader = [0, 0, 1, 192, 14, 90, 132, 128, 5, 33, 1, 19, 8, 59];
  // 10 bytes to account for max ADTS header length (9) and 1 byte of data
  var junkData = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
  var packet = new Uint8Array(tsHeader.concat(pesHeader).concat(junkData));

  QUnit.notOk(probe.getAdtsHeaderOffset(packet), 'no ADTS header offset');
});
