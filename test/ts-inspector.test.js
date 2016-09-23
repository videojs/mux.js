'use strict';

var
  QUnit = require('qunit'),
  inspect = require('../lib/tools/ts-inspector.js').inspect,
  tsSegment = require('./utils/test-segment.js'),
  tsNoAudioSegment = require('./utils/test-no-audio-segment.js'),
  aacSegment = require('./utils/test-aac-segment.js'),
  PES_TIMESCALE = 90000;

QUnit.module('TS Inspector');

QUnit.test('returns null for empty segment input', function() {
  QUnit.equal(inspect(new Uint8Array([])), null, 'returned null');
});

QUnit.test('can parse a ts segment', function() {
  var expected = {
    video: [
      {
        type: 'video',
        pts: 126000,
        dts: 126000,
        ptsTime: 126000 / PES_TIMESCALE,
        dtsTime: 126000 / PES_TIMESCALE
      },
      {
        type: 'video',
        pts: 924000,
        dts: 924000,
        ptsTime: 924000 / PES_TIMESCALE,
        dtsTime: 924000 / PES_TIMESCALE
      }
    ],
    firstKeyFrame: {
      type: 'video',
      pts: 126000,
      dts: 126000,
      ptsTime: 126000 / PES_TIMESCALE,
      dtsTime: 126000 / PES_TIMESCALE
    },
    audio: [
      {
        type: 'audio',
        pts: 126000,
        dts: 126000,
        ptsTime: 126000 / PES_TIMESCALE,
        dtsTime: 126000 / PES_TIMESCALE
      },
      {
        type: 'audio',
        pts: 859518,
        dts: 859518,
        ptsTime: 859518 / PES_TIMESCALE,
        dtsTime: 859518 / PES_TIMESCALE
      }
    ]
  };

  QUnit.deepEqual(inspect(tsSegment), expected, 'parses ts segment timing data');
});

QUnit.test('adjusts timestamp values based on provided reference', function() {
  var rollover = Math.pow(2, 33);

  var expected = {
    video: [
      {
        type: 'video',
        pts: (126000 + rollover),
        dts: (126000 + rollover),
        ptsTime: (126000 + rollover) / PES_TIMESCALE,
        dtsTime: (126000 + rollover) / PES_TIMESCALE
      },
      {
        type: 'video',
        pts: (924000 + rollover),
        dts: (924000 + rollover),
        ptsTime: (924000 + rollover) / PES_TIMESCALE,
        dtsTime: (924000 + rollover) / PES_TIMESCALE
      }
    ],
    firstKeyFrame: {
      type: 'video',
      pts: (126000 + rollover),
      dts: (126000 + rollover),
      ptsTime: (126000 + rollover) / PES_TIMESCALE,
      dtsTime: (126000 + rollover) / PES_TIMESCALE
    },
    audio: [
      {
        type: 'audio',
        pts: (126000 + rollover),
        dts: (126000 + rollover),
        ptsTime: (126000 + rollover) / PES_TIMESCALE,
        dtsTime: (126000 + rollover) / PES_TIMESCALE
      },
      {
        type: 'audio',
        pts: (859518 + rollover),
        dts: (859518 + rollover),
        ptsTime: (859518 + rollover) / PES_TIMESCALE,
        dtsTime: (859518 + rollover) / PES_TIMESCALE
      }
    ]
  };

  QUnit.deepEqual(inspect(tsSegment, rollover - 1), expected,
    'adjusts inspected time data to account for pts rollover');
});

QUnit.test('can parse an aac segment', function() {
  var expected = {
    audio: [
      {
        type: 'audio',
        pts: 895690,
        dts: 895690,
        ptsTime: 895690 / PES_TIMESCALE,
        dtsTime: 895690 / PES_TIMESCALE
      },
      {
        type: 'audio',
        pts: (895690 + (430 * 1024 * PES_TIMESCALE / 44100)),
        dts: (895690 + (430 * 1024 * PES_TIMESCALE / 44100)),
        ptsTime: (895690 + (430 * 1024 * PES_TIMESCALE / 44100)) / PES_TIMESCALE,
        dtsTime: (895690 + (430 * 1024 * PES_TIMESCALE / 44100)) / PES_TIMESCALE
      }
    ]
  };

  QUnit.deepEqual(inspect(aacSegment), expected, 'parses aac segment timing data');
});

QUnit.test('can parse ts segment with no audio muxed in', function() {
  var expected = {
    video: [
      {
        type: 'video',
        pts: 126000,
        dts: 126000,
        ptsTime: 126000 / PES_TIMESCALE,
        dtsTime: 126000 / PES_TIMESCALE
      },
      {
        type: 'video',
        pts: 924000,
        dts: 924000,
        ptsTime: 924000 / PES_TIMESCALE,
        dtsTime: 924000 / PES_TIMESCALE
      }
    ],
    firstKeyFrame: {
      type: 'video',
      pts: 126000,
      dts: 126000,
      ptsTime: 126000 / PES_TIMESCALE,
      dtsTime: 126000 / PES_TIMESCALE
    }
  };

  var actual = inspect(tsNoAudioSegment);

  QUnit.equal(typeof actual.audio, 'undefined', 'results do not contain audio info');
  QUnit.deepEqual(actual, expected,
    'parses ts segment without audio timing data');
});

