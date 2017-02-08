'use strict';

var TagList = function() {
  var self = this;

  this.list = [];

  this.push = function(tag) {
    this.list.push({
      bytes: tag.bytes,
      dts: tag.dts,
      pts: tag.pts
    });
  };

  Object.defineProperty(this, 'length', {
    get: function() {
      return self.list.length;
    }
  });
};

module.exports = TagList;
