'use strict';

var Stream = require('../utils/stream.js');
var ExpGolomb = require('../utils/exp-golomb.js');

var H264Stream, NalByteStream, H264StreamParser;
var PROFILES_WITH_OPTIONAL_SPS_DATA;
var NAL_UNIT_TYPES;

/**
 * Accepts a NAL unit byte stream and unpacks the embedded NAL units.
 */
NalByteStream = function() {
  var
    syncPoint = 0,
    i,
    buffer;
  NalByteStream.prototype.init.call(this);

  /*
   * Scans a byte stream and triggers a data event with the NAL units found.
   * @param {Object} data Event received from H264Stream
   * @param {Uint8Array} data.data The h264 byte stream to be scanned
   *
   * @see H264Stream.push
   */
  this.push = function(data) {
    var swapBuffer;

    if (!buffer) {
      buffer = data.data;
    } else {
      swapBuffer = new Uint8Array(buffer.byteLength + data.data.byteLength);
      swapBuffer.set(buffer);
      swapBuffer.set(data.data, buffer.byteLength);
      buffer = swapBuffer;
    }

    // Rec. ITU-T H.264, Annex B
    // scan for NAL unit boundaries

    // a match looks like this:
    // 0 0 1 .. NAL .. 0 0 1
    // ^ sync point        ^ i
    // or this:
    // 0 0 1 .. NAL .. 0 0 0
    // ^ sync point        ^ i

    // advance the sync point to a NAL start, if necessary
    for (; syncPoint < buffer.byteLength - 3; syncPoint++) {
      if (buffer[syncPoint + 2] === 1) {
        // the sync point is properly aligned
        i = syncPoint + 5;
        break;
      }
    }

    while (i < buffer.byteLength) {
      // look at the current byte to determine if we've hit the end of
      // a NAL unit boundary
      switch (buffer[i]) {
      case 0:
        // skip past non-sync sequences
        if (buffer[i - 1] !== 0) {
          i += 2;
          break;
        } else if (buffer[i - 2] !== 0) {
          i++;
          break;
        }

        // deliver the NAL unit if it isn't empty
        if (syncPoint + 3 !== i - 2) {
          this.trigger('data', buffer.subarray(syncPoint + 3, i - 2));
        }

        // drop trailing zeroes
        do {
          i++;
        } while (buffer[i] !== 1 && i < buffer.length);
        syncPoint = i - 2;
        i += 3;
        break;
      case 1:
        // skip past non-sync sequences
        if (buffer[i - 1] !== 0 ||
            buffer[i - 2] !== 0) {
          i += 3;
          break;
        }

        // deliver the NAL unit
        this.trigger('data', buffer.subarray(syncPoint + 3, i - 2));
        syncPoint = i - 2;
        i += 3;
        break;
      default:
        // the current byte isn't a one or zero, so it cannot be part
        // of a sync sequence
        i += 3;
        break;
      }
    }
    // filter out the NAL units that were delivered
    buffer = buffer.subarray(syncPoint);
    i -= syncPoint;
    syncPoint = 0;
  };

  this.flush = function() {
    // deliver the last buffered NAL unit
    if (buffer && buffer.byteLength > 3) {
      this.trigger('data', buffer.subarray(syncPoint + 3));
    }
    // reset the stream state
    buffer = null;
    syncPoint = 0;
    this.trigger('done');
  };
};
NalByteStream.prototype = new Stream();

// values of profile_idc that indicate additional fields are included in the SPS
// see Recommendation ITU-T H.264 (4/2013),
// 7.3.2.1.1 Sequence parameter set data syntax
PROFILES_WITH_OPTIONAL_SPS_DATA = {
  100: true,
  110: true,
  122: true,
  244: true,
  44: true,
  83: true,
  86: true,
  118: true,
  128: true,
  138: true,
  139: true,
  134: true
};

/**
 * Accepts input from a ElementaryStream and produces H.264 NAL unit data
 * events.
 */
H264Stream = function() {
  var
    nalByteStream = new NalByteStream(),
    self,
    trackId,
    currentPts,
    currentDts,

    discardEmulationPreventionBytes,
    readSequenceParameterSet,
    skipScalingList;

  H264Stream.prototype.init.call(this);
  self = this;

  /*
   * Pushes a packet from a stream onto the NalByteStream
   *
   * @param {Object} packet - A packet received from a stream
   * @param {Uint8Array} packet.data - The raw bytes of the packet
   * @param {Number} packet.dts - Decode timestamp of the packet
   * @param {Number} packet.pts - Presentation timestamp of the packet
   * @param {Number} packet.trackId - The id of the h264 track this packet came from
   * @param {('video'|'audio')} packet.type - The type of packet
   *
   */
  this.push = function(packet) {
    if (packet.type !== 'video') {
      return;
    }
    trackId = packet.trackId;
    currentPts = packet.pts;
    currentDts = packet.dts;

    nalByteStream.push(packet);
  };

  /*
   * Identify NAL unit types and pass on the NALU, trackId, presentation and decode timestamps
   * for the NALUs to the next stream component.
   * Also, preprocess caption and sequence parameter NALUs.
   *
   * @param {Uint8Array} data - A NAL unit identified by `NalByteStream.push`
   * @see NalByteStream.push
   */
  nalByteStream.on('data', function(data) {
    var
      event = {
        trackId: trackId,
        pts: currentPts,
        dts: currentDts,
        data: data
      };

    switch (data[0] & 0x1f) {
    case 0x05:
      event.nalUnitType = 'slice_layer_without_partitioning_rbsp_idr';
      break;
    case 0x06:
      event.nalUnitType = 'sei_rbsp';
      event.escapedRBSP = discardEmulationPreventionBytes(data.subarray(1));
      break;
    case 0x07:
      event.nalUnitType = 'seq_parameter_set_rbsp';
      event.escapedRBSP = discardEmulationPreventionBytes(data.subarray(1));
      event.config = readSequenceParameterSet(event.escapedRBSP);
      break;
    case 0x08:
      event.nalUnitType = 'pic_parameter_set_rbsp';
      break;
    case 0x09:
      event.nalUnitType = 'access_unit_delimiter_rbsp';
      break;

    default:
      break;
    }
    // This triggers data on the H264Stream
    self.trigger('data', event);
  });
  nalByteStream.on('done', function() {
    self.trigger('done');
  });

  this.flush = function() {
    nalByteStream.flush();
  };

  /**
   * Advance the ExpGolomb decoder past a scaling list. The scaling
   * list is optionally transmitted as part of a sequence parameter
   * set and is not relevant to transmuxing.
   * @param count {number} the number of entries in this scaling list
   * @param expGolombDecoder {object} an ExpGolomb pointed to the
   * start of a scaling list
   * @see Recommendation ITU-T H.264, Section 7.3.2.1.1.1
   */
  skipScalingList = function(count, expGolombDecoder) {
    var
      lastScale = 8,
      nextScale = 8,
      j,
      deltaScale;

    for (j = 0; j < count; j++) {
      if (nextScale !== 0) {
        deltaScale = expGolombDecoder.readExpGolomb();
        nextScale = (lastScale + deltaScale + 256) % 256;
      }

      lastScale = (nextScale === 0) ? lastScale : nextScale;
    }
  };

  /**
   * Expunge any "Emulation Prevention" bytes from a "Raw Byte
   * Sequence Payload"
   * @param data {Uint8Array} the bytes of a RBSP from a NAL
   * unit
   * @return {Uint8Array} the RBSP without any Emulation
   * Prevention Bytes
   */
  discardEmulationPreventionBytes = function(data) {
    var
      length = data.byteLength,
      emulationPreventionBytesPositions = [],
      i = 1,
      newLength, newData;

    // Find all `Emulation Prevention Bytes`
    while (i < length - 2) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0x03) {
        emulationPreventionBytesPositions.push(i + 2);
        i += 2;
      } else {
        i++;
      }
    }

    // If no Emulation Prevention Bytes were found just return the original
    // array
    if (emulationPreventionBytesPositions.length === 0) {
      return data;
    }

    // Create a new array to hold the NAL unit data
    newLength = length - emulationPreventionBytesPositions.length;
    newData = new Uint8Array(newLength);
    var sourceIndex = 0;

    for (i = 0; i < newLength; sourceIndex++, i++) {
      if (sourceIndex === emulationPreventionBytesPositions[0]) {
        // Skip this byte
        sourceIndex++;
        // Remove this position index
        emulationPreventionBytesPositions.shift();
      }
      newData[i] = data[sourceIndex];
    }

    return newData;
  };

  /**
   * Read a sequence parameter set and return some interesting video
   * properties. A sequence parameter set is the H264 metadata that
   * describes the properties of upcoming video frames.
   * @param data {Uint8Array} the bytes of a sequence parameter set
   * @return {object} an object with configuration parsed from the
   * sequence parameter set, including the dimensions of the
   * associated video frames.
   */
  readSequenceParameterSet = function(data) {
    var
      frameCropLeftOffset = 0,
      frameCropRightOffset = 0,
      frameCropTopOffset = 0,
      frameCropBottomOffset = 0,
      sarScale = 1,
      expGolombDecoder, profileIdc, levelIdc, profileCompatibility,
      chromaFormatIdc, picOrderCntType,
      numRefFramesInPicOrderCntCycle, picWidthInMbsMinus1,
      picHeightInMapUnitsMinus1,
      frameMbsOnlyFlag,
      scalingListCount,
      sarRatio,
      aspectRatioIdc,
      i;

    expGolombDecoder = new ExpGolomb(data);
    profileIdc = expGolombDecoder.readUnsignedByte(); // profile_idc
    profileCompatibility = expGolombDecoder.readUnsignedByte(); // constraint_set[0-5]_flag
    levelIdc = expGolombDecoder.readUnsignedByte(); // level_idc u(8)
    expGolombDecoder.skipUnsignedExpGolomb(); // seq_parameter_set_id

    // some profiles have more optional data we don't need
    if (PROFILES_WITH_OPTIONAL_SPS_DATA[profileIdc]) {
      chromaFormatIdc = expGolombDecoder.readUnsignedExpGolomb();
      if (chromaFormatIdc === 3) {
        expGolombDecoder.skipBits(1); // separate_colour_plane_flag
      }
      expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_luma_minus8
      expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_chroma_minus8
      expGolombDecoder.skipBits(1); // qpprime_y_zero_transform_bypass_flag
      if (expGolombDecoder.readBoolean()) { // seq_scaling_matrix_present_flag
        scalingListCount = (chromaFormatIdc !== 3) ? 8 : 12;
        for (i = 0; i < scalingListCount; i++) {
          if (expGolombDecoder.readBoolean()) { // seq_scaling_list_present_flag[ i ]
            if (i < 6) {
              skipScalingList(16, expGolombDecoder);
            } else {
              skipScalingList(64, expGolombDecoder);
            }
          }
        }
      }
    }

    expGolombDecoder.skipUnsignedExpGolomb(); // log2_max_frame_num_minus4
    picOrderCntType = expGolombDecoder.readUnsignedExpGolomb();

    if (picOrderCntType === 0) {
      expGolombDecoder.readUnsignedExpGolomb(); // log2_max_pic_order_cnt_lsb_minus4
    } else if (picOrderCntType === 1) {
      expGolombDecoder.skipBits(1); // delta_pic_order_always_zero_flag
      expGolombDecoder.skipExpGolomb(); // offset_for_non_ref_pic
      expGolombDecoder.skipExpGolomb(); // offset_for_top_to_bottom_field
      numRefFramesInPicOrderCntCycle = expGolombDecoder.readUnsignedExpGolomb();
      for (i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
        expGolombDecoder.skipExpGolomb(); // offset_for_ref_frame[ i ]
      }
    }

    expGolombDecoder.skipUnsignedExpGolomb(); // max_num_ref_frames
    expGolombDecoder.skipBits(1); // gaps_in_frame_num_value_allowed_flag

    picWidthInMbsMinus1 = expGolombDecoder.readUnsignedExpGolomb();
    picHeightInMapUnitsMinus1 = expGolombDecoder.readUnsignedExpGolomb();

    frameMbsOnlyFlag = expGolombDecoder.readBits(1);
    if (frameMbsOnlyFlag === 0) {
      expGolombDecoder.skipBits(1); // mb_adaptive_frame_field_flag
    }

    expGolombDecoder.skipBits(1); // direct_8x8_inference_flag
    if (expGolombDecoder.readBoolean()) { // frame_cropping_flag
      frameCropLeftOffset = expGolombDecoder.readUnsignedExpGolomb();
      frameCropRightOffset = expGolombDecoder.readUnsignedExpGolomb();
      frameCropTopOffset = expGolombDecoder.readUnsignedExpGolomb();
      frameCropBottomOffset = expGolombDecoder.readUnsignedExpGolomb();
    }
    if (expGolombDecoder.readBoolean()) {
      // vui_parameters_present_flag
      if (expGolombDecoder.readBoolean()) {
        // aspect_ratio_info_present_flag
        aspectRatioIdc = expGolombDecoder.readUnsignedByte();
        switch (aspectRatioIdc) {
          case 1: sarRatio = [1, 1]; break;
          case 2: sarRatio = [12, 11]; break;
          case 3: sarRatio = [10, 11]; break;
          case 4: sarRatio = [16, 11]; break;
          case 5: sarRatio = [40, 33]; break;
          case 6: sarRatio = [24, 11]; break;
          case 7: sarRatio = [20, 11]; break;
          case 8: sarRatio = [32, 11]; break;
          case 9: sarRatio = [80, 33]; break;
          case 10: sarRatio = [18, 11]; break;
          case 11: sarRatio = [15, 11]; break;
          case 12: sarRatio = [64, 33]; break;
          case 13: sarRatio = [160, 99]; break;
          case 14: sarRatio = [4, 3]; break;
          case 15: sarRatio = [3, 2]; break;
          case 16: sarRatio = [2, 1]; break;
          case 255: {
            sarRatio = [expGolombDecoder.readUnsignedByte() << 8 |
                        expGolombDecoder.readUnsignedByte(),
                        expGolombDecoder.readUnsignedByte() << 8 |
                        expGolombDecoder.readUnsignedByte() ];
            break;
          }
        }
        if (sarRatio) {
          sarScale = sarRatio[0] / sarRatio[1];
        }
      }
    }
    return {
      profileIdc: profileIdc,
      levelIdc: levelIdc,
      profileCompatibility: profileCompatibility,
      width: Math.ceil((((picWidthInMbsMinus1 + 1) * 16) - frameCropLeftOffset * 2 - frameCropRightOffset * 2) * sarScale),
      height: ((2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16) - (frameCropTopOffset * 2) - (frameCropBottomOffset * 2)
    };
  };

};
H264Stream.prototype = new Stream();

NAL_UNIT_TYPES = {
  UNSPECIFIED: 0,
  CODED_SLICE_NON_IDR: 1,
  CODED_SLICE_DATA_PARTITION_A: 2,
  CODED_SLICE_DATA_PARTITION_B: 3,
  CODED_SLICE_DATA_PARTITION_C: 4,
  CODED_SLICE_IDR: 5,
  SEI: 6,
  SPS: 7,
  PPS: 8,
  AUD: 9,
  END_OF_SEQUENCE: 10,
  END_OF_STREAM: 11,
  FILLER: 12,
  SPS_EXT: 13,
  CODED_SLICE_AUX: 19
};

H264StreamParser = function() {
  var
    self = this,
    buffer,
    iterator = 0,
    startNalPosition = -1,
    prevNalPosition = -1,
    nalPosition = -1,
    trackId = 1,
    lastDts = 0,
    frameCounter = 0,
    separateColourPlaneFlag,
    frameMbsOnlyFlag = 0,
    picOrderCntType = 0,
    picOrderCntLsbLength = 4,
    log2MaxFrameNumMinus4Length = 4,
    framerate = 90000 / 30, // initial 30 FPS, later read from SPS
    prevPicOrderCntMsb = 0,
    prevPicOrderCntLsb = 0,
    maxPicOrderCntLsb,
    bottomFieldPicOrderInFramePresentFlag = 0, // inital 0, later read from PPS
    bytesDeliveredPosition = 0,
    audEntry = [0, 0, 0, 1, 9, 240],
    idrPicFlag = 0;

  H264StreamParser.prototype.init.call(this);

  this.push = function(data) {
    var swapBuffer,
        nalUnitType,
        nalDataSps,
        spsInfo,
        nalDataPps,
        maxNeededEndSliceLayer,
        shInfo,
        TopFieldOrderCnt,
        BottomFieldOrderCnt,
        PicOrderCntMsb,
        PicOrderCnt,
        pts,
        dts,
        extBuffer,
        packetData;

    if (!buffer) {
      buffer = data;
    } else {
      swapBuffer = new Uint8Array(buffer.byteLength + data.byteLength -
          bytesDeliveredPosition);
      swapBuffer.set(buffer.subarray(bytesDeliveredPosition));
      swapBuffer.set(data, buffer.byteLength - bytesDeliveredPosition);
      buffer = swapBuffer;
      prevNalPosition = prevNalPosition - bytesDeliveredPosition;
      startNalPosition = startNalPosition - bytesDeliveredPosition;
      iterator = iterator - bytesDeliveredPosition;
      bytesDeliveredPosition = 0;
    }

    if (startNalPosition === -1) {
      this.findFirstNalSyncPoint();
    }

    // Now startNalPosition should be correct. Else need more data
    if (startNalPosition === -1) {
      return;
    }

    // find next
    while (this.findNextNalSyncPoint()) {
      nalUnitType = buffer[prevNalPosition + 3] & 0x1F;
      idrPicFlag = (nalUnitType === NAL_UNIT_TYPES.CODED_SLICE_IDR);


      if (nalUnitType === NAL_UNIT_TYPES.SPS) {
        nalDataSps = buffer.subarray(prevNalPosition + 3 + 1, nalPosition);
        spsInfo = this.readSeqParameterSetData(nalDataSps);

        // TODO what to do when framerate changes?
        framerate = 90000 / ((spsInfo.timeScale / spsInfo.numUnitsInTick) / 2);
      }
      if (nalUnitType === NAL_UNIT_TYPES.PPS) {
        nalDataPps = buffer.subarray(prevNalPosition + 3 + 1, nalPosition);
        this.readPicParameterSetRbsp(nalDataPps);
      }
      if (nalUnitType <= NAL_UNIT_TYPES.CODED_SLICE_IDR) {

        if (nalUnitType !== NAL_UNIT_TYPES.CODED_SLICE_IDR &&
            nalUnitType !== NAL_UNIT_TYPES.CODED_SLICE_NON_IDR) {
          // currently H264StreamParser supports only
          // CODED_SLICE_IDR and CODED_SLICE_NON_IDR
          // TODO add error report here
          return;
        }

        maxNeededEndSliceLayer = (nalPosition - prevNalPosition > 32) ?
            prevNalPosition + 32 : nalPosition;
        shInfo = this.readSliceLayerWithoutPartitioningRbsp(
            buffer.subarray(prevNalPosition + 3 + 1, maxNeededEndSliceLayer));

        TopFieldOrderCnt = 0;
        BottomFieldOrderCnt = 0;
        PicOrderCntMsb = 0;
        PicOrderCnt = 0;
        if (nalUnitType === NAL_UNIT_TYPES.CODED_SLICE_IDR) {
          lastDts = lastDts + frameCounter * framerate;
          frameCounter = 1;
          prevPicOrderCntMsb = 0;
          prevPicOrderCntLsb = 0;
        }
        // compute PicOrderCntMsb, TopFieldOrderCnt according to
        // 8.2.1.1 Decoding process for picture order count type 0
        if (nalUnitType === NAL_UNIT_TYPES.CODED_SLICE_NON_IDR) {
          frameCounter++;
          if ((shInfo.picOrderCntLsb < prevPicOrderCntLsb) &&
              ((prevPicOrderCntLsb - shInfo.picOrderCntLsb) >= (maxPicOrderCntLsb / 2))) {
            PicOrderCntMsb = prevPicOrderCntMsb + maxPicOrderCntLsb;
          } else if ((shInfo.picOrderCntLsb > prevPicOrderCntLsb) &&
              ((shInfo.picOrderCntLsb - prevPicOrderCntLsb) > (maxPicOrderCntLsb / 2))) {
            PicOrderCntMsb = prevPicOrderCntMsb - maxPicOrderCntLsb;
          } else {
            PicOrderCntMsb = prevPicOrderCntMsb;
          }
          TopFieldOrderCnt = PicOrderCntMsb + shInfo.picOrderCntLsb;
          if (!shInfo.fieldPicFlag) {
            BottomFieldOrderCnt = TopFieldOrderCnt + shInfo.deltaPicOrderCntBottom;
          } else {
            BottomFieldOrderCnt = PicOrderCntMsb + shInfo.picOrderCntLsb;
          }
          PicOrderCnt = Math.min(TopFieldOrderCnt, BottomFieldOrderCnt);
        }

        prevPicOrderCntMsb = PicOrderCntMsb;
        prevPicOrderCntLsb = shInfo.picOrderCntLsb;

        dts = lastDts + (frameCounter - 1) * framerate;
        pts = lastDts + (PicOrderCnt / 2) * framerate;

        extBuffer = new Uint8Array(nalPosition - startNalPosition + audEntry.length);
        extBuffer.set(audEntry);
        extBuffer.set(buffer.subarray(startNalPosition, nalPosition), audEntry.length);

        packetData = extBuffer;
        startNalPosition = nalPosition;
        bytesDeliveredPosition = startNalPosition;

        if (nalUnitType === NAL_UNIT_TYPES.CODED_SLICE_IDR) { // I-frame
          if (lastDts > 0) { // and not the first one
            // flush the rest of pipeline then add packet with new I-frame
            self.flush();
          }
        }

        var event = {
          type: 'video',
          trackId: trackId,
          pts: pts,
          dts: dts,
          data: packetData
        };

        self.trigger('data', event);
      }
      prevNalPosition = nalPosition;
    }
  };

  this.findFirstNalSyncPoint = function() {
    var i = 0;

    for (; i < buffer.byteLength - 3; i++) {
      if (buffer[i] === 0 &&
          buffer[i + 1] === 0 &&
          buffer[i + 2 ] === 1) {
        nalPosition = prevNalPosition = startNalPosition = i;
        break;
      }
    }
    iterator = i;
  };

  this.findNextNalSyncPoint = function() {
    var i = iterator + 4;

    for (; i < buffer.byteLength - 3; i++) {
      if ((buffer[i] === 0) &&
           buffer[i + 1] === 0 &&
           buffer[i + 2] === 1) {
        nalPosition = i;
        iterator = i;
        return true;
      }
    }
    iterator = i;
    return false;
  };

  this.removeEmulationPreventionByte = function(data) {
    var tmpBuffer = new Uint8Array(data.byteLength);
    var i, startByte = 0, totalBytes = 0;

    for (i = 0; i < tmpBuffer.byteLength - 2; i++) {
      if (data[i] === 0 &&
          data[i + 1] === 0 &&
          data[i + 2] === 3) {
          // remove emulation prevention
            tmpBuffer.set(data.subarray(startByte, i + 2), totalBytes);
            totalBytes += i + 2 - startByte;
            startByte = i + 3;
            i += 2;
            continue;
      }
    }
    tmpBuffer.set(data.subarray(startByte, i + 2), totalBytes);
    return tmpBuffer;
  };

  /**
   * Advance the ExpGolomb decoder past a scaling list. The scaling
   * list is optionally transmitted as part of a sequence parameter
   * set and is not relevant to transmuxing.
   * @param count {number} the number of entries in this scaling list
   * @param expGolombDecoder {object} an ExpGolomb pointed to the
   * start of a scaling list
   * @see Recommendation ITU-T H.264, Section 7.3.2.1.1.1
   */
  this.skipScalingList = function(count, expGolombDecoder) {
    var
      lastScale = 8,
      nextScale = 8,
      j,
      deltaScale;

    for (j = 0; j < count; j++) {
      if (nextScale !== 0) {
        deltaScale = expGolombDecoder.readExpGolomb();
        nextScale = (lastScale + deltaScale + 256) % 256;
      }

      lastScale = (nextScale === 0) ? lastScale : nextScale;
    }
  };

  this.readSeqParameterSetData = function(dataEm) {
    var
      expGolombDecoder, profileIdc,
      chromaFormatIdc,
      numRefFramesInPicOrderCntCycle,
      scalingListCount,
      aspectRatioIdc,
      numUnitsInTick,
      timeScale = -1,
      fixedFrameRateFlag = -1,
      log2MaxPicOrderCntLsbMinus4,
      i,
      data;

    data = this.removeEmulationPreventionByte(dataEm);
    separateColourPlaneFlag = 0;

    expGolombDecoder = new ExpGolomb(data);

    profileIdc = expGolombDecoder.readUnsignedByte(); // profile_idc
    expGolombDecoder.skipBits(8); // constraint_set[0-5]_flag
    expGolombDecoder.skipBits(8); // level_idc u(8)
    expGolombDecoder.skipUnsignedExpGolomb(); // seq_parameter_set_id

    // some profiles have more optional data we don't need
    if (PROFILES_WITH_OPTIONAL_SPS_DATA[profileIdc]) {
      chromaFormatIdc = expGolombDecoder.readUnsignedExpGolomb();
      if (chromaFormatIdc === 3) {
        separateColourPlaneFlag = expGolombDecoder.readBits(1); // separate_colour_plane_flag
      }
      expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_luma_minus8
      expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_chroma_minus8
      expGolombDecoder.skipBits(1); // qpprime_y_zero_transform_bypass_flag
      if (expGolombDecoder.readBoolean()) { // seq_scaling_matrix_present_flag
        scalingListCount = (chromaFormatIdc !== 3) ? 8 : 12;
        for (i = 0; i < scalingListCount; i++) {
          if (expGolombDecoder.readBoolean()) { // seq_scaling_list_present_flag[ i ]
            if (i < 6) {
              this.skipScalingList(16, expGolombDecoder);
            } else {
              this.skipScalingList(64, expGolombDecoder);
            }
          }
        }
      }
    }

    log2MaxFrameNumMinus4Length = expGolombDecoder.readUnsignedExpGolomb() + 4; // log2_max_frame_num_minus4
    picOrderCntType = expGolombDecoder.readUnsignedExpGolomb(); // pic_order_cnt_type

    if (picOrderCntType === 0) {
      log2MaxPicOrderCntLsbMinus4 = expGolombDecoder.readUnsignedExpGolomb(); // log2_max_pic_order_cnt_lsb_minus4
    } else if (picOrderCntType === 1) {
      expGolombDecoder.skipBits(1); // delta_pic_order_always_zero_flag
      expGolombDecoder.skipExpGolomb(); // offset_for_non_ref_pic
      expGolombDecoder.skipExpGolomb(); // offset_for_top_to_bottom_field
      numRefFramesInPicOrderCntCycle = expGolombDecoder.readUnsignedExpGolomb();
      for (i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
        expGolombDecoder.skipExpGolomb(); // offset_for_ref_frame[ i ]
      }
    }

    expGolombDecoder.skipUnsignedExpGolomb(); // max_num_ref_frames
    expGolombDecoder.skipBits(1); // gaps_in_frame_num_value_allowed_flag

    expGolombDecoder.skipExpGolomb(); // pic_width_in_mbs_minus1
    expGolombDecoder.skipExpGolomb(); // pic_height_in_map_units_minus1

    frameMbsOnlyFlag = expGolombDecoder.readBits(1); // frame_mbs_only_flag
    if (frameMbsOnlyFlag === 0) {
      expGolombDecoder.skipBits(1); // mb_adaptive_frame_field_flag
    }

    expGolombDecoder.skipBits(1); // direct_8x8_inference_flag
    if (expGolombDecoder.readBoolean()) { // frame_cropping_flag
      expGolombDecoder.skipExpGolomb(); // frame_crop_left_offset
      expGolombDecoder.skipExpGolomb(); // frame_crop_right_offset
      expGolombDecoder.skipExpGolomb(); // frame_crop_top_offset
      expGolombDecoder.skipExpGolomb(); // frame_crop_bottom_offset
    }
    if (expGolombDecoder.readBoolean()) {
      // vui_parameters_present_flag
      if (expGolombDecoder.readBoolean()) {
        // aspect_ratio_info_present_flag
        aspectRatioIdc = expGolombDecoder.readUnsignedByte();
        switch (aspectRatioIdc) {
          case 255: {
            expGolombDecoder.skipBits(16); // sar_width
            expGolombDecoder.skipBits(16); // sar_height
            break;
          }
        }
      }
      if (expGolombDecoder.readBoolean()) {
        // overscan_info_present_flag
        expGolombDecoder.skipBits(1); // overscan_appropriate_flag
      }
      if (expGolombDecoder.readBoolean()) {
        // video_signal_type_present_flag
        expGolombDecoder.skipBits(3); // video_format
        expGolombDecoder.skipBits(1); // video_full_range_flag
        if (expGolombDecoder.readBoolean()) {
        // colour_description_present_flag
          expGolombDecoder.skipBits(8); // colour_primaries
          expGolombDecoder.skipBits(8); // transfer_characteristics
          expGolombDecoder.skipBits(8); // matrix_coefficients
        }
      }
      if (expGolombDecoder.readBoolean()) {
        // chroma_loc_info_present_flag
        expGolombDecoder.readUnsignedExpGolomb(); // chroma_sample_loc_type_top_field
        expGolombDecoder.readUnsignedExpGolomb(); // chroma_sample_loc_type_bottom_field
      }
      if (expGolombDecoder.readBoolean()) {
        // timing_info_present_flag
        numUnitsInTick = expGolombDecoder.readUnsignedByte() << 24 | // num_units_in_tick u(32)
          expGolombDecoder.readUnsignedByte() << 16 |
          expGolombDecoder.readUnsignedByte() << 8 |
          expGolombDecoder.readUnsignedByte();
        timeScale = expGolombDecoder.readUnsignedByte() << 24 | // time_scale u(32)
          expGolombDecoder.readUnsignedByte() << 16 |
          expGolombDecoder.readUnsignedByte() << 8 |
          expGolombDecoder.readUnsignedByte();
        fixedFrameRateFlag = expGolombDecoder.readBoolean(); // fixed_frame_rate_flag
      }
    }
    maxPicOrderCntLsb = Math.pow(2, log2MaxPicOrderCntLsbMinus4 + 4);
    picOrderCntLsbLength = log2MaxPicOrderCntLsbMinus4 + 4;
    return {
      numUnitsInTick: numUnitsInTick,
      timeScale: timeScale,
      fixedFrameRateFlag: fixedFrameRateFlag
    };
  };

  this.readPicParameterSetRbsp = function(data) {
    var expGolombDecoder = new ExpGolomb(data);

    expGolombDecoder.skipExpGolomb(); // pic_parameter_set_id
    expGolombDecoder.skipExpGolomb(); // seq_parameter_set_id
    expGolombDecoder.skipBits(1); // entropy_coding_mode_flag
    bottomFieldPicOrderInFramePresentFlag = expGolombDecoder.readBoolean(); // bottom_field_pic_order_in_frame_present_flag
  };

  this.readSliceLayerWithoutPartitioningRbsp = function(data) {
    var
      fieldPicFlag = 0,
      deltaPicOrderCntBottom = 0,
      picOrderCntLsb = -1;

    var expGolombDecoder = new ExpGolomb(data);

    expGolombDecoder.skipExpGolomb(); // first_mb_in_slice
    expGolombDecoder.skipExpGolomb(); // slice_type
    expGolombDecoder.skipExpGolomb(); // pic_parameter_set_id
    if (separateColourPlaneFlag) {
      expGolombDecoder.skipBits(2); // colour_plane_id
    }
    expGolombDecoder.skipBits(log2MaxFrameNumMinus4Length); // frame_num
    if (!frameMbsOnlyFlag) {
      fieldPicFlag = expGolombDecoder.readBits(1); // field_pic_flag
      if (fieldPicFlag) {
        expGolombDecoder.skipBits(1); // bottom_field_flag
      }
    }
    if (idrPicFlag) {
      expGolombDecoder.skipExpGolomb(); // idr_pic_id
    }
    if (!picOrderCntType) {
      picOrderCntLsb = expGolombDecoder.readBits(picOrderCntLsbLength); // pic_order_cnt_lsb
      if (bottomFieldPicOrderInFramePresentFlag && !fieldPicFlag) {
        deltaPicOrderCntBottom = expGolombDecoder.readExpGolomb(); // delta_pic_order_cnt_bottom
      }
    }
    return {
      picOrderCntLsb: picOrderCntLsb,
      fieldPicFlag: fieldPicFlag,
      deltaPicOrderCntBottom: deltaPicOrderCntBottom
    };
  };
};

H264StreamParser.prototype = new Stream();

module.exports = {
  H264Stream: H264Stream,
  NalByteStream: NalByteStream,
  H264StreamParser: H264StreamParser
};
