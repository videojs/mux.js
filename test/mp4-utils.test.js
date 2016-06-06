'use strict';

var
  QUnit = require('qunit'),
  mp4Utils = require('../lib/mp4/utils');

QUnit.module('MP4 Utils');

QUnit.test('can convert between object and typed array', function() {
  var
    arr = [0, 1, 2, 3, 4, 5],
    typedArr = new Uint8Array([0, 1, 2, 3, 4, 5]),
    obj = mp4Utils.typedArrToObj_(typedArr);

  QUnit.deepEqual(obj, {
    bytes: arr,
    byteOffset: 0,
    byteLength: arr.length
  }, 'can convert into object representation');
  QUnit.deepEqual(mp4Utils.objToTypedArr_(obj), typedArr,
                  'can convert back to typed array');
});

QUnit.test('can serialize and deserialize sps and pps from tracks', function() {
  var
    sps1 = new Uint8Array([0, 1, 2]),
    sps2 = new Uint8Array([3, 4]),
    pps1 = new Uint8Array([5, 6]),
    pps2 = new Uint8Array([7, 8, 9]),
    serializedTracks = mp4Utils.serializeTracks([
      {
        sps: [sps1],
        pps: [pps1]
      },
      {
        sps: [sps2],
        pps: [pps2]
      }
    ]);

  QUnit.equal(typeof serializedTracks, 'string', 'can serialize tracks');
  // don't reuse above object as serializeTracks is destructive
  QUnit.deepEqual(mp4Utils.deserializeTracks(serializedTracks), [
    {
      sps: [sps1],
      pps: [pps1]
    },
    {
      sps: [sps2],
      pps: [pps2]
    }
  ], 'can deserialize tracks');
});
