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

  muxjs.debug = {
    diffParsed: diffParsed
  };
})(window.muxjs);
