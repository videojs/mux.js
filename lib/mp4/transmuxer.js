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
(function(window, muxjs, undefined) {
'use strict';

// object types
var VideoSegmentStream, AudioSegmentStream, Transmuxer, CoalesceStream;

// Helper functions
var collectDtsInfo, clearDtsInfo, calculateTrackBaseMediaDecodeTime;

// namespace
var mp4 = muxjs.mp4;

/**
 * Constructs a single-track, ISO BMFF media segment from AAC data
 * events. The output of this stream can be fed to a SourceBuffer
 * configured with a suitable initialization segment.
 */
AudioSegmentStream = function(track) {
  var
    aacFrames = [],
    aacFramesLength = 0,
    sequenceNumber = 0,
    earliestAllowedDts = 0;

  AudioSegmentStream.prototype.init.call(this);

  this.push = function(data) {
    collectDtsInfo(track, data);

    if (track && track.channelcount === undefined) {
      track.audioobjecttype = data.audioobjecttype;
      track.channelcount = data.channelcount;
      track.samplerate = data.samplerate;
      track.samplingfrequencyindex = data.samplingfrequencyindex;
      track.samplesize = data.samplesize;
    }

    // buffer audio data until end() is called
    aacFrames.push(data);
    aacFramesLength += data.data.byteLength;
  };

  this.setEarliestDts = function (earliestDts) {
    earliestAllowedDts = earliestDts;
  };

  this.flush = function() {
    var boxes, currentFrame, data, sample, i, mdat, moof;
    // return early if no audio data has been observed
    if (aacFramesLength === 0) {
      this.trigger('done');
      return;
    }

    // If the audio segment extends before the earliest allowed dts
    // value, remove AAC frames until starts at or after the earliest
    // allowed dts.
    if (track.minSegmentDts < earliestAllowedDts) {
      // We will need to recalculate the earliest segment Dts
      track.minSegmentDts = Infinity;

      aacFrames = aacFrames.filter(function(currentFrame) {
        // If this is an allowed frame, keep it and record it's Dts
        if (currentFrame.dts >= earliestAllowedDts) {
          track.minSegmentDts = Math.min(track.minSegmentDts, currentFrame.dts);
          return true;
        }
        // Otherwise, discard it
        aacFramesLength -= currentFrame.data.byteLength;
        return false;
      });
    }

    // concatenate the audio data to constuct the mdat
    data = new Uint8Array(aacFramesLength);
    track.samples = [];
    i = 0;
    while (aacFrames.length) {
      currentFrame = aacFrames[0];
      sample = {
        size: currentFrame.data.byteLength,
        duration: 1024 // FIXME calculate for realz
      };
      track.samples.push(sample);

      data.set(currentFrame.data, i);
      i += currentFrame.data.byteLength;

      aacFrames.shift();
    }
    aacFramesLength = 0;
    mdat = mp4.mdat(data);

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
};
AudioSegmentStream.prototype = new muxjs.utils.Stream();

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
    nalUnitsLength = 0,
    config,
    pps;
  VideoSegmentStream.prototype.init.call(this);

  delete track.minPTS;

  this.push = function(data) {
    collectDtsInfo(track, data);

    // record the track config
    if (data.nalUnitType === 'seq_parameter_set_rbsp' &&
        !config) {
      config = data.config;

      track.width = config.width;
      track.height = config.height;
      track.sps = [data.data];
      track.profileIdc = config.profileIdc;
      track.levelIdc = config.levelIdc;
      track.profileCompatibility = config.profileCompatibility;
    }

    if (data.nalUnitType === 'pic_parameter_set_rbsp' &&
        !pps) {
      pps = data.data;
      track.pps = [data.data];
    }

    // buffer video until end() is called
    nalUnits.push(data);
    nalUnitsLength += data.data.byteLength;
  };

  this.flush = function() {
    var startUnit, currentNal, moof, mdat, boxes, i, data, view, sample;

    // return early if no video data has been observed
    if (nalUnitsLength === 0) {
      this.trigger('done');
      return;
    }

    // concatenate the video data and construct the mdat
    // first, we have to build the index from byte locations to
    // samples (that is, frames) in the video data
    data = new Uint8Array(nalUnitsLength + (4 * nalUnits.length));
    view = new DataView(data.buffer);
    track.samples = [];

    // see ISO/IEC 14496-12:2012, section 8.6.4.3
    sample = {
      size: 0,
      flags: {
        isLeading: 0,
        dependsOn: 1,
        isDependedOn: 0,
        hasRedundancy: 0,
        degradationPriority: 0
      }
    };
    i = 0;
    while (nalUnits.length) {
      currentNal = nalUnits[0];
      // flush the sample we've been building when a new sample is started
      if (currentNal.nalUnitType === 'access_unit_delimiter_rbsp') {
        if (startUnit) {
          sample.duration = currentNal.dts - startUnit.dts;
          track.samples.push(sample);
        }
        sample = {
          size: 0,
          flags: {
            isLeading: 0,
            dependsOn: 1,
            isDependedOn: 0,
            hasRedundancy: 0,
            degradationPriority: 0
          },
          compositionTimeOffset: currentNal.pts - currentNal.dts
        };
        startUnit = currentNal;
      }
      if (currentNal.nalUnitType === 'slice_layer_without_partitioning_rbsp_idr') {
        // the current sample is a key frame
        sample.flags.dependsOn = 2;
      }
      sample.size += 4; // space for the NAL length
      sample.size += currentNal.data.byteLength;

      view.setUint32(i, currentNal.data.byteLength);
      i += 4;
      data.set(currentNal.data, i);
      i += currentNal.data.byteLength;

      nalUnits.shift();
    }
    // record the last sample
    if (track.samples.length) {
      sample.duration = track.samples[track.samples.length - 1].duration;
    }
    track.samples.push(sample);
    nalUnitsLength = 0;
    mdat = mp4.mdat(data);

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
};
VideoSegmentStream.prototype = new muxjs.utils.Stream();

/**
 * Store information about the start and end of the tracka and the
 * duration for each frame/sample we process in order to calculate
 * the baseMediaDecodeTime
 */
collectDtsInfo = function (track, data) {
  if (typeof data.pts === 'number') {
    if (track.timelineStartInfo.pts === undefined) {
      track.timelineStartInfo.pts = data.pts;
    } else {
      track.timelineStartInfo.pts =
        Math.min(track.timelineStartInfo.pts, data.pts);
    }
  }

  if (typeof data.dts === 'number') {
    if (track.timelineStartInfo.dts === undefined) {
      track.timelineStartInfo.dts = data.dts;
    } else {
      track.timelineStartInfo.dts =
        Math.min(track.timelineStartInfo.dts, data.dts);
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
};

/**
 * Calculate the track's baseMediaDecodeTime based on the earliest
 * DTS the transmuxer has ever seen and the minimum DTS for the
 * current track
 */
calculateTrackBaseMediaDecodeTime = function (track) {
  var
    oneSecondInPTS = 90000, // 90kHz clock
    scale;

  track.baseMediaDecodeTime = track.minSegmentDts - track.timelineStartInfo.dts;

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

CoalesceStream.prototype = new muxjs.utils.Stream();
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

  initSegment = muxjs.mp4.initSegment(this.pendingTracks);

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
    caption.startTime = caption.startPts - timelineStartPts;
    caption.startTime /= 90e3;
    caption.endTime = caption.endPts - timelineStartPts;
    caption.endTime /= 90e3;
    event.captions.push(caption);
  }

  // Translate ID3 frame PTS times into second offsets into the
  // video timeline for the segment
  for (i = 0; i < this.pendingMetadata.length; i++) {
    id3 = this.pendingMetadata[i];
    id3.cueTime = id3.pts - timelineStartPts;
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

  // Emit the final segment
  this.trigger('data', event);
  this.trigger('done');
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

  // expose the metadata stream
  this.metadataStream = new muxjs.mp2t.MetadataStream();

  options.metadataStream = this.metadataStream;

  // set up the parsing pipeline
  packetStream = new muxjs.mp2t.TransportPacketStream();
  parseStream = new muxjs.mp2t.TransportParseStream();
  elementaryStream = new muxjs.mp2t.ElementaryStream();
  aacStream = new muxjs.codecs.AacStream();
  h264Stream = new muxjs.codecs.H264Stream();
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
  // if CEA-708 parsing is available, hook up a caption stream
  if (muxjs.mp2t.CaptionStream) {
    captionStream = new muxjs.mp2t.CaptionStream();
    h264Stream.pipe(captionStream)
      .pipe(coalesceStream);
  }

  // hook up the segment streams once track metadata is delivered
  elementaryStream.on('data', function(data) {
    var i, videoTrack, audioTrack;

    if (data.type === 'metadata') {
      i = data.tracks.length;

      // scan the tracks listed in the metadata
      while (i--) {
        if (data.tracks[i].type === 'video') {
          videoTrack = data.tracks[i];
        } else if (data.tracks[i].type === 'audio') {
          audioTrack = data.tracks[i];
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
Transmuxer.prototype = new muxjs.utils.Stream();

// exports
muxjs.mp4 = muxjs.mp4 || {};

muxjs.mp4.VideoSegmentStream = VideoSegmentStream;
muxjs.mp4.Transmuxer = Transmuxer;

})(this, this.muxjs);
