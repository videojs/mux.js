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

var Stream = require('@videojs/vhs-utils/dist/stream.cjs.js');

var MuxStream = function() {};

MuxStream.prototype = new Stream();
MuxStream.prototype.init = MuxStream.prototype.constructor;

/**
 * Forwards all `data` events on this stream to the destination stream. The
 * destination stream should provide a method `push` to receive the data
 * events as they arrive.
 * @param destination {stream} the stream that will receive all `data` events
 * @param autoFlush {boolean} if false, we will not call `flush` on the destination
 *                            when the current stream emits a 'done' event
 * @see http://nodejs.org/api/stream.html#stream_readable_pipe_destination_options
 */
MuxStream.prototype.pipe = function(destination) {
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
};

// Default stream functions that are expected to be overridden to perform
// actual work. These are provided by the prototype as a sort of no-op
// implementation so that we don't have to check for their existence in the
// `pipe` function above.
MuxStream.prototype.push = function(data) {
  this.trigger('data', data);
};

MuxStream.prototype.flush = function(flushSource) {
  this.trigger('done', flushSource);
};

MuxStream.prototype.partialFlush = function(flushSource) {
  this.trigger('partialdone', flushSource);
};

MuxStream.prototype.endTimeline = function(flushSource) {
  this.trigger('endedtimeline', flushSource);
};

MuxStream.prototype.reset = function(flushSource) {
  this.trigger('reset', flushSource);
};

module.exports = MuxStream;
