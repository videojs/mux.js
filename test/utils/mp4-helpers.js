/**
 * Helper functions for creating test MP4 data.
 */
'use strict';
var box, typeBytes, unityMatrix;

module.exports = {};

// ----------------------
// Box Generation Helpers
// ----------------------

module.exports.typeBytes = typeBytes = function(type) {
  return [
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3)
  ];
};

module.exports.box = box = function(type) {
  var
    array = Array.prototype.slice.call(arguments, 1),
    result = [],
    size,
    i;

  // "unwrap" any arrays that were passed as arguments
  // e.g. box('etc', 1, [2, 3], 4) -> box('etc', 1, 2, 3, 4)
  for (i = 0; i < array.length; i++) {
    if (array[i] instanceof Array) {
      array.splice.apply(array, [i, 1].concat(array[i]));
    }
  }

  size = 8 + array.length;

  result[0] = (size & 0xFF000000) >> 24;
  result[1] = (size & 0x00FF0000) >> 16;
  result[2] = (size & 0x0000FF00) >> 8;
  result[3] = size & 0xFF;
  result = result.concat(typeBytes(type));
  result = result.concat(array);
  return result;
};

module.exports.unityMatrix = unityMatrix = [
  0, 0, 0x10, 0,
  0, 0, 0, 0,
  0, 0, 0, 0,

  0, 0, 0, 0,
  0, 0, 0x10, 0,
  0, 0, 0, 0,

  0, 0, 0, 0,
  0, 0, 0, 0,
  0x40, 0, 0, 0
];

// ------------
// Example Data
// ------------

module.exports.sampleMoov =
  box('moov',
      box('mvhd',
          0x01, // version 1
          0x00, 0x00, 0x00, // flags
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x01, // creation_time
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x02, // modification_time
          0x00, 0x00, 0x03, 0xe8, // timescale = 1000
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x02, 0x58, // 600 = 0x258 duration
          0x00, 0x01, 0x00, 0x00, // 1.0 rate
          0x01, 0x00, // 1.0 volume
          0x00, 0x00, // reserved
          0x00, 0x00, 0x00, 0x00, // reserved
          0x00, 0x00, 0x00, 0x00, // reserved
          unityMatrix,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, // pre_defined
          0x00, 0x00, 0x00, 0x02), // next_track_ID
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
              unityMatrix,
              0x01, 0x2c, 0x00, 0x00, // 300 in 16.16 fixed-point
              0x00, 0x96, 0x00, 0x00), // 150 in 16.16 fixed-point
          box('mdia',
              box('mdhd',
                  0x01, // version 1
                  0x00, 0x00, 0x00, // flags
                  0x00, 0x00, 0x00, 0x00,
                  0x00, 0x00, 0x00, 0x02, // creation_time
                  0x00, 0x00, 0x00, 0x00,
                  0x00, 0x00, 0x00, 0x03, // modification_time
                  0x00, 0x01, 0x5f, 0x90, // timescale = 90000
                  0x00, 0x00, 0x00, 0x00,
                  0x00, 0x00, 0x02, 0x58, // 600 = 0x258 duration
                  0x15, 0xc7, // 'eng' language
                  0x00, 0x00),
              box('hdlr',
                  0x01, // version 1
                  0x00, 0x00, 0x00, // flags
                  0x00, 0x00, 0x00, 0x00, // pre_defined
                  typeBytes('vide'), // handler_type
                  0x00, 0x00, 0x00, 0x00, // reserved
                  0x00, 0x00, 0x00, 0x00, // reserved
                  0x00, 0x00, 0x00, 0x00, // reserved
                  typeBytes('one'), 0x00), // name
              box('minf',
                  box('dinf',
                      box('dref',
                          0x01, // version 1
                          0x00, 0x00, 0x00, // flags
                          0x00, 0x00, 0x00, 0x01, // entry_count
                          box('url ',
                              0x00, // version
                              0x00, 0x00, 0x01))), // flags
                  box('stbl',
                      box('stsd',
                          0x01, // version 1
                          0x00, 0x00, 0x00, // flags
                          0x00, 0x00, 0x00, 0x00), // entry_count
                      box('stts',
                          0x01, // version 1
                          0x00, 0x00, 0x00, // flags
                          0x00, 0x00, 0x00, 0x01, // entry_count
                          0x00, 0x00, 0x00, 0x01, // sample_count
                          0x00, 0x00, 0x00, 0x01), // sample_delta
                      box('stsc',
                          0x01, // version 1
                          0x00, 0x00, 0x00, // flags
                          0x00, 0x00, 0x00, 0x01, // entry_count
                          0x00, 0x00, 0x00, 0x02, // first_chunk
                          0x00, 0x00, 0x00, 0x03, // samples_per_chunk
                          0x00, 0x00, 0x00, 0x01), // sample_description_index
                      box('stco',
                          0x01, // version 1
                          0x00, 0x00, 0x00, // flags
                          0x00, 0x00, 0x00, 0x01, // entry_count
                          0x00, 0x00, 0x00, 0x01)))))); // chunk_offset
