'use strict';

var
  QUnit = require('qunit'),
  typedArrayUtils = require('../lib/utils/typed-array');

QUnit.module('Typed Array Utils');

QUnit.test('concats typed arrays into a new typed array', function() {
  QUnit.deepEqual(
    new Uint8Array([]),
    typedArrayUtils.concatTypedArrays(new Uint8Array([]), new Uint8Array([])),
    'handles empty arrays');
  QUnit.deepEqual(
    new Uint8Array([0]),
    typedArrayUtils.concatTypedArrays(new Uint8Array([0]), new Uint8Array([])),
    'handles single empty array');
  QUnit.deepEqual(
    new Uint8Array([0]),
    typedArrayUtils.concatTypedArrays(new Uint8Array([]), new Uint8Array([0])),
    'handles single empty array');
  QUnit.deepEqual(
    new Uint8Array([0, 1, 2, 3, 4]),
    typedArrayUtils.concatTypedArrays(new Uint8Array([0, 1]), new Uint8Array([2, 3, 4])),
    'handled simple case');
});
