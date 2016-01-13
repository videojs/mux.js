'use strict';
/*
  ======== A Handy Little QUnit Reference ========
  http://api.qunitjs.com/

  Test methods:
  module(name, {[setup][ ,teardown]})
  QUnit.test(name, callback)
  expect(numberOfAssertions)
  stop(increment)
  start(decrement)
  Test assertions:
  QUnit.ok(value, [message])
  QUnit.equal(actual, expected, [message])
  notEqual(actual, expected, [message])
  QUnit.deepEqual(actual, expected, [message])
  notDeepEqual(actual, expected, [message])
  QUnit.strictEqual(actual, expected, [message])
  notStrictEqual(actual, expected, [message])
  throws(block, [expected], [message])
*/
var
  mp4 = require('../lib/mp4'),
  QUnit = require('qunit'),
  validateMvhd, validateTrak, validateTkhd, validateMdia,
  validateMdhd, validateHdlr, validateMinf, validateDinf,
  validateStbl, validateStsd, validateMvex,
  validateVideoSample, validateAudioSample;

QUnit.module('MP4 Generator');

QUnit.test('generates a BSMFF ftyp', function() {
  var data = mp4.generator.ftyp(), boxes;

  QUnit.ok(data, 'box is not null');

  boxes = mp4.tools.inspect(data);
  QUnit.equal(1, boxes.length, 'generated a single box');
  QUnit.equal(boxes[0].type, 'ftyp', 'generated ftyp type');
  QUnit.equal(boxes[0].size, data.byteLength, 'generated size');
  QUnit.equal(boxes[0].majorBrand, 'isom', 'major version is "isom"');
  QUnit.equal(boxes[0].minorVersion, 1, 'minor version is one');
});

validateMvhd = function(mvhd) {
  QUnit.equal(mvhd.type, 'mvhd', 'generated a mvhd');
  QUnit.equal(mvhd.duration, 0xffffffff, 'wrote the maximum movie header duration');
  QUnit.equal(mvhd.nextTrackId, 0xffffffff, 'wrote the max next track id');
};

validateTrak = function(trak, expected) {
  expected = expected || {};
  QUnit.equal(trak.type, 'trak', 'generated a trak');
  QUnit.equal(trak.boxes.length, 2, 'generated two track sub boxes');

  validateTkhd(trak.boxes[0], expected);
  validateMdia(trak.boxes[1], expected);
};

validateTkhd = function(tkhd, expected) {
  QUnit.equal(tkhd.type, 'tkhd', 'generated a tkhd');
  QUnit.equal(tkhd.trackId, 7, 'wrote the track id');
  QUnit.deepEqual(tkhd.flags, new Uint8Array([0, 0, 7]), 'flags should QUnit.equal 7');
  QUnit.equal(tkhd.duration,
        expected.duration || Math.pow(2, 32) - 1,
        'wrote duration into the track header');
  QUnit.equal(tkhd.width, expected.width || 0, 'wrote width into the track header');
  QUnit.equal(tkhd.height, expected.height || 0, 'wrote height into the track header');
  QUnit.equal(tkhd.volume, 1, 'set volume to 1');
};

validateMdia = function(mdia, expected) {
  QUnit.equal(mdia.type, 'mdia', 'generated an mdia type');
  QUnit.equal(mdia.boxes.length, 3, 'generated three track media sub boxes');

  validateMdhd(mdia.boxes[0], expected);
  validateHdlr(mdia.boxes[1], expected);
  validateMinf(mdia.boxes[2], expected);
};

validateMdhd = function(mdhd, expected) {
  QUnit.equal(mdhd.type, 'mdhd', 'generate an mdhd type');
  QUnit.equal(mdhd.language, 'und', 'wrote undetermined language');
  QUnit.equal(mdhd.timescale, expected.timescale || 90000, 'wrote the timescale');
  QUnit.equal(mdhd.duration,
        expected.duration || Math.pow(2, 32) - 1,
        'wrote duration into the media header');
};

validateHdlr = function(hdlr, expected) {
  QUnit.equal(hdlr.type, 'hdlr', 'generate an hdlr type');
  if (expected.type !== 'audio') {
    QUnit.equal(hdlr.handlerType, 'vide', 'wrote a video handler');
    QUnit.equal(hdlr.name, 'VideoHandler', 'wrote the handler name');
  } else {
    QUnit.equal(hdlr.handlerType, 'soun', 'wrote a sound handler');
    QUnit.equal(hdlr.name, 'SoundHandler', 'wrote the sound handler name');
  }
};

validateMinf = function(minf, expected) {
  QUnit.equal(minf.type, 'minf', 'generate an minf type');
  QUnit.equal(minf.boxes.length, 3, 'generates three minf sub boxes');

  if (expected.type !== 'audio') {
    QUnit.deepEqual({
      type: 'vmhd',
      size: 20,
      version: 0,
      flags: new Uint8Array([0, 0, 1]),
      graphicsmode: 0,
      opcolor: new Uint16Array([0, 0, 0])
    }, minf.boxes[0], 'generates a vhmd');
  } else {
    QUnit.deepEqual({
      type: 'smhd',
      size: 16,
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      balance: 0
    }, minf.boxes[0], 'generates an smhd');
  }

  validateDinf(minf.boxes[1]);
  validateStbl(minf.boxes[2], expected);
};

validateDinf = function(dinf) {
  QUnit.deepEqual({
    type: 'dinf',
    size: 36,
    boxes: [{
      type: 'dref',
      size: 28,
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      dataReferences: [{
        type: 'url ',
        size: 12,
        version: 0,
        flags: new Uint8Array([0, 0, 1])
      }]
    }]
  }, dinf, 'generates a dinf');
};

validateStbl = function(stbl, expected) {
  QUnit.equal(stbl.type, 'stbl', 'generates an stbl type');
  QUnit.equal(stbl.boxes.length, 5, 'generated five stbl child boxes');

  validateStsd(stbl.boxes[0], expected);
  QUnit.deepEqual({
    type: 'stts',
    size: 16,
    version: 0,
    flags: new Uint8Array([0, 0, 0]),
    timeToSamples: []
  }, stbl.boxes[1], 'generated an stts');
  QUnit.deepEqual({
    type: 'stsc',
    size: 16,
    version: 0,
    flags: new Uint8Array([0, 0, 0]),
    sampleToChunks: []
  }, stbl.boxes[2], 'generated an stsc');
  QUnit.deepEqual({
    type: 'stsz',
    version: 0,
    size: 20,
    flags: new Uint8Array([0, 0, 0]),
    sampleSize: 0,
    entries: []
  }, stbl.boxes[3], 'generated an stsz');
  QUnit.deepEqual({
    type: 'stco',
    size: 16,
    version: 0,
    flags: new Uint8Array([0, 0, 0]),
    chunkOffsets: []
  }, stbl.boxes[4], 'generated and stco');
};

validateStsd = function(stsd, expected) {
  QUnit.equal(stsd.type, 'stsd', 'generated an stsd');
  QUnit.equal(stsd.sampleDescriptions.length, 1, 'generated one sample');
  if (expected.type !== 'audio') {
    validateVideoSample(stsd.sampleDescriptions[0]);
  } else {
    validateAudioSample(stsd.sampleDescriptions[0]);
  }
};

validateVideoSample = function(sample) {
  QUnit.deepEqual(sample, {
    type: 'avc1',
    size: 136,
    dataReferenceIndex: 1,
    width: 600,
    height: 300,
    horizresolution: 72,
    vertresolution: 72,
    frameCount: 1,
    depth: 24,
    config: [{
      type: 'avcC',
      size: 30,
      configurationVersion: 1,
      avcProfileIndication: 3,
      avcLevelIndication: 5,
      profileCompatibility: 7,
      lengthSizeMinusOne: 3,
      sps: [new Uint8Array([
        0, 1, 2
      ]), new Uint8Array([
        3, 4, 5
      ])],
      pps: [new Uint8Array([
        6, 7, 8
      ])]
    }, {
      type: 'btrt',
      size: 20,
      bufferSizeDB: 1875072,
      maxBitrate: 3000000,
      avgBitrate: 3000000
    }]
  }, 'generated a video sample');
};

validateAudioSample = function(sample) {
  QUnit.deepEqual(sample, {
    type: 'mp4a',
    size: 75,
    dataReferenceIndex: 1,
    channelcount: 2,
    samplesize: 16,
    samplerate: 48000,
    streamDescriptor: {
      type: 'esds',
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      size: 39,
      esId: 0,
      streamPriority: 0,
      // these values were hard-coded based on a working audio init segment
      decoderConfig: {
        avgBitrate: 56000,
        maxBitrate: 56000,
        bufferSize: 1536,
        objectProfileIndication: 64,
        streamType: 5,
        decoderConfigDescriptor: {
          audioObjectType: 2,
          channelConfiguration: 2,
          length: 2,
          samplingFrequencyIndex: 3,
          tag: 5
        },
      }
    }
  }, 'generated an audio sample');
};

validateMvex = function(mvex, options) {
  options = options || {
    sampleDegradationPriority: 1
  };
  QUnit.deepEqual({
    type: 'mvex',
    size: 40,
    boxes: [{
      type: 'trex',
      size: 32,
      version: 0,
      flags: new Uint8Array([0, 0, 0]),
      trackId: 7,
      defaultSampleDescriptionIndex: 1,
      defaultSampleDuration: 0,
      defaultSampleSize: 0,
      sampleDependsOn: 0,
      sampleIsDependedOn: 0,
      sampleHasRedundancy: 0,
      samplePaddingValue: 0,
      sampleIsDifferenceSample: true,
      sampleDegradationPriority: options.sampleDegradationPriority
    }]
  }, mvex, 'writes a movie extends box');
};

QUnit.test('generates a video moov', function() {
  var
    boxes,
    data = mp4.generator.moov([{
      id: 7,
      duration: 100,
      width: 600,
      height: 300,
      type: 'video',
      profileIdc: 3,
      levelIdc: 5,
      profileCompatibility: 7,
      sps: [new Uint8Array([0, 1, 2]), new Uint8Array([3, 4, 5])],
      pps: [new Uint8Array([6, 7, 8])]
    }]);

  QUnit.ok(data, 'box is not null');
  boxes = mp4.tools.inspect(data);
  QUnit.equal(boxes.length, 1, 'generated a single box');
  QUnit.equal(boxes[0].type, 'moov', 'generated a moov type');
  QUnit.equal(boxes[0].size, data.byteLength, 'generated size');
  QUnit.equal(boxes[0].boxes.length, 3, 'generated three sub boxes');

  validateMvhd(boxes[0].boxes[0]);
  validateTrak(boxes[0].boxes[1], {
    duration: 100,
    width: 600,
    height: 300
  });
  validateMvex(boxes[0].boxes[2]);
});

QUnit.test('generates an audio moov', function() {
  var
    data = mp4.generator.moov([{
      id: 7,
      type: 'audio',
      audioobjecttype: 2,
      channelcount: 2,
      samplerate: 48000,
      samplingfrequencyindex: 3,
      samplesize: 16
    }]),
    boxes;

  QUnit.ok(data, 'box is not null');
  boxes = mp4.tools.inspect(data);
  QUnit.equal(boxes.length, 1, 'generated a single box');
  QUnit.equal(boxes[0].type, 'moov', 'generated a moov type');
  QUnit.equal(boxes[0].size, data.byteLength, 'generated size');
  QUnit.equal(boxes[0].boxes.length, 3, 'generated three sub boxes');

  validateMvhd(boxes[0].boxes[0]);
  validateTrak(boxes[0].boxes[1], {
    type: 'audio',
    timescale: 48000
  });
  validateMvex(boxes[0].boxes[2], {
    sampleDegradationPriority: 0
  });
});

QUnit.test('generates a sound hdlr', function() {
  var boxes, hdlr,
    data = mp4.generator.moov([{
      duration:100,
      type: 'audio'
    }]);

  QUnit.ok(data, 'box is not null');

  boxes = mp4.tools.inspect(data);

  hdlr = boxes[0].boxes[1].boxes[1].boxes[1];
  QUnit.equal(hdlr.type, 'hdlr', 'generate an hdlr type');
  QUnit.equal(hdlr.handlerType, 'soun', 'wrote a sound handler');
  QUnit.equal(hdlr.name, 'SoundHandler', 'wrote the handler name');
});

QUnit.test('generates a video hdlr', function() {
  var boxes, hdlr,
    data = mp4.generator.moov([{
      duration: 100,
      width: 600,
      height: 300,
      type: 'video',
      sps: [],
      pps: []
    }]);

  QUnit.ok(data, 'box is not null');

  boxes = mp4.tools.inspect(data);

  hdlr = boxes[0].boxes[1].boxes[1].boxes[1];
  QUnit.equal(hdlr.type, 'hdlr', 'generate an hdlr type');
  QUnit.equal(hdlr.handlerType, 'vide', 'wrote a video handler');
  QUnit.equal(hdlr.name, 'VideoHandler', 'wrote the handler name');
});

QUnit.test('generates an initialization segment', function() {
  var
    data = mp4.generator.initSegment([{
      id: 1,
      width: 600,
      height: 300,
      type: 'video',
      sps: [new Uint8Array([0])],
      pps: [new Uint8Array([1])]
    }, {
      id: 2,
      type: 'audio'
    }]),
    init, mvhd, trak1, trak2, mvex;

  init = mp4.tools.inspect(data);
  QUnit.equal(init.length, 2, 'generated two boxes');
  QUnit.equal(init[0].type, 'ftyp', 'generated a ftyp box');
  QUnit.equal(init[1].type, 'moov', 'generated a moov box');
  QUnit.equal(init[1].boxes[0].duration, 0xffffffff, 'wrote a maximum duration');

  mvhd = init[1].boxes[0];
  QUnit.equal(mvhd.type, 'mvhd', 'wrote an mvhd');

  trak1 = init[1].boxes[1];
  QUnit.equal(trak1.type, 'trak', 'wrote a trak');
  QUnit.equal(trak1.boxes[0].trackId, 1, 'wrote the first track id');
  QUnit.equal(trak1.boxes[0].width, 600, 'wrote the first track width');
  QUnit.equal(trak1.boxes[0].height, 300, 'wrote the first track height');
  QUnit.equal(trak1.boxes[1].boxes[1].handlerType, 'vide', 'wrote the first track type');

  trak2 = init[1].boxes[2];
  QUnit.equal(trak2.type, 'trak', 'wrote a trak');
  QUnit.equal(trak2.boxes[0].trackId, 2, 'wrote the second track id');
  QUnit.equal(trak2.boxes[1].boxes[1].handlerType, 'soun', 'wrote the second track type');

  mvex = init[1].boxes[3];
  QUnit.equal(mvex.type, 'mvex', 'wrote an mvex');
});

QUnit.test('generates a minimal moof', function() {
  var
    data = mp4.generator.moof(7, [{
      id: 17,
      samples: [{
        duration: 9000,
        size: 10,
        flags: {
          isLeading: 0,
          dependsOn: 2,
          isDependedOn: 1,
          hasRedundancy: 0,
          paddingValue: 0,
          isNonSyncSample: 0,
          degradationPriority: 14
        },
        compositionTimeOffset: 500
      }, {
        duration: 10000,
        size: 11,
        flags: {
          isLeading: 0,
          dependsOn: 1,
          isDependedOn: 0,
          hasRedundancy: 0,
          paddingValue: 0,
          isNonSyncSample: 0,
          degradationPriority: 9
        },
        compositionTimeOffset: 1000
      }]
    }]),
    moof = mp4.tools.inspect(data),
    trun,
    sdtp;

  QUnit.equal(moof.length, 1, 'generated one box');
  QUnit.equal(moof[0].type, 'moof', 'generated a moof box');
  QUnit.equal(moof[0].boxes.length, 2, 'generated two child boxes');
  QUnit.equal(moof[0].boxes[0].type, 'mfhd', 'generated an mfhd box');
  QUnit.equal(moof[0].boxes[0].sequenceNumber, 7, 'included the sequence_number');
  QUnit.equal(moof[0].boxes[1].type, 'traf', 'generated a traf box');
  QUnit.equal(moof[0].boxes[1].boxes.length, 4, 'generated track fragment info');
  QUnit.equal(moof[0].boxes[1].boxes[0].type, 'tfhd', 'generated a tfhd box');
  QUnit.equal(moof[0].boxes[1].boxes[0].trackId, 17, 'wrote the first track id');
  QUnit.equal(moof[0].boxes[1].boxes[0].baseDataOffset, undefined, 'did not set a base data offset');

  QUnit.equal(moof[0].boxes[1].boxes[1].type, 'tfdt', 'generated a tfdt box');
  QUnit.ok(moof[0].boxes[1].boxes[1].baseMediaDecodeTime >= 0,
     'media decode time is non-negative');

  trun = moof[0].boxes[1].boxes[2];
  QUnit.equal(trun.type, 'trun', 'generated a trun box');
  QUnit.equal(typeof trun.dataOffset, 'number', 'has a data offset');
  QUnit.ok(trun.dataOffset >= 0, 'has a non-negative data offset');
  QUnit.equal(trun.dataOffset, moof[0].size + 8, 'sets the data offset past the mdat header');
  QUnit.equal(trun.samples.length, 2, 'wrote two samples');

  QUnit.equal(trun.samples[0].duration, 9000, 'wrote a sample duration');
  QUnit.equal(trun.samples[0].size, 10, 'wrote a sample size');
  QUnit.deepEqual(trun.samples[0].flags, {
    isLeading: 0,
    dependsOn: 2,
    isDependedOn: 1,
    hasRedundancy: 0,
    paddingValue: 0,
    isNonSyncSample: 0,
    degradationPriority: 14
  }, 'wrote the sample flags');
  QUnit.equal(trun.samples[0].compositionTimeOffset, 500, 'wrote the composition time offset');

  QUnit.equal(trun.samples[1].duration, 10000, 'wrote a sample duration');
  QUnit.equal(trun.samples[1].size, 11, 'wrote a sample size');
  QUnit.deepEqual(trun.samples[1].flags, {
    isLeading: 0,
    dependsOn: 1,
    isDependedOn: 0,
    hasRedundancy: 0,
    paddingValue: 0,
    isNonSyncSample: 0,
    degradationPriority: 9
  }, 'wrote the sample flags');
  QUnit.equal(trun.samples[1].compositionTimeOffset, 1000, 'wrote the composition time offset');

  sdtp = moof[0].boxes[1].boxes[3];
  QUnit.equal(sdtp.type, 'sdtp', 'generated an sdtp box');
  QUnit.equal(sdtp.samples.length, 2, 'wrote two samples');
  QUnit.deepEqual(sdtp.samples[0], {
      dependsOn: 2,
      isDependedOn: 1,
      hasRedundancy: 0
  }, 'wrote the sample data table');
  QUnit.deepEqual(sdtp.samples[1], {
    dependsOn: 1,
    isDependedOn: 0,
    hasRedundancy: 0
  }, 'wrote the sample data table');
});

QUnit.test('generates a moof for audio', function() {
  var
    data = mp4.generator.moof(7, [{
      id: 17,
      type: 'audio',
      samples: [{
        duration: 9000,
        size: 10
      }, {
        duration: 10000,
        size: 11
      }]
    }]),
    moof = mp4.tools.inspect(data),
    trun;

  QUnit.deepEqual(moof[0].boxes[1].boxes.length, 3, 'generated three traf children');
  trun = moof[0].boxes[1].boxes[2];
  QUnit.ok(trun, 'generated a trun');
  QUnit.equal(trun.dataOffset, data.byteLength + 8, 'calculated the data offset');
  QUnit.deepEqual(trun.samples, [{
    duration: 9000,
    size: 10
  }, {
    duration: 10000,
    size: 11
  }], 'wrote simple audio samples');
});

QUnit.test('can generate a traf without samples', function() {
  var
    data = mp4.generator.moof(8, [{
      trackId: 13
    }]),
    moof = mp4.tools.inspect(data);

  QUnit.equal(moof[0].boxes[1].boxes[2].samples.length, 0, 'generated no samples');
});

QUnit.test('generates an mdat', function() {
  var
    data = mp4.generator.mdat(new Uint8Array([1, 2, 3, 4])),
    mdat = mp4.tools.inspect(data);

  QUnit.equal(mdat.length, 1, 'generated one box');
  QUnit.equal(mdat[0].type, 'mdat', 'generated an mdat box');
  QUnit.deepEqual(mdat[0].byteLength, 4, 'encapsulated the data');
});
