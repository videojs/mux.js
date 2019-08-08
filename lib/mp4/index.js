"use strict";

exports.__esModule = true;
exports.default = void 0;

var _mp4Generator = _interopRequireDefault(require("./mp4-generator"));

var _probe = _interopRequireDefault(require("./probe"));

var _transmuxer = require("./transmuxer");

var _captionParser = _interopRequireDefault(require("./caption-parser.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
 */
var _default = {
  generator: _mp4Generator.default,
  probe: _probe.default,
  Transmuxer: _transmuxer.Transmuxer,
  AudioSegmentStream: _transmuxer.AudioSegmentStream,
  VideoSegmentStream: _transmuxer.VideoSegmentStream,
  CaptionParser: _captionParser.default
};
exports.default = _default;