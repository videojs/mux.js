'use strict';

var TagList = function() {
  this.list = [];

  this.push = function(tag) {
    this.list.push({
      bytes: tag.bytes,
      dts: tag.dts,
      pts: tag.pts
    });
  }
};

module.exports = TagList;
