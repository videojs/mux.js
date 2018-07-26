'use strict';

var
  QUnit = require('qunit'),
  utils = require('../lib/aac/utils.js'),
  testSegment = require('./utils/test-aac-segment.js');

var id3TagOffset = 0;
var audioFrameOffset = 73;


QUnit.module('AAC Utils');

QUnit.test('correctly parses aac packet type', function() {
  QUnit.equal(utils.parseType(testSegment, id3TagOffset), 'timed-metadata',
    'parsed timed-metadata type');
  QUnit.equal(utils.parseType(testSegment, 1), null,
    'parsed unknown type');
  QUnit.equal(utils.parseType(testSegment, audioFrameOffset), 'audio',
    'parsed audio type');
});

QUnit.test('correctly parses ID3 tag size', function() {
  QUnit.equal(utils.parseId3TagSize(testSegment, id3TagOffset), 73,
    'correct id3 tag size');
});

QUnit.test('correctly parses timestamp from ID3 metadata', function() {
  var frameSize = utils.parseId3TagSize(testSegment, id3TagOffset);
  var frame = testSegment.subarray(id3TagOffset, id3TagOffset + frameSize);

  QUnit.equal(utils.parseAacTimestamp(frame), 895690, 'correct aac timestamp');
});

QUnit.test('correctly parses adts frame size', function() {
  QUnit.equal(utils.parseAdtsSize(testSegment, audioFrameOffset), 13,
    'correct adts frame size');
});

QUnit.test('correctly parses packet sample rate', function() {
  var frameSize = utils.parseAdtsSize(testSegment, audioFrameOffset);
  var frame = testSegment.subarray(audioFrameOffset, audioFrameOffset + frameSize);

  QUnit.equal(utils.parseSampleRate(frame), 44100, 'correct sample rate');
});

QUnit.test('parses correct ID3 tag size', function() {
  var packetStream = new Uint8Array(10);

  packetStream[9] = 63;

  QUnit.equal(utils.parseId3TagSize(packetStream, 0),
              73,
              'correctly parsed a header without a footer');
});

QUnit.test('parses correct ADTS Frame size', function() {
  var packetStream = new Uint8Array(6);

  packetStream[3] = 128;
  packetStream[4] = 29;
  packetStream[5] = 255;

  QUnit.equal(utils.parseAdtsSize(packetStream, 0), 239, 'correctly parsed framesize');
});
