/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
 */
'use strict';
import codecs from './codecs';
import mp4 from './mp4';
import flv from './flv';
import mp2t from './m2ts';
import partial from './partial';
import mp4Inspector from './tools/mp4-inspector.js';
import flvInspector from './tools/flv-inspector.js';
import tsInspector from './tools/ts-inspector.js';

var muxjs = {
  codecs: codecs,
  mp4: mp4,
  flv: flv,
  mp2t: mp2t,
  partial: partial
};

// include all the tools when the full library is required
muxjs.mp4.tools = mp4Inspector;
muxjs.flv.tools = flvInspector;
muxjs.mp2t.tools = tsInspector;


export default muxjs;
