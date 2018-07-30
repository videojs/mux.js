var
  binaryStringToArrayOfBytes,
  leftPad;

binaryStringToArrayOfBytes = function(string) {
  var
    array = [],
    arrayIndex = 0,
    stringIndex = 0;

  while (stringIndex < string.length) {
    array[arrayIndex] = parseInt(string.slice(stringIndex, stringIndex + 8), 2);

    arrayIndex++;
    // next byte
    stringIndex += 8;
  }

  return array;
};

leftPad = function(string, targetLength) {
  if (string.length >= targetLength) {
    return string;
  }
  return new Array(targetLength - string.length + 1).join('0') + string;
};

module.exports = {
  binaryStringToArrayOfBytes: binaryStringToArrayOfBytes,
  leftPad: leftPad
};
