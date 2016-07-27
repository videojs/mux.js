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
        referenceDTS: undefined,
        lastPTS: undefined,
        referencePTS: undefined,
        rolloverDTSCount: 0,
        rolloverPTSCount: 0
      },
      audio: {
        lastDTS: undefined,
        referenceDTS: undefined,
        lastPTS: undefined,
        referencePTS: undefined,
        rolloverDTSCount: 0,
        rolloverPTSCount: 0
      },
      'timed-metadata': {
        lastDTS: undefined,
        referenceDTS: undefined,
        lastPTS: undefined,
        referencePTS: undefined,
        rolloverDTSCount: 0,
        rolloverPTSCount: 0
      }
    };

  TSCorrectionStream.prototype.init.call(this);

  var handleRollover = function(value, reference) {
    var direction = 1;

    if (value > reference) {
      direction = -1;
    }

    var count = 0;

    while (Math.abs(reference - value) > RO_THRESH) {
      count += direction;
      value += (direction * MAX_TS);
    }

    return count;
  }

  this.push = function(data) {
    if (!reference.hasOwnProperty(data.type)) {
      return;
    }

    var ref = reference[data.type];

    if (ref.referenceDTS === undefined) {
      ref.referenceDTS = data.dts;
      ref.lastDTS = data.dts
    }

    if (ref.referencePTS === undefined) {
      ref.referencePTS = data.pts;
      ref.lastPTS = data.pts;
    }

    data.dts += (MAX_TS * ref.rolloverDTSCount);
    data.pts += (MAX_TS * ref.rolloverPTSCount);

    var dtsRoll = handleRollover(data.dts, ref.referenceDTS);
    ref.rolloverDTSCount += dtsRoll;
    data.dts += (MAX_TS * dtsRoll);

    var ptsRoll = handleRollover(data.pts, ref.referencePTS);
    ref.rolloverPTSCount += ptsRoll;
    data.pts += (MAX_TS * ptsRoll);

    ref.lastDTS = data.dts
    ref.lastPTS = data.pts

    this.trigger('data', data);
  };

  this.flush = function() {
    for (var type in reference) {
      if (reference.hasOwnProperty(type)) {
        var ref = reference[type];
        ref.referenceDTS = ref.lastDTS;
        ref.referencePTS = ref.lastPTS;
      }
    }

    this.trigger('done');
  };

};

TSCorrectionStream.prototype = new Stream();

module.exports = TSCorrectionStream;