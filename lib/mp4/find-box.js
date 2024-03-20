var toUnsigned = require('../utils/bin').toUnsigned;
var parseType = require('./parse-type.js');

var findBox = function(data, path) {
  var results = [],
    i, size, type, end, subresults;

  if (!path.length) {
    // short-circuit the search for empty paths
    return null;
  }

  for (i = 0; i < data.byteLength;) {
    size = toUnsigned(data[i]     << 24 |
      data[i + 1] << 16 |
      data[i + 2] <<  8 |
      data[i + 3]);

    type = parseType(data.subarray(i + 4, i + 8));

    if (size === 1) {
      size = toUnsigned(
        data[i + 8] << 56 |
        data[i + 9] << 48 |
        data[i + 10] << 40 |
        data[i + 11] << 32 |
        data[i + 12] << 24 |
        data[i + 13] << 16 |
        data[i + 14] <<  8 |
        data[i + 15]);
      i += 8;
      size -= 8;
    }

    end = size > 1 ? i + size : data.byteLength;

    if (type === path[0]) {
      if (path.length === 1) {
        // this is the end of the path and we've found the box we were
        // looking for
        results.push(data.subarray(i + 8, end));
      } else {
        // recursively search for the next box along the path
        subresults = findBox(data.subarray(i + 8, end), path.slice(1));
        if (subresults.length) {
          results = results.concat(subresults);
        }
      }
    }
    i = end;
  }

  // we've finished searching all of data
  return results;
};

module.exports = findBox;

