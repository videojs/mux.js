"use strict";

exports.__esModule = true;
exports.default = void 0;

var _adts = _interopRequireDefault(require("./adts.js"));

var _h = _interopRequireDefault(require("./h264.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
 */
var _default = {
  Adts: _adts.default,
  h264: _h.default
};
exports.default = _default;