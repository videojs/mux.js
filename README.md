# mux.js

Lightweight utilities for inspecting and manipulating video container formats.

[![Build Status](https://travis-ci.org/videojs/mux.js.svg?branch=master)](https://travis-ci.org/videojs/mux.js)

## MPEG2-TS to fMP4 Transmuxer
Feed in `Uint8Array`s of an MPEG-2 transport stream, get out a fragmented MP4:

```js
// create a transmuxer:
var transmuxer = new muxjs.mp2t.Transmuxer(initOptions);
// data events signal a new fMP4 segment is ready:
transmuxer.on('data', function (segment) {
  // Tada! Now you have an MP4 that you could use with Media Source Extensions
  sourceBuffer.appendBuffer(segment.data.buffer);
});
```

### Metadata
The transmuxer can also parse out supplementary video data like timed ID3 metadata and CEA-608 captions.
You can find both attached to the data event object:

```js
transmuxer.on('data', function (segment) {
  // create a metadata text track cue for each ID3 frame:
  segment.metadata.frames.forEach(function(frame) {
    metadataTextTrack.addCue(new VTTCue(time, time, frame.value));
  });
  // create a VTTCue for all the parsed CEA-608 captions:
  segment.captions.forEach(function(cue) {
    captionTextTrack.addCue(new VTTCue(cue.startTime, cue.endTime, cue.text));
  });
});
```
