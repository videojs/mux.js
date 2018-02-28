'use strict';

var
  QUnit = require('qunit'),
  tsInspector = require('../lib/tools/ts-inspector.js'),
  StreamTypes = require('../lib/m2ts/stream-types.js'),
  tsSegment = require('./utils/test-segment.js'),
  tsNoAudioSegment = require('./utils/test-no-audio-segment.js'),
  aacSegment = require('./utils/test-aac-segment.js'),
  inspect = tsInspector.inspect,
  PES_TIMESCALE = 90000,
  MP2T_PACKET_LENGTH = 188, // bytes
  SYNC_BYTE = 0x47;

QUnit.module('TS Inspector');

QUnit.test('returns null for empty segment input', function() {
  QUnit.equal(inspect(new Uint8Array([])), null, 'returned null');
});

QUnit.test('can parse a ts segment', function() {
  var sampleCount = 1024;
  var sampleRate = 44100;
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
        dtsTime: 126000 / PES_TIMESCALE,
        frameDuration: sampleCount * PES_TIMESCALE / sampleRate,
        frameDurationTime: sampleCount / sampleRate
      },
      {
        type: 'audio',
        pts: 859518,
        dts: 859518,
        ptsTime: 859518 / PES_TIMESCALE,
        dtsTime: 859518 / PES_TIMESCALE,
        frameDuration: sampleCount * PES_TIMESCALE / sampleRate,
        frameDurationTime: sampleCount / sampleRate
      }
    ]
  };

  QUnit.deepEqual(inspect(tsSegment), expected, 'parses ts segment timing data');
});

QUnit.test('adjusts timestamp values based on provided reference', function() {
  var rollover = Math.pow(2, 33);
  var sampleCount = 1024;
  var sampleRate = 44100;
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
        dtsTime: (126000 + rollover) / PES_TIMESCALE,
        frameDuration: sampleCount * PES_TIMESCALE / sampleRate,
        frameDurationTime: sampleCount / sampleRate
      },
      {
        type: 'audio',
        pts: (859518 + rollover),
        dts: (859518 + rollover),
        ptsTime: (859518 + rollover) / PES_TIMESCALE,
        dtsTime: (859518 + rollover) / PES_TIMESCALE,
        frameDuration: sampleCount * PES_TIMESCALE / sampleRate,
        frameDurationTime: sampleCount / sampleRate
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
        dtsTime: 895690 / PES_TIMESCALE,
        frameDuration: 1024 * PES_TIMESCALE / 44100
      },
      {
        type: 'audio',
        pts: (895690 + (430 * 1024 * PES_TIMESCALE / 44100)),
        dts: (895690 + (430 * 1024 * PES_TIMESCALE / 44100)),
        ptsTime: (895690 + (430 * 1024 * PES_TIMESCALE / 44100)) / PES_TIMESCALE,
        dtsTime: (895690 + (430 * 1024 * PES_TIMESCALE / 44100)) / PES_TIMESCALE,
        frameDuration: 1024 * PES_TIMESCALE / 44100
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

QUnit.test('can get next PES packet', function() {
  // 4 byte minimum TS header
  var tsHeader = [SYNC_BYTE, 65, 1, 18];
  // packet prefix start code is 0x000001, followed by header info
  var pesHeader = [0, 0, 1, 192, 14, 90, 132, 128, 5, 33, 1, 19, 8, 59];
  // start the ADTS header, but don't finish it
  var adtsHeaderStart = [255, 241, 92, 128, 29];
  // finish the ADTS header (7 bytes total for the header here since no CRC)
  var adtsHeaderEnd = [255, 252];
  var numJunkBytes =
    MP2T_PACKET_LENGTH - tsHeader.length - pesHeader.length - adtsHeaderStart.length;
  var numAacBytes =
    MP2T_PACKET_LENGTH - tsHeader.length - pesHeader.length - adtsHeaderEnd.length;
  var junkBytes = Array.apply(null, new Array(numJunkBytes)).map(function() {
    return 5;
  });
  var aacBytes = Array.apply(null, new Array(numAacBytes)).map(function() {
    return 5;
  });
  // start with the end of an old packet (junk/offset bytes)
  var offsetBytes = [1, 2, 3];
  var bytes = new Uint8Array(
    offsetBytes
      .concat(tsHeader)
      .concat(pesHeader)
      .concat(junkBytes)
      .concat(adtsHeaderStart)
      .concat(tsHeader)
      .concat(pesHeader)
      .concat(adtsHeaderEnd)
      .concat(aacBytes)
      .concat([SYNC_BYTE]));
  var pmt = {
    pid: 256,
    table: {
      257: StreamTypes.ADTS_STREAM_TYPE
    }
  };
  var firstStartIndex = offsetBytes.length;
  var firstEndIndex = offsetBytes.length + MP2T_PACKET_LENGTH;
  var firstPacket = bytes.subarray(firstStartIndex, firstEndIndex);
  var secondStartIndex = firstStartIndex + MP2T_PACKET_LENGTH;
  var secondEndIndex = secondStartIndex + MP2T_PACKET_LENGTH;
  var secondPacket = bytes.subarray(secondStartIndex, secondEndIndex);

  QUnit.deepEqual(
    tsInspector.nextPesPacket_(bytes, pmt, offsetBytes.length, 'audio'),
    {
      packet: firstPacket,
      startIndex: firstStartIndex,
      endIndex: firstEndIndex
    },
    'gets first PES packet');

  QUnit.deepEqual(
    tsInspector.nextPesPacket_(bytes, pmt, 0, 'audio'),
    {
      packet: firstPacket,
      startIndex: firstStartIndex,
      endIndex: firstEndIndex
    },
    'gets first PES packet without offset specification');

  QUnit.deepEqual(
    tsInspector.nextPesPacket_(bytes, pmt, secondStartIndex, 'audio'),
    {
      packet: secondPacket,
      startIndex: secondStartIndex,
      endIndex: secondEndIndex
    },
    'gets second PES packet');

  QUnit.deepEqual(
    tsInspector.nextPesPacket_(
      bytes, pmt, secondStartIndex - offsetBytes.length, 'audio'),
    {
      packet: secondPacket,
      startIndex: secondStartIndex,
      endIndex: secondEndIndex
    },
    'gets second PES packet');
});

QUnit.test('can get next PES packet when separated by different type', function() {
  // 4 byte minimum TS header
  var tsHeader = [SYNC_BYTE, 65, 1, 18];
  var videoTsHeader = [SYNC_BYTE, 64, 1, 18];
  // packet prefix start code is 0x000001, followed by header info
  var pesHeader = [0, 0, 1, 192, 14, 90, 132, 128, 5, 33, 1, 19, 8, 59];
  // start the ADTS header, but don't finish it
  var adtsHeaderStart = [255, 241, 92, 128, 29];
  // finish the ADTS header (7 bytes total for the header here since no CRC)
  var adtsHeaderEnd = [255, 252];
  var numJunkBytes =
    MP2T_PACKET_LENGTH - tsHeader.length - pesHeader.length - adtsHeaderStart.length;
  var numAacBytes =
    MP2T_PACKET_LENGTH - tsHeader.length - pesHeader.length - adtsHeaderEnd.length;
  var numVideoBytes = MP2T_PACKET_LENGTH - videoTsHeader.length - pesHeader.length;
  var junkBytes = Array.apply(null, new Array(numJunkBytes)).map(function() {
    return 5;
  });
  var aacBytes = Array.apply(null, new Array(numAacBytes)).map(function() {
    return 5;
  });
  var videoBytes = Array.apply(null, new Array(numVideoBytes)).map(function() {
    return 5;
  });
  // start with the end of an old packet (junk/offset bytes)
  var offsetBytes = [1, 2, 3];
  var bytes = new Uint8Array(
    offsetBytes
      .concat(tsHeader)
      .concat(pesHeader)
      .concat(junkBytes)
      .concat(adtsHeaderStart)
      .concat(videoTsHeader)
      .concat(pesHeader)
      .concat(videoBytes)
      .concat(tsHeader)
      .concat(pesHeader)
      .concat(adtsHeaderEnd)
      .concat(aacBytes)
      .concat([SYNC_BYTE]));
  var pmt = {
    pid: 256,
    table: {
      257: StreamTypes.ADTS_STREAM_TYPE
    }
  };
  var firstEndIndex = offsetBytes.length + MP2T_PACKET_LENGTH;
  // skip over the video packet in the middle
  var secondStartIndex = firstEndIndex + MP2T_PACKET_LENGTH;
  var secondEndIndex = secondStartIndex + MP2T_PACKET_LENGTH;
  var secondPacket = bytes.subarray(secondStartIndex, secondEndIndex);

  QUnit.deepEqual(
    tsInspector.nextPesPacket_(bytes, pmt, firstEndIndex, 'audio'),
    {
      packet: secondPacket,
      startIndex: secondStartIndex,
      endIndex: secondEndIndex
    },
    'gets next PES packet');
});

QUnit.test('can parse frame duration from a stream of TS packet bytes', function() {
  // start with the end of an old packet (junk/offset bytes)
  var offsetBytes = [3, 100, 5, 100];
  // 4 byte minimum TS header
  var tsHeader = [SYNC_BYTE, 65, 1, 18];
  // packet prefix start code is 0x000001, followed by header info
  var pesHeader = [0, 0, 1, 192, 14, 90, 132, 128, 5, 33, 1, 19, 8, 59];
  var adtsHeader = [255, 241, 92, 128, 29, 255, 252];
  var aacData = [33, 121];
  var tsBytes = new Uint8Array(
    offsetBytes.concat(tsHeader).concat(pesHeader).concat(adtsHeader).concat(aacData));
  // technically the packet isn't a full 188 bytes, but should be a good test with that
  // extra detail
  var packet = tsBytes.subarray(offsetBytes.length);
  var pmt = {
    pid: 256,
    table: {
      257: StreamTypes.ADTS_STREAM_TYPE
    }
  };

  var frameDuration = tsInspector.parseFrameDuration_(
    tsBytes, pmt, packet, offsetBytes.length, tsBytes.length);

  QUnit.equal(frameDuration, 1024 * 90000 / 22050, 'parsed frame duration');
});

QUnit.test('can parse frame duration from ADTS header split across separate TS packets',
function() {
  // 4 byte minimum TS header
  var tsHeader = [SYNC_BYTE, 65, 1, 18];
  // packet prefix start code is 0x000001, followed by header info
  var pesHeader = [0, 0, 1, 192, 14, 90, 132, 128, 5, 33, 1, 19, 8, 59];
  // start the ADTS header, but don't finish it
  var adtsHeaderStart = [255, 241, 92, 128, 29];
  // finish the ADTS header (7 bytes total for the header here since no CRC)
  var adtsHeaderEnd = [255, 252];
  var numJunkBytes =
    MP2T_PACKET_LENGTH - tsHeader.length - pesHeader.length - adtsHeaderStart.length;
  var numAacBytes =
    MP2T_PACKET_LENGTH - tsHeader.length - pesHeader.length - adtsHeaderEnd.length;
  var junkBytes = Array.apply(null, new Array(numJunkBytes)).map(function() {
    return 5;
  });
  var aacBytes = Array.apply(null, new Array(numAacBytes)).map(function() {
    return 5;
  });
  // start with the end of an old packet (junk/offset bytes)
  var offsetBytes = [1, 2, 3];
  var tsBytes = new Uint8Array(
    offsetBytes
      .concat(tsHeader)
      .concat(pesHeader)
      .concat(junkBytes)
      .concat(adtsHeaderStart)
      .concat(tsHeader)
      .concat(pesHeader)
      .concat(adtsHeaderEnd)
      .concat(aacBytes)
      .concat([SYNC_BYTE]));
  var packet =
    tsBytes.subarray(offsetBytes.length, offsetBytes.length + MP2T_PACKET_LENGTH);
  var pmt = {
    pid: 256,
    table: {
      257: StreamTypes.ADTS_STREAM_TYPE
    }
  };

  var frameDuration = tsInspector.parseFrameDuration_(
    tsBytes,
    pmt,
    packet,
    offsetBytes.length,
    offsetBytes.length + MP2T_PACKET_LENGTH);

  QUnit.equal(frameDuration,
              1024 * 90000 / 22050,
              'parsed frame duration across TS packets');
});

QUnit.test('can parse frame duration from ADTS header when not in first TS packet',
function() {
  // 4 byte minimum TS header
  var tsHeader = [SYNC_BYTE, 65, 1, 18];
  // packet prefix start code is 0x000001, followed by header info
  var pesHeader = [0, 0, 1, 192, 14, 90, 132, 128, 5, 33, 1, 19, 8, 59];
  // 7 bytes total for the header here since no CRC
  var adtsHeader = [255, 241, 92, 128, 29, 255, 252];
  var numJunkBytes = MP2T_PACKET_LENGTH - tsHeader.length - pesHeader.length;
  var numAacBytes =
    MP2T_PACKET_LENGTH - tsHeader.length - pesHeader.length - adtsHeader.length;
  var junkBytes = Array.apply(null, new Array(numJunkBytes)).map(function() {
    return 5;
  });
  var aacBytes = Array.apply(null, new Array(numAacBytes)).map(function() {
    return 5;
  });
  // start with the end of an old packet (junk/offset bytes)
  var offsetBytes = [1, 2, 3];
  var tsBytes = new Uint8Array(
    offsetBytes
      .concat(tsHeader)
      .concat(pesHeader)
      .concat(junkBytes)
      .concat(tsHeader)
      .concat(pesHeader)
      .concat(adtsHeader)
      .concat(aacBytes)
      .concat([SYNC_BYTE]));
  var packet =
    tsBytes.subarray(offsetBytes.length, offsetBytes.length + MP2T_PACKET_LENGTH);
  var pmt = {
    pid: 256,
    table: {
      257: StreamTypes.ADTS_STREAM_TYPE
    }
  };

  var frameDuration = tsInspector.parseFrameDuration_(
    tsBytes,
    pmt,
    packet,
    offsetBytes.length,
    offsetBytes.length + MP2T_PACKET_LENGTH);

  QUnit.equal(frameDuration,
              1024 * 90000 / 22050,
              'parsed frame duration when not in initial packet');
});
