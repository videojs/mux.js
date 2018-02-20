'use strict';

var
  QUnit = require('qunit'),
  parsers = require('../../../lib/codecs/parsers/adts');

QUnit.module('adts parsers');

QUnit.test('parses ADTS header', function(assert) {
  // Header is 7 bytes (without CRC), starting from offset of 1 byte (32). 33 starts data.
  var headerAndData = new Uint8Array([32, 255, 241, 76, 128, 20, 159, 252, 33]);

  assert.deepEqual(parsers.parseAdtsHeader(headerAndData, 1), {
    protectionSkipBytes: 0,
    frameEnd: 165,
    adtsFrameDuration: 1920,
    sampleCount: 1024,
    audioObjectType: 2,
    channelCount: 2,
    samplingFrequencyIndex: 3,
    sampleRate: 48000
  }, 'parsed ADTS header');
});

