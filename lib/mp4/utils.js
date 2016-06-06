'use strict';

var
  typedArrToObj,
  objToTypedArr,
  serializeTracks,
  deserializeTracks;

typedArrToObj = function(typedArr) {
  var obj = {};

  obj.bytes = Array.prototype.slice.call(typedArr);
  obj.byteOffset = typedArr.byteOffset;
  obj.byteLength = typedArr.byteLength;

  return obj;
};

objToTypedArr = function(obj) {
  return new Uint8Array(obj.bytes, obj.byteOffset, obj.byteLength);
};

// destructive
serializeTracks = function(tracks) {
  tracks.forEach(function(track) {
    if (track.pps) {
      track.pps = track.pps.map(function(pps) {
        return typedArrToObj(pps);
      });
    }

    if (track.sps) {
      track.sps = track.sps.map(function(sps) {
        return typedArrToObj(sps);
      });
    }
  });

  return JSON.stringify(tracks);
};

deserializeTracks = function(serializedTracks) {
  var tracks = JSON.parse(serializedTracks);

  tracks.forEach(function(track) {
    if (track.pps) {
      track.pps = track.pps.map(function(pps) {
        return objToTypedArr(pps);
      });
    }

    if (track.sps) {
      track.sps = track.sps.map(function(sps) {
        return objToTypedArr(sps);
      });
    }
  });

  return tracks;
};

module.exports = {
  serializeTracks: serializeTracks,
  deserializeTracks: deserializeTracks,
  // exposed for testing
  objToTypedArr_: objToTypedArr,
  typedArrToObj_: typedArrToObj
};
