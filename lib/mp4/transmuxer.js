/**
 * mux.js
 *
 * Copyright (c) 2015 Brightcove
 * All rights reserved.
 *
 * A stream-based mp2t to mp4 converter. This utility can be used to
 * deliver mp4s to a SourceBuffer on platforms that support native
 * Media Source Extensions.
 */
'use strict';

var Stream = require('../utils/stream.js');
var mp4 = require('./mp4-generator.js');
var m2ts = require('../m2ts/m2ts.js');
var AacStream = require('../codecs/aac.js');
var H264Stream = require('../codecs/h264').H264Stream;

// object types
var VideoSegmentStream, AudioSegmentStream, Transmuxer, CoalesceStream;

// Helper functions
var collectDtsInfo, clearDtsInfo, calculateTrackBaseMediaDecodeTime, sumByteLengths;

/**
 * Sum the `byteLength` of a specific property in an array of objects
 */
sumByteLengths = function(array, property) {
  var
    i,
    currentObj,
    sum = 0;

  // sum the byteLength's all each nal unit in the frame
  for (i = 0; i < array.length; i++) {
    currentObj = array[i];
    sum += currentObj[property].byteLength;
  }

  return sum;
};

/**
 * Constructs a single-track, ISO BMFF media segment from AAC data
 * events. The output of this stream can be fed to a SourceBuffer
 * configured with a suitable initialization segment.
 */
AudioSegmentStream = function(track) {
  var
    aacFrames = [],
    sequenceNumber = 0,
    earliestAllowedDts = 0;

  AudioSegmentStream.prototype.init.call(this);

  this.push = function(data) {
    collectDtsInfo(track, data);

    if (track) {
      track.audioobjecttype = data.audioobjecttype;
      track.channelcount = data.channelcount;
      track.samplerate = data.samplerate;
      track.samplingfrequencyindex = data.samplingfrequencyindex;
      track.samplesize = data.samplesize;
    }

    // buffer audio data until end() is called
    aacFrames.push(data);
  };

  this.setEarliestDts = function(earliestDts) {
    earliestAllowedDts = earliestDts - track.timelineStartInfo.baseMediaDecodeTime;
  };

  this.flush = function() {
    var
      frames,
      moof,
      mdat,
      boxes;

    // return early if no audio data has been observed
    if (aacFrames.length === 0) {
      this.trigger('done');
      return;
    }

    frames = this.trimAacFramesByEarliestDts_(aacFrames);

    // we have to build the index from byte locations to
    // samples (that is, aac frames) in the audio data
    track.samples = this.generateSampleTable_(frames);

    // concatenate the audio data to constuct the mdat
    mdat = mp4.mdat(this.concatenateFrameData_(frames));

    aacFrames = [];

    calculateTrackBaseMediaDecodeTime(track);
    moof = mp4.moof(sequenceNumber, [track]);
    boxes = new Uint8Array(moof.byteLength + mdat.byteLength);

    // bump the sequence number for next time
    sequenceNumber++;

    boxes.set(moof);
    boxes.set(mdat, moof.byteLength);

    clearDtsInfo(track);

    this.trigger('data', {track: track, boxes: boxes});
    this.trigger('done');
  };

  // If the audio segment extends before the earliest allowed dts
  // value, remove AAC frames until starts at or after the earliest
  // allowed DTS
  this.trimAacFramesByEarliestDts_ = function(aacFrames) {
    if (track.minSegmentDts < earliestAllowedDts) {
      // We will need to recalculate the earliest segment Dts
      track.minSegmentDts = Infinity;

      return aacFrames.filter(function(currentFrame) {
        // If this is an allowed frame, keep it and record it's Dts
        if (currentFrame.dts >= earliestAllowedDts) {
          track.minSegmentDts = Math.min(track.minSegmentDts, currentFrame.dts);
          track.minSegmentPts = track.minSegmentDts;
          return true;
        }
        // Otherwise, discard it
        return false;
      });
    } else {
      return aacFrames;
    }
  };

  // generate the track's raw mdat data from an array of frames
  this.generateSampleTable_ = function(frames) {
    var
      i,
      currentFrame,
      samples = [];

    for (i = 0; i < frames.length; i++) {
      currentFrame = frames[i];

      samples.push({
        size: currentFrame.data.byteLength,
        duration: 1024 // For AAC audio, all samples contain 1024 samples
      });
    }
    return samples;
  };

  // generate the track's sample table from an array of frames
  this.concatenateFrameData_ = function(frames) {
    var
      i,
      currentFrame,
      dataOffset = 0,
      data = new Uint8Array(sumByteLengths(frames, 'data'));

    for (i = 0; i < frames.length; i++) {
      currentFrame = frames[i];

      data.set(currentFrame.data, dataOffset);
      dataOffset += currentFrame.data.byteLength;
    }
    return data;
  };
};

AudioSegmentStream.prototype = new Stream();

/**
 * Constructs a single-track, ISO BMFF media segment from H264 data
 * events. The output of this stream can be fed to a SourceBuffer
 * configured with a suitable initialization segment.
 * @param track {object} track metadata configuration
 */
VideoSegmentStream = function(track) {
  var
    sequenceNumber = 0,
    nalUnits = [],
    lastGop,
    config,
    pps;

  VideoSegmentStream.prototype.init.call(this);

  delete track.minPTS;

  this.maybeUseLastGop_ = function (nalUnit) {
    var ptsDistance;

    if (lastGop && lastGop.length) {
      ptsDistance = nalUnit.pts - lastGop[0].pts;

      // We only consider the lastGop valid for the current segment
      // if the lastGop is earlier in time than the first nal unit
      // and the lastGop is within 10 seconds (90k * 10) of the first
      // nal unit
      if (ptsDistance > 0 && ptsDistance <= 900000) {
        console.log('nals in last gop:', lastGop.length);
        lastGop.forEach(collectDtsInfo.bind(null, track));
        nalUnits = lastGop;
      } else {
        console.log('distance too large:', ptsDistance);
      }

      // 'delete' the lastGop
      lastGop = null;
    }
  };

  this.push = function(nalUnit) {
    this.maybeUseLastGop_(nalUnit);

    collectDtsInfo(track, nalUnit);

    // record the track config
    if (nalUnit.nalUnitType === 'seq_parameter_set_rbsp' &&
        !config) {
      config = nalUnit.config;

      track.width = config.width;
      track.height = config.height;
      track.sps = [nalUnit.data];
      track.profileIdc = config.profileIdc;
      track.levelIdc = config.levelIdc;
      track.profileCompatibility = config.profileCompatibility;
    }

    if (nalUnit.nalUnitType === 'pic_parameter_set_rbsp' &&
        !pps) {
      pps = nalUnit.data;
      track.pps = [nalUnit.data];
    }

    // buffer video until flush() is called
    nalUnits.push(nalUnit);
  };

  this.flush = function() {
    var
      frames,
      gops,
      moof,
      mdat,
      boxes;

    // Throw away nalUnits at the start of the byte stream until
    // we find the first AUD
    while (nalUnits.length) {
      if (nalUnits[0].nalUnitType === 'access_unit_delimiter_rbsp') {
        break;
      }
      nalUnits.shift();
    }

    // return early if no video data has been observed
    if (nalUnits.length === 0) {
      this.trigger('done');
      return;
    }

    // organize the raw nal units into arrays that represent
    // higher-level constructs
    frames = this.groupNalsIntoFrames_(nalUnits);

    // filter out any frames that exist before the first i-frame
    frames = this.filterLeadingNonIFrames_(frames);

    gops = this.groupFramesIntoGops_(frames);

    // first, we have to build the index from byte locations to
    // samples (that is, frames) in the video data
    track.samples = this.generateSampleTable_(frames);

    // concatenate the video data and construct the mdat
    mdat = mp4.mdat(this.concatenateNalData_(frames));

    // Save all the nals in the last GOP for later
    lastGop = gops.pop().reduce(function(a, b) { return a.concat(b); }, []);
    nalUnits = [];

    calculateTrackBaseMediaDecodeTime(track);

    this.trigger('timelineStartInfo', track.timelineStartInfo);

    moof = mp4.moof(sequenceNumber, [track]);

    // it would be great to allocate this array up front instead of
    // throwing away hundreds of media segment fragments
    boxes = new Uint8Array(moof.byteLength + mdat.byteLength);

    // bump the sequence number for next time
    sequenceNumber++;

    boxes.set(moof);
    boxes.set(mdat, moof.byteLength);

    clearDtsInfo(track);
    this.trigger('data', {track: track, boxes: boxes});

    // reset config and pps because they may differ across segments
    // for instance, when we are rendition switching
    config = undefined;
    pps = undefined;

    // Continue with the flush process now
    this.trigger('done');
  };

  // create the default sample
  // see ISO/IEC 14496-12:2012, section 8.6.4.3
  this.createDefaultSample_ = function() {
    return {
      size: 0,
      flags: {
        isLeading: 0,
        dependsOn: 1,
        isDependedOn: 0,
        hasRedundancy: 0,
        degradationPriority: 0
      }
    };
  };

  // search an array of nal units to see if it qualifies as an i-frame (actually, IDR)
  this.frameIsIFrame_ = function(frame) {
    var
      i,
      currentNal;

    for (i = 0; i < frame.length; i++) {
      currentNal = frame[i];

      if (currentNal.nalUnitType === 'slice_layer_without_partitioning_rbsp_idr') {
        return true;
      }
    }
    return false;
  };

  this.filterLeadingNonIFrames_ = function(frames) {
    var
      i,
      currentFrame,
      initialPts = frames[0][0].pts;

    for (i = 0; i < frames.length; i++) {
      currentFrame = frames[i];
      if (this.frameIsIFrame_(currentFrame)) {
        currentFrame[0].pts = initialPts;
        break;
      }
    }
    return frames.slice(i);
  };

  // convert an array of nal units into an array of frames with each frame being
  // composed of the nal units that make up that frame
  this.groupNalsIntoFrames_ = function(nalUnits) {
    var
      i,
      currentNal,
      currentFrame,
      frames = [];

    for (i = 0; i < nalUnits.length; i++) {
      currentNal = nalUnits[i];

      if (currentNal.nalUnitType === 'access_unit_delimiter_rbsp') {
        if (currentFrame && currentFrame.length) {
          frames.push(currentFrame);
        }

        currentFrame = [currentNal];
      } else {
        currentFrame.push(currentNal);
      }
    }
    // push the final frame
    frames.push(currentFrame);
    return frames;
  };

  // convert an array of frames into an array of Gop with each Gop being
  // composed of the frames that make up that Gop
  this.groupFramesIntoGops_ = function(frames) {
    var
      i,
      currentFrame,
      currentGop = [],
      gops = [];

    for (i = 0; i < frames.length; i++) {
      currentFrame = frames[i];

      if (this.frameIsIFrame_(currentFrame)) {
        if (currentGop && currentGop.length) {
          gops.push(currentGop);
        }

        currentGop = [currentFrame];
      } else {
        currentGop.push(currentFrame);
      }
    }
    // push the final Gop
    gops.push(currentGop);
    return gops;
  };

  // generate the track's sample table from an array of frames
  this.generateSampleTable_ = function(frames, baseDataOffset) {
    var
      i,
      sample,
      currentFrame,
      nextFrame,
      firstNal,
      lastNal,
      frameDataSize,
      currentSample,
      dataOffset = baseDataOffset || 0,
      samples = [];

    for (i = 0; i < frames.length; i++) {
      currentFrame = frames[i];
      nextFrame = frames[i + 1];

      firstNal = currentFrame[0];
      lastNal = currentFrame[currentFrame.length - 1];
      frameDataSize = sumByteLengths(currentFrame, 'data');

      sample = this.createDefaultSample_();
      sample.dataOffset = dataOffset;
      sample.compositionTimeOffset = firstNal.pts - firstNal.dts;

      if (nextFrame) {
        sample.duration = nextFrame[0].pts - firstNal.pts;
      } else {
        sample.duration = lastNal.pts - firstNal.pts;

        if (sample.duration === 0 &&
            samples.length > 0) {
          // for the last frame, copy the duration of the previous
          // frame
          sample.duration = samples[samples.length - 1].duration;
        }
      }

      sample.size = 4 * currentFrame.length; // Space for nal unit size
      sample.size += frameDataSize;

      if (this.frameIsIFrame_(currentFrame)) {
        sample.flags.dependsOn = 2;
      }

      dataOffset += sample.size;

      samples.push(sample);
    }
    return samples;
  };

  // generate the track's raw mdat data from an array of frames
  this.concatenateNalData_ = function (frames) {
    var
      i, j,
      currentFrame,
      currentNal,
      dataOffset = 0,
      nalsByteLength = frames.reduce(function(v, frame) {return v + sumByteLengths(frame, 'data'); }, 0),
      numberOfNals = frames.reduce(function(v, frame) { return v + frame.length; }, 0),
      totalByteLength = nalsByteLength + 4 * numberOfNals,
      data = new Uint8Array(totalByteLength),
      view = new DataView(data.buffer);

    for (i = 0; i < frames.length; i++) {
      currentFrame = frames[i];

      for (j = 0; j < currentFrame.length; j++) {
        currentNal = currentFrame[j];

        view.setUint32(dataOffset, currentNal.data.byteLength);
        dataOffset += 4;
        data.set(currentNal.data, dataOffset);
        dataOffset += currentNal.data.byteLength;
      }
    }
    return data;
  };
};

VideoSegmentStream.prototype = new Stream();

/**
 * Store information about the start and end of the track and the
 * duration for each frame/sample we process in order to calculate
 * the baseMediaDecodeTime
 */
collectDtsInfo = function (track, data) {
  if (typeof data.pts === 'number') {
    if (track.timelineStartInfo.pts === undefined) {
      track.timelineStartInfo.pts = data.pts;
    }

    if (track.minSegmentPts === undefined) {
      track.minSegmentPts = data.pts;
    } else {
      track.minSegmentPts = Math.min(track.minSegmentPts, data.pts);
    }

    if (track.maxSegmentPts === undefined) {
      track.maxSegmentPts = data.pts;
    } else {
      track.maxSegmentPts = Math.max(track.maxSegmentPts, data.pts);
    }
  }

  if (typeof data.dts === 'number') {
    if (track.timelineStartInfo.dts === undefined) {
      track.timelineStartInfo.dts = data.dts;
    }

    if (track.minSegmentDts === undefined) {
      track.minSegmentDts = data.dts;
    } else {
      track.minSegmentDts = Math.min(track.minSegmentDts, data.dts);
    }

    if (track.maxSegmentDts === undefined) {
      track.maxSegmentDts = data.dts;
    } else {
      track.maxSegmentDts = Math.max(track.maxSegmentDts, data.dts);
    }
  }
};

/**
 * Clear values used to calculate the baseMediaDecodeTime between
 * tracks
 */
clearDtsInfo = function (track) {
  delete track.minSegmentDts;
  delete track.maxSegmentDts;
  delete track.minSegmentPts;
  delete track.maxSegmentPts;
};

/**
 * Calculate the track's baseMediaDecodeTime based on the earliest
 * DTS the transmuxer has ever seen and the minimum DTS for the
 * current track
 */
calculateTrackBaseMediaDecodeTime = function (track) {
  var
    oneSecondInPTS = 90000, // 90kHz clock
    scale,
    // Calculate the distance, in time, that this segment starts from the start
    // of the timeline (earliest time seen since the transmuxer initialized)
    timeSinceStartOfTimeline = track.minSegmentDts - track.timelineStartInfo.dts,
    // Calculate the first sample's effective compositionTimeOffset
    firstSampleCompositionOffset = track.minSegmentPts - track.minSegmentDts;

  // track.timelineStartInfo.baseMediaDecodeTime is the location, in time, where
  // we want the start of the first segment to be placed
  track.baseMediaDecodeTime = track.timelineStartInfo.baseMediaDecodeTime;

  // Add to that the distance this segment is from the very first
  track.baseMediaDecodeTime += timeSinceStartOfTimeline;

  // Subtract this segment's "compositionTimeOffset" so that the first frame of
  // this segment is displayed exactly at the `baseMediaDecodeTime` or at the
  // end of the previous segment
  track.baseMediaDecodeTime -= firstSampleCompositionOffset;

  // baseMediaDecodeTime must not become negative
  track.baseMediaDecodeTime = Math.max(0, track.baseMediaDecodeTime);

  if (track.type === 'audio') {
    // Audio has a different clock equal to the sampling_rate so we need to
    // scale the PTS values into the clock rate of the track
    scale = track.samplerate / oneSecondInPTS;
    track.baseMediaDecodeTime *= scale;
    track.baseMediaDecodeTime = Math.floor(track.baseMediaDecodeTime);
  }
};

/**
 * A Stream that can combine multiple streams (ie. audio & video)
 * into a single output segment for MSE. Also supports audio-only
 * and video-only streams.
 */
CoalesceStream = function(options) {
  // Number of Tracks per output segment
  // If greater than 1, we combine multiple
  // tracks into a single segment
  this.numberOfTracks = 0;
  this.metadataStream = options.metadataStream;

  if (typeof options.remux !== 'undefined') {
    this.remuxTracks = !!options.remux;
  } else {
    this.remuxTracks = true;
  }

  this.pendingTracks = [];
  this.videoTrack = null;
  this.pendingBoxes = [];
  this.pendingCaptions = [];
  this.pendingMetadata = [];
  this.pendingBytes = 0;
  this.emittedTracks = 0;

  CoalesceStream.prototype.init.call(this);

  // Take output from multiple
  this.push = function(output) {
    // buffer incoming captions until the associated video segment
    // finishes
    if (output.text) {
      return this.pendingCaptions.push(output);
    }
    // buffer incoming id3 tags until the final flush
    if (output.frames) {
      return this.pendingMetadata.push(output);
    }

    // Add this track to the list of pending tracks and store
    // important information required for the construction of
    // the final segment
    this.pendingTracks.push(output.track);
    this.pendingBoxes.push(output.boxes);
    this.pendingBytes += output.boxes.byteLength;

    if (output.track.type === 'video') {
      this.videoTrack = output.track;
    }
    if (output.track.type === 'audio') {
      this.audioTrack = output.track;
    }
  };
};

CoalesceStream.prototype = new Stream();
CoalesceStream.prototype.flush = function() {
  var
    offset = 0,
    event = {
      captions: [],
      metadata: []
    },
    caption,
    id3,
    initSegment,
    timelineStartPts = 0,
    i;

  // Return until we have enough tracks from the pipeline to remux
  if (this.pendingTracks.length === 0 ||
     (this.remuxTracks && this.pendingTracks.length < this.numberOfTracks)) {
    return;
  }

  if (this.videoTrack) {
    timelineStartPts = this.videoTrack.timelineStartInfo.pts;
  } else if (this.audioTrack) {
    timelineStartPts = this.audioTrack.timelineStartInfo.pts;
  }

  if (this.pendingTracks.length === 1) {
    event.type = this.pendingTracks[0].type;
  } else {
    event.type = 'combined';
  }
  this.emittedTracks += this.pendingTracks.length;

  initSegment = mp4.initSegment(this.pendingTracks);

  // Create a new typed array large enough to hold the init
  // segment and all tracks
  event.data = new Uint8Array(initSegment.byteLength +
                              this.pendingBytes);

  // Create an init segment containing a moov
  // and track definitions
  event.data.set(initSegment);
  offset += initSegment.byteLength;

  // Append each moof+mdat (one per track) after the init segment
  for (i = 0; i < this.pendingBoxes.length; i++) {
    event.data.set(this.pendingBoxes[i], offset);
    offset += this.pendingBoxes[i].byteLength;
  }

  // Translate caption PTS times into second offsets into the
  // video timeline for the segment
  for (i = 0; i < this.pendingCaptions.length; i++) {
    caption = this.pendingCaptions[i];
    caption.startTime = (caption.startPts - timelineStartPts);
    caption.startTime /= 90e3;
    caption.endTime = (caption.endPts - timelineStartPts);
    caption.endTime /= 90e3;
    event.captions.push(caption);
  }

  // Translate ID3 frame PTS times into second offsets into the
  // video timeline for the segment
  for (i = 0; i < this.pendingMetadata.length; i++) {
    id3 = this.pendingMetadata[i];
    id3.cueTime = (id3.pts - timelineStartPts);
    id3.cueTime /= 90e3;
    event.metadata.push(id3);
  }
  // We add this to every single emitted segment even though we only need
  // it for the first
  event.metadata.dispatchType = this.metadataStream.dispatchType;

  // Reset stream state
  this.pendingTracks.length = 0;
  this.videoTrack = null;
  this.pendingBoxes.length = 0;
  this.pendingCaptions.length = 0;
  this.pendingBytes = 0;
  this.pendingMetadata.length = 0;

  // Emit the built segment
  this.trigger('data', event);

  // Only emit `done` if all tracks have been flushed and emitted
  if (this.emittedTracks >= this.numberOfTracks) {
    this.trigger('done');
    this.emittedTracks = 0;
  }
};
/**
 * A Stream that expects MP2T binary data as input and produces
 * corresponding media segments, suitable for use with Media Source
 * Extension (MSE) implementations that support the ISO BMFF byte
 * stream format, like Chrome.
 */
Transmuxer = function(options) {
  var
    self = this,
    videoTrack,
    audioTrack,
    packetStream, parseStream, elementaryStream,
    aacStream, h264Stream,
    videoSegmentStream, audioSegmentStream, captionStream,
    coalesceStream;

  Transmuxer.prototype.init.call(this);
  options = options || {};

  this.baseMediaDecodeTime = options.baseMediaDecodeTime || 0;

  // expose the metadata stream
  this.metadataStream = new m2ts.MetadataStream();

  options.metadataStream = this.metadataStream;

  // set up the parsing pipeline
  packetStream = new m2ts.TransportPacketStream();
  parseStream = new m2ts.TransportParseStream();
  elementaryStream = new m2ts.ElementaryStream();
  aacStream = new AacStream();
  h264Stream = new H264Stream();
  captionStream = new m2ts.CaptionStream();
  coalesceStream = new CoalesceStream(options);

  // disassemble MPEG2-TS packets into elementary streams
  packetStream
    .pipe(parseStream)
    .pipe(elementaryStream);

  // !!THIS ORDER IS IMPORTANT!!
  // demux the streams
  elementaryStream
    .pipe(h264Stream);
  elementaryStream
    .pipe(aacStream);

  elementaryStream
    .pipe(this.metadataStream)
    .pipe(coalesceStream);

  // Hook up CEA-608/708 caption stream
  h264Stream.pipe(captionStream)
    .pipe(coalesceStream);

  // hook up the segment streams once track metadata is delivered
  elementaryStream.on('data', function(data) {
    var i;

    if (data.type === 'metadata') {
      i = data.tracks.length;

      // scan the tracks listed in the metadata
      while (i--) {
        if (!videoTrack && data.tracks[i].type === 'video') {
          videoTrack = data.tracks[i];
          videoTrack.timelineStartInfo.baseMediaDecodeTime = self.baseMediaDecodeTime;
        } else if (!audioTrack && data.tracks[i].type === 'audio') {
          audioTrack = data.tracks[i];
          audioTrack.timelineStartInfo.baseMediaDecodeTime = self.baseMediaDecodeTime;
        }
      }

      // hook up the video segment stream to the first track with h264 data
      if (videoTrack && !videoSegmentStream) {
        coalesceStream.numberOfTracks++;
        videoSegmentStream = new VideoSegmentStream(videoTrack);

        videoSegmentStream.on('timelineStartInfo', function(timelineStartInfo){
          // When video emits timelineStartInfo data after a flush, we forward that
          // info to the AudioSegmentStream, if it exists, because video timeline
          // data takes precedence.
          if (audioTrack) {
            audioTrack.timelineStartInfo = timelineStartInfo;
            // On the first segment we trim AAC frames that exist before the
            // very earliest DTS we have seen in video because Chrome will
            // interpret any video track with a baseMediaDecodeTime that is
            // non-zero as a gap.
            audioSegmentStream.setEarliestDts(timelineStartInfo.dts);
          }
        });

        // Set up the final part of the video pipeline
        h264Stream
          .pipe(videoSegmentStream)
          .pipe(coalesceStream);
      }

      if (audioTrack && !audioSegmentStream) {
        // hook up the audio segment stream to the first track with aac data
        coalesceStream.numberOfTracks++;
        audioSegmentStream = new AudioSegmentStream(audioTrack);

        // Set up the final part of the audio pipeline
        aacStream
          .pipe(audioSegmentStream)
          .pipe(coalesceStream);
      }
    }
  });

  this.setBaseMediaDecodeTime = function (baseMediaDecodeTime) {
    this.baseMediaDecodeTime = baseMediaDecodeTime;
    if (audioTrack) {
      audioTrack.timelineStartInfo.dts = undefined;
      audioTrack.timelineStartInfo.pts = undefined;
      clearDtsInfo(audioTrack);
      audioTrack.timelineStartInfo.baseMediaDecodeTime = baseMediaDecodeTime;
    }
    if (videoTrack) {
      videoTrack.timelineStartInfo.dts = undefined;
      videoTrack.timelineStartInfo.pts = undefined;
      clearDtsInfo(videoTrack);
      videoTrack.timelineStartInfo.baseMediaDecodeTime = baseMediaDecodeTime;
    }
  };

  // feed incoming data to the front of the parsing pipeline
  this.push = function(data) {
    packetStream.push(data);
  };

  // flush any buffered data
  this.flush = function() {
    // Start at the top of the pipeline and flush all pending work
    packetStream.flush();
  };

  // Re-emit any data coming from the coalesce stream to the outside world
  coalesceStream.on('data', function (data) {
    self.trigger('data', data);
  });
  // Let the consumer know we have finished flushing the entire pipeline
  coalesceStream.on('done', function () {
    self.trigger('done');
  });
};
Transmuxer.prototype = new Stream();

module.exports = {
  Transmuxer: Transmuxer,
  VideoSegmentStream: VideoSegmentStream,
  AudioSegmentStream: AudioSegmentStream,
};
