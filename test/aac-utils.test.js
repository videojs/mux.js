var
  QUnit = require('qunit'),
  aacUtils = require('../lib/aac/utils');

QUnit.module('aac utils');

QUnit.test('parses correct ID3 tag size', function() {
  var packetStream = new Uint8Array(10);

  packetStream[9] = 63;

  QUnit.equal(aacUtils.parseId3TagSize(packetStream, 0),
              73,
              'ParseID3 correctly parsed a header without a footer');
});

QUnit.test('parses correct ADTS Frame size', function() {
  var packetStream = new Uint8Array(6);

  packetStream[3] = 128;
  packetStream[4] = 29;
  packetStream[5] = 255;

  QUnit.equal(aacUtils.parseAdtsSize(packetStream, 0),
              239,
              'ParseADTS correctly parsed framesize');
});

