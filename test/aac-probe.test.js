'use strict';

var
  QUnit = require('qunit'),
  probe = require('../lib/aac/probe.js'),
  testSegment = require('./utils/test-aac-segment.js');

var id3TagOffset = 0;
var audioFrameOffset = 73;


QUnit.module('AAC Probe');

QUnit.test('correctly parses aac packet type', function() {
  QUnit.equal(probe.parseType(testSegment, id3TagOffset), 'timed-metadata',
    'parsed timed-metadata type');
  QUnit.equal(probe.parseType(testSegment, 1), null,
    'parsed unknown type');
  QUnit.equal(probe.parseType(testSegment, audioFrameOffset), 'audio',
    'parsed audio type');
});

QUnit.test('correctly parses ID3 tag size', function() {
  QUnit.equal(probe.parseId3TagSize(testSegment, id3TagOffset), 73,
    'correct id3 tag size');
});

QUnit.test('correctly parses timestamp from ID3 metadata', function() {
  var frameSize = probe.parseId3TagSize(testSegment, id3TagOffset);
  var frame = testSegment.subarray(id3TagOffset, id3TagOffset + frameSize);

  QUnit.equal(probe.parseAacTimestamp(frame), 895690, 'correct aac timestamp');
});

QUnit.test('correctly parses adts frame size', function() {
  QUnit.equal(probe.parseAdtsSize(testSegment, audioFrameOffset), 13,
    'correct adts frame size');
});

QUnit.test('correctly parses packet sample rate', function() {
  var frameSize = probe.parseAdtsSize(testSegment, audioFrameOffset);
  var frame = testSegment.subarray(audioFrameOffset, audioFrameOffset + frameSize);

  QUnit.equal(probe.parseSampleRate(frame), 44100, 'correct sample rate');
});
