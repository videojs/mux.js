/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
 */
import tag from './flv-tag.js';
import Transmuxer from './transmuxer.js';
import getFlvHeader from './flv-header.js';
export default {
  tag: tag,
  Transmuxer: Transmuxer,
  getFlvHeader: getFlvHeader
};