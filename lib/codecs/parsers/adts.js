var
  ADTS_SAMPLING_FREQUENCIES = [
    96000,
    88200,
    64000,
    48000,
    44100,
    32000,
    24000,
    22050,
    16000,
    12000,
    11025,
    8000,
    7350
  ];

var parseAdtsHeader = function(buffer, offset) {
  var
    // The protection skip bit tells us if we have 2 bytes of CRC data at the
    // end of the ADTS header
    protectionSkipBytes = (~buffer[offset + 1] & 0x01) * 2,
    // Frame length is a 13 bit integer starting 16 bits from the
    // end of the sync sequence
    frameLength = ((buffer[offset + 3] & 0x03) << 11) |
      (buffer[offset + 4] << 3) |
      ((buffer[offset + 5] & 0xe0) >> 5),
    sampleCount = ((buffer[offset + 6] & 0x03) + 1) * 1024,
    samplingFrequencyIndex = (buffer[offset + 2] & 0x3c) >>> 2,
    sampleRate = ADTS_SAMPLING_FREQUENCIES[samplingFrequencyIndex],
    adtsFrameDuration = (sampleCount * 90000) / sampleRate,
    frameEnd = offset + frameLength;

  return {
    protectionSkipBytes: protectionSkipBytes,
    frameEnd: frameEnd,
    adtsFrameDuration: adtsFrameDuration,
    sampleCount: sampleCount,
    audioObjectType: ((buffer[offset + 2] >>> 6) & 0x03) + 1,
    channelCount: ((buffer[offset + 2] & 1) << 2) |
      ((buffer[offset + 3] & 0xc0) >>> 6),
    samplingFrequencyIndex: samplingFrequencyIndex,
    sampleRate: sampleRate
  };
};

module.exports = {
  parseAdtsHeader: parseAdtsHeader
};
