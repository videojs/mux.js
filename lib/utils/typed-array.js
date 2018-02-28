var concatTypedArrays = function(arr1, arr2) {
  var
    i,
    tempArray = new Uint8Array(arr1.length + arr2.length);

  for (i = 0; i < arr1.length; i++) {
    tempArray[i] = arr1[i];
  }

  for (i = 0; i < arr2.length; i++) {
    tempArray[i + arr1.length] = arr2[i];
  }

  return tempArray;
};

module.exports = {
  concatTypedArrays: concatTypedArrays
};
