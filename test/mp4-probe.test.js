'use strict';

var
  QUnit = require('qunit'),
  deepEqual = QUnit.deepEqual,
  equal = QUnit.equal,
  test = QUnit.test,

  probe = require('../lib/mp4/probe'),
  mp4Helpers = require('./utils/mp4-helpers'),
  box = mp4Helpers.box,

  // defined below
  moovWithoutMdhd,
  moovWithoutTkhd,
  moofWithTfdt,
  multiMoof,
  v1boxes;

QUnit.module('MP4 Probe');

test('reads the timescale from an mdhd', function() {
  // sampleMoov has a base timescale of 1000 with an override to 90kHz
  // in the mdhd
  deepEqual(probe.timescale(new Uint8Array(mp4Helpers.sampleMoov)), {
    1: 90e3
  }, 'found the timescale');
});

test('returns null if the tkhd is missing', function() {
  equal(probe.timescale(new Uint8Array(moovWithoutTkhd)), null, 'indicated missing info');
});

test('returns null if the mdhd is missing', function() {
  equal(probe.timescale(new Uint8Array(moovWithoutMdhd)), null, 'indicated missing info');
});

test('reads the base decode time from a tfdt', function() {
  equal(probe.startTime({
    4: 2
  }, new Uint8Array(moofWithTfdt)),
        0x01020304 / 2,
        'calculated base decode time');
});

test('returns the earliest base decode time', function() {
  equal(probe.startTime({
    4: 2,
    6: 1
  }, new Uint8Array(multiMoof)),
        0x01020304 / 2,
        'returned the earlier time');
});

test('parses 64-bit base decode times', function() {
  equal(probe.startTime({
    4: 3
  }, new Uint8Array(v1boxes)),
        0x0101020304 / 3,
        'parsed a long value');
});

// ---------
// Test Data
// ---------

moovWithoutTkhd =
  box('moov',
      box('trak',
          box('mdia',
              box('mdhd',
                  0x00, // version 0
                  0x00, 0x00, 0x00, // flags
                  0x00, 0x00, 0x00, 0x02, // creation_time
                  0x00, 0x00, 0x00, 0x03, // modification_time
                  0x00, 0x00, 0x03, 0xe8, // timescale = 1000
                  0x00, 0x00, 0x00, 0x00,
                  0x00, 0x00, 0x02, 0x58, // 600 = 0x258 duration
                  0x15, 0xc7, // 'eng' language
                  0x00, 0x00),
              box('hdlr',
                  0x00, // version 1
                  0x00, 0x00, 0x00, // flags
                  0x00, 0x00, 0x00, 0x00, // pre_defined
                  mp4Helpers.typeBytes('vide'), // handler_type
                  0x00, 0x00, 0x00, 0x00, // reserved
                  0x00, 0x00, 0x00, 0x00, // reserved
                  0x00, 0x00, 0x00, 0x00, // reserved
                  mp4Helpers.typeBytes('one'), 0x00)))); // name

moovWithoutMdhd =
  box('moov',
      box('trak',
          box('tkhd',
              0x01, // version 1
              0x00, 0x00, 0x00, // flags
              0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x02, // creation_time
              0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x03, // modification_time
              0x00, 0x00, 0x00, 0x01, // track_ID
              0x00, 0x00, 0x00, 0x00, // reserved
              0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x02, 0x58, // 600 = 0x258 duration
              0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x00, // reserved
              0x00, 0x00, // layer
              0x00, 0x00, // alternate_group
              0x00, 0x00, // non-audio track volume
              0x00, 0x00, // reserved
              mp4Helpers.unityMatrix,
              0x01, 0x2c, 0x00, 0x00, // 300 in 16.16 fixed-point
              0x00, 0x96, 0x00, 0x00), // 150 in 16.16 fixed-point
          box('mdia',
              box('hdlr',
                  0x01, // version 1
                  0x00, 0x00, 0x00, // flags
                  0x00, 0x00, 0x00, 0x00, // pre_defined
                  mp4Helpers.typeBytes('vide'), // handler_type
                  0x00, 0x00, 0x00, 0x00, // reserved
                  0x00, 0x00, 0x00, 0x00, // reserved
                  0x00, 0x00, 0x00, 0x00, // reserved
                  mp4Helpers.typeBytes('one'), 0x00)))); // name

moofWithTfdt =
  box('moof',
      box('mfhd',
          0x00, // version
          0x00, 0x00, 0x00, // flags
          0x00, 0x00, 0x00, 0x04), // sequence_number
      box('traf',
          box('tfhd',
              0x00, // version
              0x00, 0x00, 0x3b, // flags
              0x00, 0x00, 0x00, 0x04, // track_ID = 4
              0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x01, // base_data_offset
              0x00, 0x00, 0x00, 0x02, // sample_description_index
              0x00, 0x00, 0x00, 0x03, // default_sample_duration,
              0x00, 0x00, 0x00, 0x04, // default_sample_size
              0x00, 0x00, 0x00, 0x05),
          box('tfdt',
              0x00, // version
              0x00, 0x00, 0x00, // flags
              0x01, 0x02, 0x03, 0x04))); // baseMediaDecodeTime

multiMoof = moofWithTfdt
  .concat(box('moof',
              box('mfhd',
                  0x00, // version
                  0x00, 0x00, 0x00, // flags
                  0x00, 0x00, 0x00, 0x04), // sequence_number
              box('traf',
                  box('tfhd',
                      0x00, // version
                      0x00, 0x00, 0x3b, // flags
                      0x00, 0x00, 0x00, 0x06, // track_ID = 6
                      0x00, 0x00, 0x00, 0x00,
                      0x00, 0x00, 0x00, 0x01, // base_data_offset
                      0x00, 0x00, 0x00, 0x02, // sample_description_index
                      0x00, 0x00, 0x00, 0x03, // default_sample_duration,
                      0x00, 0x00, 0x00, 0x04, // default_sample_size
                      0x00, 0x00, 0x00, 0x05),
                  box('tfdt',
                      0x00, // version
                      0x00, 0x00, 0x00, // flags
                      0x01, 0x02, 0x03, 0x04)))); // baseMediaDecodeTime
v1boxes =
  box('moof',
      box('mfhd',
          0x01, // version
          0x00, 0x00, 0x00, // flags
          0x00, 0x00, 0x00, 0x04), // sequence_number
      box('traf',
          box('tfhd',
              0x01, // version
              0x00, 0x00, 0x3b, // flags
              0x00, 0x00, 0x00, 0x04, // track_ID = 4
              0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x01, // base_data_offset
              0x00, 0x00, 0x00, 0x02, // sample_description_index
              0x00, 0x00, 0x00, 0x03, // default_sample_duration,
              0x00, 0x00, 0x00, 0x04, // default_sample_size
              0x00, 0x00, 0x00, 0x05),
          box('tfdt',
              0x01, // version
              0x00, 0x00, 0x00, // flags
              0x00, 0x00, 0x00, 0x01,
              0x01, 0x02, 0x03, 0x04))); // baseMediaDecodeTime
