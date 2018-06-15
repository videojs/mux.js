'use strict';

var captionsParser = require('../lib/mp4').captionsParser;

var dashInit = require('./utils/dash-608-708-captions-init-segment');
var dashSegment = require('./utils/dash-608-708-captions-segment');

var mp4Helpers = require('./utils/mp4-helpers');
var box = mp4Helpers.box;
var seiNalUnitGenerator = require('./utils/sei-nal-unit-generator');
var makeMdatFromCaptionPackets = seiNalUnitGenerator.makeMdatFromCaptionPackets;
var characters = seiNalUnitGenerator.characters;

var packets;
var version0TrackHeaderBox;
var version0MediaInformationBox;
var version0HandlerReferenceBox;
var version0Init;
var version0TrackFragementRunBox;
var version0TrackFragmentDecodeTime;
var version0TrackFragmentHeaderBox;
var version0Moof;
var version0Mdat;

var version1TrackHeaderBox;
var version1MediaInformationBox;
var version1Init;
var version1TrackFragementRunBox;
var version1TrackFragmentDecodeTime;
var version1TrackFragmentHeaderBox;
var version1Moof;

QUnit.module('MP4 Caption Parser');

QUnit.skip('parse captions from real segment', function() {
  var captions = captionsParser.parse(dashInit, dashSegment);

  QUnit.equal(captions.length, 1);
  QUnit.equal(captions[0].text, '00:05:00');
  QUnit.equal(captions[0].stream, 'CC1');
  // FIXME: these two fail at the moment
  // should have matched sample with pts 26967000
  QUnit.equal(captions[0].startTime, 300);
  QUnit.equal(captions[0].endTime, 360);
});

// TODO: wip
QUnit.skip('parseTrackId for version 0 and version 1 track header box', function() {
  var version0Captions =
    captionsParser.parse(
      new Uint8Array(version0Init),
      new Uint8Array(version0Moof.concat(version0Mdat)));

  var version1Captions =
    captionsParser.parse(
      new Uint8Array(version1Init),
      new Uint8Array(version1Moof.concat(version0Mdat)));

  QUnit.equal(version0Captions.length, 1);
  QUnit.equal(version1Captions.length, 1);
});

// ---------
// Test Data
// ---------

packets = [
  // Send another command so that the second EOC isn't ignored
  { pts: 10 * 1000, ccData: 0x1420, type: 0 },
  // RCL, resume caption loading
  { pts: 1000, ccData: 0x1420, type: 0 },
  // 'test string #1'
  { pts: 1000, ccData: characters('te'), type: 0 },
  { pts: 1000, ccData: characters('st'), type: 0 },
  { pts: 1000, ccData: characters(' s'), type: 0 },
  // 'test string #2'
  { pts: 10 * 1000, ccData: characters('te'), type: 0 },
  { pts: 10 * 1000, ccData: characters('st'), type: 0 },
  { pts: 10 * 1000, ccData: characters(' s'), type: 0 },
  // 'test string #1' continued
  { pts: 1000, ccData: characters('tr'), type: 0 },
  { pts: 1000, ccData: characters('in'), type: 0 },
  { pts: 1000, ccData: characters('g '), type: 0 },
  { pts: 1000, ccData: characters('#1'), type: 0 },
  // 'test string #2' continued
  { pts: 10 * 1000, ccData: characters('tr'), type: 0 },
  { pts: 10 * 1000, ccData: characters('in'), type: 0 },
  { pts: 10 * 1000, ccData: characters('g '), type: 0 },
  { pts: 10 * 1000, ccData: characters('#2'), type: 0 },
  // EOC, End of Caption. End display
  { pts: 10 * 1000, ccData: 0x142f, type: 0 },
  // EOC, End of Caption. Finished transmitting, begin display
  { pts: 1000, ccData: 0x142f, type: 0 },
  // Send another command so that the second EOC isn't ignored
  { pts: 20 * 1000, ccData: 0x1420, type: 0 },
  // EOC, End of Caption. End display
  { pts: 20 * 1000, ccData: 0x142f, type: 0 }
];

// version 0

version0TrackHeaderBox =
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
    0x00, 0x96, 0x00, 0x00); // 150 in 16.16 fixed-point

version0HandlerReferenceBox =
  box('hdlr',
    0x00, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00, // pre_defined = 0
    mp4Helpers.typeBytes('vide'), // handler_type
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // reserved = 0
    mp4Helpers.typeBytes('version0')); // name

version0MediaInformationBox =
  box('mdia', version0HandlerReferenceBox);

version0Init =
  box('moov',
    box('trak',
      version0TrackHeaderBox,
      version0MediaInformationBox));

version0TrackFragmentHeaderBox =
  box('tfhd',
    0x00, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x01, // track_ID
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // base_data_offset
    0x00, 0x00, 0x00, 0x00, // sample_description_index
    0x00, 0x00, 0x00, 0x00, // default_sample_duration
    0x00, 0x00, 0x00, 0x00, // default_sample_size
    0x00, 0x00, 0x00, 0x00); // default_sample_flags

version0TrackFragmentDecodeTime =
  box('tfdt',
    0x00, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00); // baseMediaDecodeTime

version0TrackFragementRunBox =
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
    0x00, 0x00, 0x00, 0x14); // signed sample_composition_time_offset = 20

version0Moof =
  box('moof',
    box('traf',
      version0TrackFragmentHeaderBox,
      version0TrackFragmentDecodeTime,
      version0TrackFragementRunBox));

version0Mdat = makeMdatFromCaptionPackets(packets);

// version 1

version1TrackHeaderBox =
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
    0x00, 0x96, 0x00, 0x00); // 150 in 16.16 fixed-point

version1MediaInformationBox =
  box('mdia', version0HandlerReferenceBox);

version1Init =
  box('moov',
    box('trak',
      version1TrackHeaderBox,
      version1MediaInformationBox));

version1TrackFragmentHeaderBox =
  box('tfhd',
    0x01, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x02, // track_ID
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // base_data_offset
    0x00, 0x00, 0x00, 0x00, // sample_description_index
    0x00, 0x00, 0x00, 0x00, // default_sample_duration
    0x00, 0x00, 0x00, 0x00, // default_sample_size
    0x00, 0x00, 0x00, 0x00); // default_sample_flags

version1TrackFragmentDecodeTime =
  box('tfdt',
    0x01, // version
    0x00, 0x00, 0x00, // flags
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00); // baseMediaDecodeTime

version1TrackFragementRunBox =
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
    0x00, 0x00, 0x00, 0x14); // signed sample_composition_time_offset = 20

version1Moof =
  box('moof',
    box('traf',
      version1TrackFragmentHeaderBox,
      version1TrackFragmentDecodeTime,
      version1TrackFragementRunBox));
