/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
 *
 * A lightweight readable stream implemention that handles event dispatching.
 * Objects that inherit from streams should call init in their constructors.
 */
'use strict';
import Stream from '@videojs/vhs-utils/dist/stream';

class MuxStream extends stream {
  pipe(destination) {
    this.on('data', function(data) {
      destination.push(data);
    });

    this.on('done', function(flushSource) {
      destination.flush(flushSource);
    });

    this.on('partialdone', function(flushSource) {
      destination.partialFlush(flushSource);
    });

    this.on('endedtimeline', function(flushSource) {
      destination.endTimeline(flushSource);
    });

    this.on('reset', function(flushSource) {
      destination.reset(flushSource);
    });

    return destination;
  }
  push(data) {
    this.trigger('data', data);
  };

  flush(flushSource) {
    this.trigger('done', flushSource);
  };

  partialFlush(flushSource) {
    this.trigger('partialdone', flushSource);
  };

  endTimeline(flushSource) {
    this.trigger('endedtimeline', flushSource);
  };

  reset(flushSource) {
    this.trigger('reset', flushSource);
  };
};

// backwards compatability
MuxStream.prototype.init = MuxStream.prototype.constructor;

export default Stream;
