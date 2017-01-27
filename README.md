# mux.js [![Build Status](https://travis-ci.org/videojs/mux.js.svg?branch=master)](https://travis-ci.org/videojs/mux.js)


Lightweight utilities for inspecting and manipulating video container formats.

Lead Maintainer: Jon-Carlos Rivera [@imbcmdth](https://github.com/imbcmdth)

Maintenance Status: Stable

## Diagram
![mux.js diagram](/docs/diagram.png)

## MPEG2-TS to fMP4 Transmuxer
Feed in `Uint8Array`s of an MPEG-2 transport stream, get out a fragmented MP4:

```js
// create a transmuxer:
var transmuxer = new muxjs.mp4.Transmuxer(initOptions);
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

## MP4 Inspector
Parse MP4s into javascript objects or a text representation for display or debugging:
```js
// drop in a Uint8Array of an MP4:
var parsed = muxjs.mp4.tools.inspect(bytes);
// dig into the boxes:
console.log('The major brand of the first box:', parsed[0].majorBrand);
// print out the structure of the MP4:
document.body.appendChild(document.createTextNode(muxjs.textifyMp4(parsed)));
```
The MP4 inspector is used extensively as a debugging tool for the transmuxer. You can see it in action by cloning the project and opening [the debug page](https://github.com/videojs/mux.js/blob/master/debug/index.html) in your browser.

## Building
If you're using this project in a node-like environment, just
require() whatever you need. If you'd like to package up a
distribution to include separately, run `npm run build`. See the
package.json for other handy scripts if you're thinking about
contributing.
