(function(window, muxjs) {

var
  hex = function (val) {
    return '0x' + ('00' + val.toString(16)).slice(-2).toUpperCase();
  },
  hexStringList = function (data) {
    var arr = [];

    while(data.byteLength >0) {
      i = 0;
      switch(data.byteLength) {
        default:
          arr.push(hex(data[i++]));
        case 7:
          arr.push(hex(data[i++]));
        case 6:
          arr.push(hex(data[i++]));
        case 5:
          arr.push(hex(data[i++]));
        case 4:
          arr.push(hex(data[i++]));
        case 3:
          arr.push(hex(data[i++]));
        case 2:
          arr.push(hex(data[i++]));
        case 1:
          arr.push(hex(data[i++]));
      }
      data = data.subarray(i);
    }
    return arr.join(' ');
  },
  parseAVCTag = function (tag, obj) {
    var
      avcPacketTypes = [
        'AVC Sequence Header',
        'AVC NALU',
        'AVC End-of-Sequence'
      ],
      nalUnitTypes = [
        'unspecified',
        'slice_layer_without_partitioning',
        'slice_data_partition_a_layer',
        'slice_data_partition_b_layer',
        'slice_data_partition_c_layer',
        'slice_layer_without_partitioning_idr',
        'sei',
        'seq_parameter_set',
        'pic_parameter_set',
        'access_unit_delimiter',
        'end_of_seq',
        'end_of_stream',
        'filler',
        'seq_parameter_set_ext',
        'prefix_nal_unit',
        'subset_seq_parameter_set',
        'reserved',
        'reserved',
        'reserved'
      ],
      compositionTime = (tag[1] & parseInt('01111111', 2) << 16) | (tag[2] << 8) | tag[3];

    obj = obj || {};

    obj.avcPacketType = avcPacketTypes[tag[0]];
    obj.CompositionTime = (tag[1] & parseInt('10000000', 2)) ? -compositionTime : compositionTime;

    if (tag[0] === 1) {
      obj.nalUnitTypeRaw = hexStringList(tag.subarray(4, 100));
    } else {
      obj.data = hexStringList(tag.subarray(4));
    }

    return obj;
  },
  parseVideoTag = function (tag, obj) {
    var
      frameTypes = [
        'Unknown',
        'Keyframe (for AVC, a seekable frame)',
        'Inter frame (for AVC, a nonseekable frame)',
        'Disposable inter frame (H.263 only)',
        'Generated keyframe (reserved for server use only)',
        'Video info/command frame'
      ],
      codecIDs = [
        'JPEG (currently unused)',
        'Sorenson H.263',
        'Screen video',
        'On2 VP6',
        'On2 VP6 with alpha channel',
        'Screen video version 2',
        'AVC'
      ],
      codecID = tag[0] & parseInt('00001111', 2);

    obj = obj || {};

    obj.frameType = frameTypes[(tag[0] & parseInt('11110000', 2)) >>> 4];
    obj.codecID = codecID;

    if (codecID === 7) {
      return parseAVCTag(tag.subarray(1), obj);
    }
    return obj;
  },
  parseAACTag = function (tag, obj) {
    var packetTypes = [
      'AAC Sequence Header',
      'AAC Raw'
    ];

    obj = obj || {};

    obj.aacPacketType = packetTypes[tag[0]];
    obj.data = hexStringList(tag.subarray(1));

    return obj;
  },
  parseAudioTag = function (tag, obj) {
    var
      formatTable = [
        'Linear PCM, platform endian',
        'ADPCM',
        'MP3',
        'Linear PCM, little endian',
        'Nellymoser 16-kHz mono',
        'Nellymoser 8-kHz mono',
        'Nellymoser',
        'G.711 A-law logarithmic PCM',
        'G.711 mu-law logarithmic PCM',
        'reserved',
        'AAC',
        'Speex',
        'MP3 8-Khz',
        'Device-specific sound'
      ],
      samplingRateTable = [
        '5.5-kHz',
        '11-kHz',
        '22-kHz',
        '44-kHz'
      ],
      soundFormat = (tag[0] & parseInt('11110000', 2)) >>> 4;

    obj = obj || {};

    obj.soundFormat = formatTable[soundFormat];
    obj.soundRate = samplingRateTable[(tag[0] & parseInt('00001100', 2)) >>> 2];
    obj.soundSize = ((tag[0] & parseInt('00000010', 2)) >>> 1) ? '16-bit' : '8-bit';
    obj.soundType = (tag[0] & parseInt('00000001', 2)) ? 'Stereo' : 'Mono';

    if (soundFormat === 10) {
      return parseAACTag(tag.subarray(1), obj);
    }
    return obj;
  },
  parseGenericTag = function (tag) {
    return {
      tagType: tagTypes[tag[0]],
      dataSize: (tag[1] << 16) | (tag[2] << 8) | tag[3],
      timestamp: (tag[7] << 24) | (tag[4] << 16) | (tag[5] << 8) | tag[6],
      streamID: (tag[8] << 16) | (tag[9] << 8) | tag[10]
    };
  },
  inspectFlvTag = function (tag) {
    var header = parseGenericTag(tag);
    switch (tag[0]) {
      case 0x08:
        parseAudioTag(tag.subarray(11), header);
        break;
      case 0x09:
        parseVideoTag(tag.subarray(11), header);
        break;
      case 0x12:
    }
    return header;
  },
  inspectFlv = function (bytes) {
    var i = 9, // header
        dataSize,
        parsedResults = [],
        tag;

    // traverse the tags
    i += 4; // skip previous tag size
    while (i < bytes.byteLength) {
      dataSize = bytes[i + 1] << 16;
      dataSize |= bytes[i + 2] << 8;
      dataSize |= bytes[i + 3];
      dataSize += 11;

      tag = bytes.subarray(i, i + dataSize);
      parsedResults.push(inspectFlvTag(tag));
      i += dataSize + 4;
    }
    return parsedResults;
  },
  textifyFlv = function (flvTagArray) {
    return JSON.stringify(flvTagArray, null, 2);
  };

window.muxjs = window.muxjs || {};
muxjs.tools = muxjs.tools || {};

muxjs.tools.inspectFlvTag = inspectFlvTag;
muxjs.tools.inspectFlv = inspectFlv;
muxjs.tools.textifyFlv = textifyFlv;

})(this, this.muxjs);
