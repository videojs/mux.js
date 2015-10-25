(function(muxjs) {
  'use strict';

  var diffParsed = function(expected, actual) {
    var expectedLines = muxjs.tools.textifyMp4(expected, null, ' ').split('\n');
    var actualLines = muxjs.tools.textifyMp4(actual, null, ' ').split('\n');
    var matcher = new difflib.SequenceMatcher(expectedLines, actualLines);

    return diffview.buildView({
      baseTextLines: expectedLines,
      newTextLines: actualLines,
      opcodes: matcher.get_opcodes(),
      baseTextName: "Expected MP4",
      newTextName: "Actual MP4",
      contextSize: 10,
      viewType: 0
    });
  };

  var logMediaSource = function(event) {
    console.log('media source', event.type);
  };
  var logSourceBuffer = function(event) {
    console.log('source buffer', event.type);
  };

  var prepareVideo = function(video, options, callback) {
    var mediaSource  = new MediaSource();

    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    video.src = URL.createObjectURL(mediaSource);
    mediaSource.addEventListener('error', logMediaSource);
    mediaSource.addEventListener('opened', logMediaSource);
    mediaSource.addEventListener('closed', logMediaSource);
    mediaSource.addEventListener('sourceended', logMediaSource);

    mediaSource.addEventListener('sourceopen', function () {
      var sourceBuffer, codecs;

      codecs = options.codecs || 'avc1.64001f,mp4a.40.2';

      sourceBuffer = mediaSource.addSourceBuffer('video/mp4;codecs="' + codecs + '"');

      sourceBuffer.addEventListener('updatestart', logSourceBuffer);
      sourceBuffer.addEventListener('updateend', logSourceBuffer);
      sourceBuffer.addEventListener('error', logSourceBuffer);

      video.addEventListener('error', logSourceBuffer);
      video.addEventListener('error', function() {
        video.classList.add('error');
      });

      return callback(mediaSource, sourceBuffer);
    });
  }

  muxjs.debug = {
    diffParsed: diffParsed,
    prepareVideo: prepareVideo
  };
})(window.muxjs);
