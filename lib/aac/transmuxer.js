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
var mp4 = require('../mp4/mp4-generator.js');
var AdtsStream = require('../codecs/adts.js');
var AacStream = require('./aac');

/**
 * Sum the `byteLength` properties of the data in each AAC frame
 */
var sumFrameByteLengths = function(array) {
  var
    i,
    currentObj,
    sum = 0;

  // sum the byteLength's all each nal unit in the frame
  for (i = 0; i < array.length; i++) {
    currentObj = array[i];
    sum += currentObj.data.byteLength;
  }

  return sum;
};

/**
 * Constructs a single-track, ISO BMFF media segment from AAC data
 * events. The output of this stream can be fed to a SourceBuffer
 * configured with a suitable initialization segment.
 */
var AudioSegmentStream = function(track) {
  var
    adtsFrames = [],
    sequenceNumber = 0,
    earliestAllowedDts = 0;

  AudioSegmentStream.prototype.init.call(this);

  this.push = function(data) {
    // buffer audio data until end() is called
    adtsFrames.push(data);
    track.audioobjecttype = data.audioobjecttype;
    track.channelcount = data.channelcount;
    track.sampleCount = data.sampleCount;
    track.samplerate = data.samplerate;
    track.samplesize = data.samplesize;
    track.samplingfrequencyindex = data.samplingfrequencyindex;
  };

  this.flush = function() {
    var
      frames,
      moof,
      mdat,
      boxes;

    // return early if no audio data has been observed
    if (adtsFrames.length === 0) {
      this.trigger('done', 'AudioSegmentStream');
      return;
    }

    frames = adtsFrames;

    // we have to build the index from byte locations to
    // samples (that is, adts frames) in the audio data
    track.samples = this.generateSampleTable_(frames);

    // concatenate the audio data to constuct the mdat
    mdat = mp4.mdat(this.concatenateFrameData_(frames));

    adtsFrames = [];

    moof = mp4.moof(sequenceNumber, [track]);
    boxes = new Uint8Array(moof.byteLength + mdat.byteLength);

    // bump the sequence number for next time
    sequenceNumber++;

    boxes.set(moof);
    boxes.set(mdat, moof.byteLength);

    this.trigger('data', {track: track, boxes: boxes});
    this.trigger('done', 'AudioSegmentStream');
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
      data = new Uint8Array(sumFrameByteLengths(frames));

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
 * A Stream that can combine multiple streams (ie. audio & video)
 * into a single output segment for MSE. Also supports audio-only
 * and video-only streams.
 */
var CoalesceStream = function(options) {
  // Number of Tracks per output segment
  // If greater than 1, we combine multiple
  // tracks into a single segment
  this.numberOfTracks = 0;

  if (typeof options.remux !== 'undefined') {
    this.remuxTracks = !!options.remux;
  } else {
    this.remuxTracks = true;
  }

  this.pendingTracks = [];
  this.videoTrack = null;
  this.pendingBoxes = [];
  this.pendingBytes = 0;
  this.emittedTracks = 0;

  CoalesceStream.prototype.init.call(this);

  // Take output from multiple
  this.push = function(output) {
    // Add this track to the list of pending tracks and store
    // important information required for the construction of
    // the final segment
    this.pendingTracks.push(output.track);
    this.pendingBoxes.push(output.boxes);
    this.pendingBytes += output.boxes.byteLength;

    if (output.track.type === 'audio') {
      this.audioTrack = output.track;
    }
  };
};

CoalesceStream.prototype = new Stream();
CoalesceStream.prototype.flush = function(flushSource) {
  var
    offset = 0,
    event = {
      info: {}
    },
    caption,
    id3,
    initSegment,
    timelineStartPts = 0,
    i;

  if (this.pendingTracks.length < this.numberOfTracks) {
    if (flushSource !== 'VideoSegmentStream' &&
        flushSource !== 'AudioSegmentStream') {
      // Return because we haven't received a flush from a data-generating
      // portion of the segment (meaning that we have only recieved meta-data
      // or captions.)
      return;
    } else if (this.remuxTracks) {
      // Return until we have enough tracks from the pipeline to remux (if we
      // are remuxing audio and video into a single MP4)
      return;
    } else if (this.pendingTracks.length === 0) {
      // In the case where we receive a flush without any data having been
      // received we consider it an emitted track for the purposes of coalescing
      // `done` events.
      // We do this for the case where there is an audio and video track in the
      // segment but no audio data. (seen in several playlists with alternate
      // audio tracks and no audio present in the main TS segments.)
      this.emittedTracks++;

      if (this.emittedTracks >= this.numberOfTracks) {
        this.trigger('done');
        this.emittedTracks = 0;
      }
      return;
    }
  }

  timelineStartPts = this.audioTrack.timelineStartInfo.pts;

  if (this.pendingTracks.length === 1) {
    event.type = this.pendingTracks[0].type;
  } else {
    event.type = 'combined';
  }

  this.emittedTracks += this.pendingTracks.length;

  initSegment = mp4.initSegment(this.pendingTracks);

  // Create a new typed array to hold the init segment
  event.initSegment = new Uint8Array(initSegment.byteLength);

  // Create an init segment containing a moov
  // and track definitions
  event.initSegment.set(initSegment);

  // Create a new typed array to hold the moof+mdats
  event.data = new Uint8Array(this.pendingBytes);

  // Append each moof+mdat (one per track) together
  for (i = 0; i < this.pendingBoxes.length; i++) {
    event.data.set(this.pendingBoxes[i], offset);
    offset += this.pendingBoxes[i].byteLength;
  }

  // Reset stream state
  this.pendingTracks.length = 0;
  this.videoTrack = null;
  this.pendingBoxes.length = 0;
  this.pendingBytes = 0;

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
var Transmuxer = function(options) {
  var
    self = this,
    audioTrack = {
      timelineStartInfo: {
        dts: 0,
        pts: 0,
        baseMediaDecodeTime: this.baseMediaDecodeTime
      },
      codec: 'adts',
      type: 'audio'
    };

  Transmuxer.prototype.init.call(this);

  options = options || {};
  this.baseMediaDecodeTime = options.baseMediaDecodeTime || 0;
  this.transmuxPipeline_ = null;

  this.setupAacPipeline = function() {
    var pipeline = {};
    this.transmuxPipeline_ = pipeline;

    pipeline.type = 'aac';

    // set up the parsing pipeline
    pipeline.aacStream = new AacStream();
    pipeline.adtsStream = new AdtsStream();
    pipeline.coalesceStream = new CoalesceStream(options, pipeline.metadataStream);
    pipeline.headOfPipeline = pipeline.aacStream;

    pipeline.aacStream
      .pipe(pipeline.adtsStream);

    // hook up the audio segment stream to the first track with aac data
    pipeline.coalesceStream.numberOfTracks++;
    pipeline.audioSegmentStream = new AudioSegmentStream(audioTrack);
    // Set up the final part of the audio pipeline
    pipeline.adtsStream
      .pipe(pipeline.audioSegmentStream)
      .pipe(pipeline.coalesceStream);

    // Re-emit any data coming from the coalesce stream to the outside world
    pipeline.coalesceStream.on('data', this.trigger.bind(this, 'data'));
    // Let the consumer know we have finished flushing the entire pipeline
    pipeline.coalesceStream.on('done', this.trigger.bind(this, 'done'));
  };

  // hook up the segment streams once track metadata is delivered
  this.setBaseMediaDecodeTime = function(baseMediaDecodeTime) {
    var pipeline = this.transmuxPipeline_;

    this.baseMediaDecodeTime = baseMediaDecodeTime;
    if (audioTrack) {
      audioTrack.timelineStartInfo.dts = 0;
      audioTrack.timelineStartInfo.pts = 0;
      clearDtsInfo(audioTrack);
      audioTrack.timelineStartInfo.baseMediaDecodeTime = baseMediaDecodeTime;
    }
  };

  // feed incoming data to the front of the parsing pipeline
  this.push = function(data) {
    if (!this.transmuxPipeline_) {
      this.setupAacPipeline();
    }

    this.transmuxPipeline_.headOfPipeline.push(data);
  };

  // flush any buffered data
  this.flush = function() {
    this.transmuxPipeline_.headOfPipeline.flush();
  };
};
Transmuxer.prototype = new Stream();

module.exports = {
  Transmuxer: Transmuxer
};
