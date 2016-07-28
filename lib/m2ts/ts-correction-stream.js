/**
 * mux.js
 *
 * Copyright (c) 2016 Brightcove
 * All rights reserved.
 *
 * Accepts program elementary stream (PES) data events and corrects
 * decode and presentation time stamps to account for a rollover
 * of the 33 bit value.
 */
 
'use strict';

var Stream = require('../utils/stream');

var MAX_TS = 8589934592;

var RO_THRESH = 4294967296;

var TSCorrectionStream = function() {

  var
    reference = {
      video: {
        lastDTS: undefined,
        referenceDTS: undefined
      },
      audio: {
        lastDTS: undefined,
        referenceDTS: undefined
      },
      'timed-metadata': {
        lastDTS: undefined,
        referenceDTS: undefined
      }
    };

  TSCorrectionStream.prototype.init.call(this);

  var handleRollover = function(value, reference) {
    var direction = 1;

    if (value > reference) {
      direction = -1;
    }

    while (Math.abs(reference - value) > RO_THRESH) {
      value += (direction * MAX_TS);
    }

    return value;
  }

  this.push = function(data) {
    if (!reference.hasOwnProperty(data.type)) {
      return;
    }

    var ref = reference[data.type];

    if (ref.referenceDTS === undefined) {
      ref.referenceDTS = data.dts;
    }

    data.dts = handleRollover(data.dts, ref.referenceDTS);
    data.pts = handleRollover(data.pts, ref.referenceDTS);

    ref.lastDTS = data.dts

    this.trigger('data', data);
  };

  this.flush = function() {
    for (var type in reference) {
      if (reference.hasOwnProperty(type)) {
        var ref = reference[type];
        ref.referenceDTS = ref.lastDTS;
      }
    }

    this.trigger('done');
  };

};

TSCorrectionStream.prototype = new Stream();

module.exports = TSCorrectionStream;