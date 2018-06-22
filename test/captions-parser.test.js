'use strict';

var captionsParser = require('../lib/mp4').captionsParser;

var dashInit = require('./utils/dash-608-708-captions-init-segment');
var dashSegment = require('./utils/dash-608-708-captions-segment');

var mp4Helpers = require('./utils/mp4-helpers');
var box = mp4Helpers.box;
var seiNalUnitGenerator = require('./utils/sei-nal-unit-generator');
var makeMdatFromCaptionPackets = seiNalUnitGenerator.makeMdatFromCaptionPackets;
var characters = seiNalUnitGenerator.characters;

var packets0;
var version0Init;
var version0Moof;
var version0Segment;

var packets1;
var version1Init;
var version1Moof;
var version1Segment;

QUnit.module('MP4 Caption Parser');

QUnit.test('parse captions from real segment', function() {
  var captions = captionsParser.parse(dashInit, dashSegment);

  QUnit.equal(captions.length, 1);
  QUnit.equal(captions[0].text, '00:01:00');
  QUnit.equal(captions[0].stream, 'CC1');
});

QUnit.test('parseTrackId for version 0 and version 1 boxes', function() {
  var version0Captions =
    captionsParser.parse(new Uint8Array(version0Init),
                         new Uint8Array(version0Segment));
  var version1Captions =
    captionsParser.parse(new Uint8Array(version1Init),
                         new Uint8Array(version1Segment));

  QUnit.equal(version0Captions.length, 1, 'got 1 version0 caption');
  QUnit.equal(version0Captions[0].text, 'test string #1',
    'got the expected version0 caption text');
  QUnit.equal(version0Captions[0].stream, 'CC1',
    'returned the correct caption stream CC1');

  QUnit.equal(version1Captions.length, 1, 'got version1 caption');
  QUnit.equal(version1Captions[0].text, 'test string #2',
    'got the expected version1 caption text');
  QUnit.equal(version1Captions[0].stream, 'CC4',
    'returned the correct caption stream CC4');
});

// ---------
// Test Data
// ---------

packets0 = [
  // Send another command so that the second EOC isn't ignored
  { ccData: 0x1420, type: 0 },
  // RCL, resume caption loading
  { ccData: 0x1420, type: 0 },
  // 'test string #1'
  { ccData: characters('te'), type: 0 },
  { ccData: characters('st'), type: 0 },
  { ccData: characters(' s'), type: 0 },
  // 'test string #1' continued
  { ccData: characters('tr'), type: 0 },
  { ccData: characters('in'), type: 0 },
  { ccData: characters('g '), type: 0 },
  { ccData: characters('#1'), type: 0 },
  // EOC, End of Caption. End display
  { ccData: 0x142f, type: 0 },
  // EOC, End of Caption. Finished transmitting, begin display
  { ccData: 0x142f, type: 0 },
  // Send another command so that the second EOC isn't ignored
  { ccData: 0x1420, type: 0 },
  // EOC, End of Caption. End display
  { ccData: 0x142f, type: 0 }
];

packets1 = [
  // Send another command so that the second EOC isn't ignored
  { ccData: 0x1d20, type: 1 },
  // RCL, resume caption loading
  { ccData: 0x1d20, type: 1 },
  // 'test string #2'
  { ccData: characters('te'), type: 1 },
  { ccData: characters('st'), type: 1 },
  { ccData: characters(' s'), type: 1 },
  // 'test string #2' continued
  { ccData: characters('tr'), type: 1 },
  { ccData: characters('in'), type: 1 },
  { ccData: characters('g '), type: 1 },
  { ccData: characters('#2'), type: 1 },
  // EOC, End of Caption. End display
  { ccData: 0x1d2f, type: 1 },
  // EOC, End of Caption. Finished transmitting, begin display
  { ccData: 0x1d2f, type: 1 },
  // Send another command so that the second EOC isn't ignored
  { ccData: 0x1d20, type: 1 },
  // EOC, End of Caption. End display
  { ccData: 0x1d2f, type: 1 }
];

//
// version 0
//

version0Init =
  box('moov',
    box('trak',
      box('tkhd',
        0x00, // version 0
        0x00, 0x00, 0x00, // flags
        0x00, 0x00, 0x00, 0x00, // creation_time
        0x00, 0x00, 0x00, 0x00, // modification_time
        0x00, 0x00, 0x00, 0x01, // trackId
        0x00, 0x00, 0x00, 0x00, // reserved = 0
        0x00, 0x00, 0x00, 0x00, // duration
        0x00, 0x00, // layer
        0x00, 0x00, // alternate_group
        0x00, 0x00, // non-audio track volume
        0x00, 0x00, // reserved
        mp4Helpers.unityMatrix,
        0x01, 0x2c, 0x00, 0x00, // 300 in 16.16 fixed-point
        0x00, 0x96, 0x00, 0x00), // 150 in 16.16 fixed-point
      box('mdia',
        box('hdlr',
          0x00, // version 0
          0x00, 0x00, 0x00, // flags
          0x00, 0x00, 0x00, 0x00, // pre_defined = 0
          mp4Helpers.typeBytes('vide'), // handler_type
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, // reserved = 0
          mp4Helpers.typeBytes('version0')), // name,
        box('mdhd',
          0x00, // version 0
          0x00, 0x00, 0x00, // flags
          0x00, 0x00, 0x00, 0x00, // creation_time
          0x00, 0x00, 0x00, 0x00, // modification_time
          0x00, 0x01, 0x5f, 0x90, // timescale = 90000
          0x00, 0x00, 0x00, 0x00, // duration
          mp4Helpers.typeBytes('eng'), // language
          0x00, 0x00)))); // pre_defined = 0

version0Moof =
  box('moof',
    box('traf',
      box('tfhd',
        0x00, // version
        0x00, 0x00, 0x00, // flags
        0x00, 0x00, 0x00, 0x01, // track_ID
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, // base_data_offset
        0x00, 0x00, 0x00, 0x00, // sample_description_index
        0x00, 0x00, 0x00, 0x00, // default_sample_duration
        0x00, 0x00, 0x00, 0x00, // default_sample_size
        0x00, 0x00, 0x00, 0x00), // default_sample_flags
      box('tfdt',
        0x00, // version
        0x00, 0x00, 0x00, // flags
        0x00, 0x00, 0x00, 0x00), // baseMediaDecodeTime,
      box('trun',
        0x00, // version
        0x00, 0x0f, 0x01, // flags: dataOffsetPresent, sampleDurationPresent,
                          // sampleSizePresent, sampleFlagsPresent,
                          // sampleCompositionTimeOffsetsPresent
        0x00, 0x00, 0x00, 0x02, // sample_count
        0x00, 0x00, 0x00, 0x00, // data_offset, no first_sample_flags
        // sample 1
        0x00, 0x00, 0x00, 0x0a, // sample_duration = 10
        0x00, 0x00, 0x00, 0x0a, // sample_size = 10
        0x00, 0x00, 0x00, 0x00, // sample_flags
        0x00, 0x00, 0x00, 0x0a, // signed sample_composition_time_offset = 10
        // sample 2
        0x00, 0x00, 0x00, 0x0a, // sample_duration = 10
        0x00, 0x00, 0x00, 0x0a, // sample_size = 10
        0x00, 0x00, 0x00, 0x00, // sample_flags
        0x00, 0x00, 0x00, 0x14))); // signed sample_composition_time_offset = 20

version0Segment = version0Moof.concat(makeMdatFromCaptionPackets(packets0));

//
// version 1
//

version1Init =
  box('moov',
    box('trak',
      box('tkhd',
        0x01, // version 1
        0x00, 0x00, 0x00, // flags
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, // creation_time
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, // modification_time
        0x00, 0x00, 0x00, 0x02, // trackId
        0x00, 0x00, 0x00, 0x00, // reserved = 0
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, // duration
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
          0x00, 0x00, 0x00, 0x00, // pre_defined = 0
          mp4Helpers.typeBytes('vide'), // handler_type
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, // reserved = 0
          mp4Helpers.typeBytes('version1')), // name
        box('mdhd',
          0x01, // version 1
          0x00, 0x00, 0x00, // flags
          0x00, 0x00, 0x00, 0x00, // creation_time
          0x00, 0x00, 0x00, 0x00, // modification_time
          0x00, 0x01, 0x5f, 0x90, // timescale = 90000
          0x00, 0x00, 0x00, 0x00, // duration
          mp4Helpers.typeBytes('eng'), // language
          0x00, 0x00)))); // pre_defined = 0

version1Moof =
  box('moof',
    box('traf',
      box('tfhd',
        0x01, // version
        0x00, 0x00, 0x00, // flags
        0x00, 0x00, 0x00, 0x02, // track_ID
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, // base_data_offset
        0x00, 0x00, 0x00, 0x00, // sample_description_index
        0x00, 0x00, 0x00, 0x00, // default_sample_duration
        0x00, 0x00, 0x00, 0x00, // default_sample_size
        0x00, 0x00, 0x00, 0x00), // default_sample_flags,
      box('tfdt',
        0x01, // version
        0x00, 0x00, 0x00, // flags
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00), // baseMediaDecodeTime,
      box('trun',
        0x01, // version
        0x00, 0x0f, 0x01, // flags: dataOffsetPresent, sampleDurationPresent,
                          // sampleSizePresent, sampleFlagsPresent,
                          // sampleCompositionTimeOffsetsPresent
        0x00, 0x00, 0x00, 0x02, // sample_count
        0x00, 0x00, 0x00, 0x00, // data_offset, no first_sample_flags
        // sample 1
        0x00, 0x00, 0x00, 0x0a, // sample_duration = 10
        0x00, 0x00, 0x00, 0x0a, // sample_size = 10
        0x00, 0x00, 0x00, 0x00, // sample_flags
        0x00, 0x00, 0x00, 0x0a, // signed sample_composition_time_offset = 10
        // sample 2
        0x00, 0x00, 0x00, 0x0a, // sample_duration = 10
        0x00, 0x00, 0x00, 0x0a, // sample_size = 10
        0x00, 0x00, 0x00, 0x00, // sample_flags
        0x00, 0x00, 0x00, 0x14))); // signed sample_composition_time_offset = 20

version1Segment = version1Moof.concat(makeMdatFromCaptionPackets(packets1));
