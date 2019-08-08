"use strict";

exports.__esModule = true;
exports.default = void 0;

var _flvTag = _interopRequireDefault(require("./flv-tag.js"));

var _transmuxer = _interopRequireDefault(require("./transmuxer.js"));

var _flvHeader = _interopRequireDefault(require("./flv-header.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
 */
var _default = {
  tag: _flvTag.default,
  Transmuxer: _transmuxer.default,
  getFlvHeader: _flvHeader.default
};
exports.default = _default;