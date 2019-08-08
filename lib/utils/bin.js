"use strict";

exports.__esModule = true;
exports.default = exports.toHexString = exports.toUnsigned = void 0;

/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
 */
var toUnsigned = function toUnsigned(value) {
  return value >>> 0;
};

exports.toUnsigned = toUnsigned;

var toHexString = function toHexString(value) {
  return ('00' + value.toString(16)).slice(-2);
};

exports.toHexString = toHexString;
var _default = {
  toUnsigned: toUnsigned,
  toHexString: toHexString
};
exports.default = _default;