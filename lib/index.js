/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
 */
'use strict';

exports.__esModule = true;
exports.default = void 0;

var _codecs = _interopRequireDefault(require("./codecs"));

var _mp = _interopRequireDefault(require("./mp4"));

var _flv = _interopRequireDefault(require("./flv"));

var _m2ts = _interopRequireDefault(require("./m2ts"));

var _partial = _interopRequireDefault(require("./partial"));

var _mp4Inspector = _interopRequireDefault(require("./tools/mp4-inspector.js"));

var _flvInspector = _interopRequireDefault(require("./tools/flv-inspector.js"));

var _tsInspector = _interopRequireDefault(require("./tools/ts-inspector.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var muxjs = {
  codecs: _codecs.default,
  mp4: _mp.default,
  flv: _flv.default,
  mp2t: _m2ts.default,
  partial: _partial.default
}; // include all the tools when the full library is required

muxjs.mp4.tools = _mp4Inspector.default;
muxjs.flv.tools = _flvInspector.default;
muxjs.mp2t.tools = _tsInspector.default;
var _default = muxjs;
exports.default = _default;