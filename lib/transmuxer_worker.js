/**
 * mux.js
 *
 * Copyright (c) 2015 Brightcove
 * All rights reserved.
 *
 * Handles communication between the browser-world and the Transmuxer
 * running inside of a webworker by exposing a message-based interface
 * to the Transmuxer object.
 */
var muxjs = {};

importScripts('exp-golomb.js');
importScripts('mp4-generator.js');
importScripts('stream.js');
importScripts('transmuxer.js');

var transmuxer = new muxjs.mp2t.Transmuxer();

onmessage = function(event) {
  if (event.data.action === 'push') {
    // Cast to type
    var segment = new Uint8Array(event.data.data);

    transmuxer.push(segment);
  } else if (event.data.action === 'flush') {
    transmuxer.flush();
  }
}

transmuxer.on('data', function (segment) {
  postMessage({action: 'data', type: segment.type, data: segment.data.buffer}, [segment.data.buffer]);
});

transmuxer.on('done', function (data) {
  postMessage({action: 'done'});
});
