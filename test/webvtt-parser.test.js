var segments = require('data-files!segments');
var vttContentSegment = segments['test-webvtt.m4s']();
var vttInitSegment = segments['test-webvtt-init.mp4']();
var WebVttParser = require('../lib/mp4').WebVttParser;
var window = require('global/window');
var webVttParser;

QUnit.module('MP4 WebVtt Segment Parser', {
  beforeEach: function() {
    webVttParser = new WebVttParser();
  }
});

QUnit.test('parse webvtt init and content segments', function(assert) {
  // Init segment sets the timescale.
  webVttParser.init(vttInitSegment);
  assert.ok(webVttParser, 'WebVtt parser created');
  // we need a TextDecoder to test the WebVTT segment parser.
  if (window.TextDecoder) {
    const parsedWebVttCues = webVttParser.parseSegment(vttContentSegment);
    const expectedCueValues = [
      {
        cueText: "2024-09-19T20:13:06Z\nen # 863388393",
        start: 1726776786,
        end: 1726776786.9,
        settings: undefined
      },
      {
        cueText: "2024-09-19T20:13:07Z\nen # 863388393",
        start: 1726776787,
        end: 1726776787.9,
        settings: undefined
      }
    ];
    assert.ok(parsedWebVttCues, 'parsed WebVtt Cues are created');
    assert.equal(parsedWebVttCues.length, 2, '2 WebVtt Cues are created');
    assert.deepEqual(parsedWebVttCues, expectedCueValues, 'WebVtt cues are expected values');
  }
});
