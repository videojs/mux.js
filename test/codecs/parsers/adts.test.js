'use strict';

var
  QUnit = require('qunit'),
  parsers = require('../../../lib/codecs/parsers/adts');

QUnit.module('adts parsers');

QUnit.test('parses ADTS header', function(assert) {
  var offsetBytes = [0, 1, 2];
  // Header is 7 bytes (without CRC)
  var adtsHeader = [255, 241, 92, 128, 29, 255, 252];
  var aacData = [33, 121];
  var payload = new Uint8Array(offsetBytes.concat(adtsHeader).concat(aacData));

  assert.deepEqual(parsers.parseAdtsHeader(payload, offsetBytes.length), {
    protectionSkipBytes: 0,
    frameEnd: 242,
    adtsFrameDuration: 1024 * 90000 / 22050,
    sampleCount: 1024,
    audioObjectType: 2,
    channelCount: 2,
    samplingFrequencyIndex: 7,
    sampleRate: 22050
  }, 'parsed ADTS header');
});

