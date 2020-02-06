var Transmuxer = require('../lib/partial/transmuxer.js');
var utils = require('./utils');
var generatePMT = utils.generatePMT;
var videoPes = utils.videoPes;
var audioPes = utils.audioPes;
var packetize = utils.packetize;
var PAT = utils.PAT;

QUnit.module('Partial Transmuxer - Options');
QUnit.test('Audio frames trimmed before video, keepOriginalTimestamps = false', function() {
  var
    segments = [],
    earliestDts = 15000,
    transmuxer = new Transmuxer({
      keepOriginalTimestamps: false
    });

  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });

  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true,
    hasAudio: true
  })));

  transmuxer.push(packetize(audioPes([
    0x19, 0x47
  ], true, earliestDts - 1)));

  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true, earliestDts)));
  transmuxer.push(packetize(videoPes([
      0x08, 0x01 // pic_parameter_set_rbsp
  ], true, earliestDts)));
  transmuxer.push(packetize(videoPes([
    0x07, // seq_parameter_set_rbsp
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], false, earliestDts)));
  transmuxer.push(packetize(videoPes([
      0x05, 0x01 // slice_layer_without_partitioning_rbsp_idr
  ], true, earliestDts)));

  transmuxer.flush();

  QUnit.equal(segments.length, 1, 'generated only a video segment');
});

QUnit.test('Audio frames trimmed before video, keepOriginalTimestamps = true', function() {
  var
    segments = [],
    earliestDts = 15000,
    transmuxer = new Transmuxer({
      keepOriginalTimestamps: true
    });

  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });

  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true,
    hasAudio: true
  })));

  transmuxer.push(packetize(audioPes([
    0x19, 0x47
  ], true, earliestDts - 1)));
  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true, earliestDts)));
  transmuxer.push(packetize(videoPes([
      0x08, 0x01 // pic_parameter_set_rbsp
  ], true, earliestDts)));
  transmuxer.push(packetize(videoPes([
    0x07, // seq_parameter_set_rbsp
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], false, earliestDts)));
  transmuxer.push(packetize(videoPes([
      0x05, 0x01 // slice_layer_without_partitioning_rbsp_idr
  ], true, earliestDts)));
  transmuxer.flush();

  QUnit.equal(segments.length, 1, 'generated only a video segment');
});

QUnit.test('Audio frames after video not trimmed, keepOriginalTimestamps = false', function() {
  var
    segments = [],
    earliestDts = 15000,
    transmuxer = new Transmuxer({
      keepOriginalTimestamps: false
    });

  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });

  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true,
    hasAudio: true
  })));

  transmuxer.push(packetize(audioPes([
    0x19, 0x47
  ], true, earliestDts + 1)));
  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true, earliestDts)));
  transmuxer.push(packetize(videoPes([
      0x08, 0x01 // pic_parameter_set_rbsp
  ], true, earliestDts)));
  transmuxer.push(packetize(videoPes([
    0x07, // seq_parameter_set_rbsp
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], false, earliestDts)));
  transmuxer.push(packetize(videoPes([
      0x05, 0x01 // slice_layer_without_partitioning_rbsp_idr
  ], true, earliestDts)));
  transmuxer.flush();

  QUnit.equal(segments.length, 2, 'generated a video and an audio segment');
  QUnit.equal(segments[1].data.boxes.length, 122, 'trimmed audio frame');
});

QUnit.test('Audio frames after video not trimmed, keepOriginalTimestamps = true', function() {
  var
    segments = [],
    earliestDts = 15000,
    transmuxer = new Transmuxer({
      keepOriginalTimestamps: true
    });

  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });

  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true,
    hasAudio: true
  })));

  transmuxer.push(packetize(audioPes([
    0x19, 0x47
  ], true, earliestDts + 1)));
  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true, earliestDts)));
  transmuxer.push(packetize(videoPes([
      0x08, 0x01 // pic_parameter_set_rbsp
  ], true, earliestDts)));
  transmuxer.push(packetize(videoPes([
    0x07, // seq_parameter_set_rbsp
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], false, earliestDts)));
  transmuxer.push(packetize(videoPes([
      0x05, 0x01 // slice_layer_without_partitioning_rbsp_idr
  ], true, earliestDts)));
  transmuxer.flush();

  QUnit.equal(segments.length, 2, 'generated a video and an audio segment');
  QUnit.equal(segments[1].data.boxes.length, 122, 'trimmed audio frame');
});

QUnit.test('Audio frames after video not trimmed, keepOriginalTimestamps = false, baseMediaDecodeTime option', function() {
  var
    segments = [],
    earliestDts = 15000,
    baseMediaDecodeTime = 15000,
    transmuxer = new Transmuxer({
      keepOriginalTimestamps: false,
      baseMediaDecodeTime: baseMediaDecodeTime
    });

  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });

  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true,
    hasAudio: true
  })));

  transmuxer.push(packetize(audioPes([
    0x19, 0x47
  ], true, earliestDts + 1)));
  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true, earliestDts + baseMediaDecodeTime)));
  transmuxer.push(packetize(videoPes([
      0x08, 0x01 // pic_parameter_set_rbsp
  ], true, earliestDts + baseMediaDecodeTime)));
  transmuxer.push(packetize(videoPes([
    0x07, // seq_parameter_set_rbsp
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], false, earliestDts + baseMediaDecodeTime)));
  transmuxer.push(packetize(videoPes([
      0x05, 0x01 // slice_layer_without_partitioning_rbsp_idr
  ], true, earliestDts + baseMediaDecodeTime)));
  transmuxer.flush();

  QUnit.equal(segments.length, 2, 'generated a video and an audio segment');
  QUnit.equal(segments[1].data.boxes.length, 122, 'trimmed audio frame');
});

QUnit.test('Audio frames after video not trimmed, keepOriginalTimestamps = true, baseMediaDecodeTime option', function() {
  var
    segments = [],
    earliestDts = 15000,
    baseMediaDecodeTime = 15000,
    transmuxer = new Transmuxer({
      keepOriginalTimestamps: true,
      baseMediaDecodeTime: baseMediaDecodeTime
    });

  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });

  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true,
    hasAudio: true
  })));

  transmuxer.push(packetize(audioPes([
    0x19, 0x47
  ], true, earliestDts + 1)));
  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true, earliestDts + baseMediaDecodeTime)));
  transmuxer.push(packetize(videoPes([
      0x08, 0x01 // pic_parameter_set_rbsp
  ], true, earliestDts + baseMediaDecodeTime)));
  transmuxer.push(packetize(videoPes([
    0x07, // seq_parameter_set_rbsp
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], false, earliestDts + baseMediaDecodeTime)));
  transmuxer.push(packetize(videoPes([
      0x05, 0x01 // slice_layer_without_partitioning_rbsp_idr
  ], true, earliestDts + baseMediaDecodeTime)));
  transmuxer.flush();

  QUnit.equal(segments.length, 2, 'generated a video and an audio segment');
  QUnit.equal(segments[1].data.boxes.length, 122, 'trimmed audio frame');
});

QUnit.test('Audio frames after video not trimmed, keepOriginalTimestamps = false, baseMediaDecodeTime setter', function() {
  var
    segments = [],
    earliestDts = 15000,
    baseMediaDecodeTime = 15000,
    transmuxer = new Transmuxer({
      keepOriginalTimestamps: false
    });

  transmuxer.setBaseMediaDecodeTime(baseMediaDecodeTime);

  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });

  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true,
    hasAudio: true
  })));

  transmuxer.push(packetize(audioPes([
    0x19, 0x47
  ], true, earliestDts + 1)));
  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true, earliestDts + baseMediaDecodeTime)));
  transmuxer.push(packetize(videoPes([
      0x08, 0x01 // pic_parameter_set_rbsp
  ], true, earliestDts + baseMediaDecodeTime)));
  transmuxer.push(packetize(videoPes([
    0x07, // seq_parameter_set_rbsp
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], false, earliestDts + baseMediaDecodeTime)));
  transmuxer.push(packetize(videoPes([
      0x05, 0x01 // slice_layer_without_partitioning_rbsp_idr
  ], true, earliestDts + baseMediaDecodeTime)));
  transmuxer.flush();

  QUnit.equal(segments.length, 2, 'generated a video and an audio segment');
  QUnit.equal(segments[1].data.boxes.length, 122, 'trimmed audio frame');
});

QUnit.test('Audio frames after video not trimmed, keepOriginalTimestamps = true, baseMediaDecodeTime setter', function() {
  var
    segments = [],
    earliestDts = 15000,
    baseMediaDecodeTime = 15000,
    transmuxer = new Transmuxer({
      keepOriginalTimestamps: true
    });

  transmuxer.setBaseMediaDecodeTime(baseMediaDecodeTime);

  transmuxer.on('data', function(segment) {
    segments.push(segment);
  });

  transmuxer.push(packetize(PAT));
  transmuxer.push(packetize(generatePMT({
    hasVideo: true,
    hasAudio: true
  })));

  transmuxer.push(packetize(audioPes([
    0x19, 0x47
  ], true, earliestDts + 1)));
  transmuxer.push(packetize(videoPes([
      0x09, 0x01 // access_unit_delimiter_rbsp
  ], true, earliestDts + baseMediaDecodeTime)));
  transmuxer.push(packetize(videoPes([
      0x08, 0x01 // pic_parameter_set_rbsp
  ], true, earliestDts + baseMediaDecodeTime)));
  transmuxer.push(packetize(videoPes([
    0x07, // seq_parameter_set_rbsp
    0x27, 0x42, 0xe0, 0x0b,
    0xa9, 0x18, 0x60, 0x9d,
    0x80, 0x53, 0x06, 0x01,
    0x06, 0xb6, 0xc2, 0xb5,
    0xef, 0x7c, 0x04
  ], false, earliestDts + baseMediaDecodeTime)));
  transmuxer.push(packetize(videoPes([
      0x05, 0x01 // slice_layer_without_partitioning_rbsp_idr
  ], true, earliestDts + baseMediaDecodeTime)));
  transmuxer.flush();

  QUnit.equal(segments.length, 2, 'generated a video and an audio segment');
  QUnit.equal(segments[1].data.boxes.length, 122, 'trimmed audio frame');
});

