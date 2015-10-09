/**
 * mux.js
 *
 * Copyright (c) 2015 Brightcove
 * All rights reserved.
 *
 * Reads in-band caption information from a video elementary
 * stream. Captions must follow the CEA-708 standard for injection
 * into an MPEG-2 transport streams.
 * @see https://en.wikipedia.org/wiki/CEA-708
 */
(function(window, muxjs, undefined) {
  'use strict';

  // -----------------
  // Link To Transport
  // -----------------

  // Supplemental enhancement information (SEI) NAL units have a
  // payload type field to indicate how they are to be
  // interpreted. CEAS-708 caption content is always transmitted with
  // payload type 0x04.
  var USER_DATA_REGISTERED_ITU_T_T35 = 4;

  /**
   * Parse a supplemental enhancement information (SEI) NAL unit.
   *
   * @param bytes {Uint8Array} the bytes of a SEI NAL unit
   * @return {object} the parsed SEI payload
   * @see Rec. ITU-T H.264, 7.3.2.3.1
   */
  var parseSei = function(bytes) {
    var result = {
      payloadType: -1,
      payloadSize: 0,
    }, i;

    // parse the payload type
    // if the payload type is not user_data_registered_itu_t_t35,
    // don't bother parsing any further
    if (bytes[1] !== USER_DATA_REGISTERED_ITU_T_T35) {
      return result;
    }
    result.payloadType = USER_DATA_REGISTERED_ITU_T_T35;

    // parse the payload size
    for (i = 2; i < bytes.length && bytes[i] === 0xff; i++) {
      result.payloadSize += 255;
    }
    result.payloadSize <<= 8;
    result.payloadSize |= bytes[i];
    i++;

    result.payload = bytes.subarray(i, i + result.payloadSize);

    return result;
  };

  // see ANSI/SCTE 128-1 (2013), section 8.1
  var parseUserData = function(sei) {
    // itu_t_t35_contry_code must be 181 (United States) for
    // captions
    if (sei.payload[0] !== 181) {
      return null;
    }

    // itu_t_t35_provider_code should be 49 (ATSC) for captions
    if (((sei.payload[1] << 8) | sei.payload[2]) !== 49) {
      return null;
    }

    // the user_identifier should be "GA94" to indicate ATSC1 data
    if (String.fromCharCode(sei.payload[3],
                            sei.payload[4],
                            sei.payload[5],
                            sei.payload[6]) !== 'GA94') {
      return null;
    }

    // finally, user_data_type_code should be 0x03 for caption data
    if (sei.payload[7] !== 0x03) {
      return null;
    }

    // return the user_data_type_structure and strip the trailing
    // marker bits
    return sei.payload.subarray(8, sei.payload.length - 1);
  };

  // see CEA-708-D, section 4.4
  var parseCaptionPackets = function(pts, userData) {
    var results = [], i, count, offset, data;

    // if this is just filler, return immediately
    if (!(userData[0] & 0x40)) {
      return results;
    }

    // parse out the cc_data_1 and cc_data_2 fields
    count = userData[0] & 0x1f;
    for (i = 0; i < count; i++) {
      offset = i * 3;
      data = {
        type: userData[offset + 2] & 0x03,
        pts: pts
      };

      // capture cc data when cc_valid is 1
      if (userData[offset + 2] & 0x04) {
        data.ccData = (userData[offset + 3] << 8) | userData[offset + 4];
        results.push(data);
      }
    }
    return results;
  };

  var CaptionStream = function() {
    CaptionStream.prototype.init.call(this);

    this.field1_ = new Cea608Stream();
    this.field1_.on('data', this.trigger.bind(this, 'data'));
  };
  CaptionStream.prototype = new muxjs.utils.Stream();
  CaptionStream.prototype.push = function(event) {
    var sei, userData, captionPackets, i;

    // only examine SEI NALs
    if (event.nalUnitType !== 'sei_rbsp') {
      return;
    }
    // parse the sei
    sei = parseSei(event.data);

    // ignore everything but user_data_registered_itu_t_t35
    if (sei.payloadType !== USER_DATA_REGISTERED_ITU_T_T35) {
      return;
    }

    // parse out the user data payload
    userData = parseUserData(sei);

    // ignore unrecognized userData
    if (!userData) {
      return;
    }

    // parse out CC data packets
    captionPackets = parseCaptionPackets(event.pts, userData);

    // send the data to the appropriate field
    for (i = 0; i < captionPackets.length; i++) {
      if (captionPackets[i].type === 0) {
        this.field1_.push(captionPackets[i]);
      }
    }
  };

  // ----------------------
  // Session to Application
  // ----------------------

  var BASIC_CHARACTER_TRANSLATION = {
    0x5c: 0xe9,
    0x5e: 0xed,
    0x5f: 0xf3,
    0x60: 0xfa,
    0x7b: 0xe7,
    0x7c: 0xf7,
    0x7d: 0xd1,
    0x7e: 0xf1,
    0x2a: 0xe1,
    0x7f: 0x2588
  };

  // Constants for the byte codes recognized by Cea608Stream. This
  // list is not exhaustive. For a more comprehensive listing and
  // semantics see
  // http://www.gpo.gov/fdsys/pkg/CFR-2010-title47-vol1/pdf/CFR-2010-title47-vol1-sec15-119.pdf
  var PADDING                    = 0x0000,

      // Pop-on Mode
      RESUME_CAPTION_LOADING     = 0x1420,
      END_OF_CAPTION             = 0x142f,

      // Roll-up Mode
      ROLL_UP_2_ROWS             = 0x1425,
      ROLL_UP_3_ROWS             = 0x1426,
      ROLL_UP_4_ROWS             = 0x1427,
      CARRIAGE_RETURN            = 0x142d,

      // Erasure
      BACKSPACE                  = 0x1421,
      ERASE_DISPLAYED_MEMORY     = 0x142c,
      ERASE_NON_DISPLAYED_MEMORY = 0x142e;

  // the index of the last row in a CEA-608 display buffer
  var BOTTOM_ROW = 14;
  // CEA-608 captions are rendered onto a 34x15 matrix of character
  // cells. The "bottom" row is the last element in the outer array.
  var createDisplayBuffer = function() {
    var result = [], i = BOTTOM_ROW + 1;
    while (i--) {
      result.push('');
    }
    return result;
  };

  var Cea608Stream = function() {
    Cea608Stream.prototype.init.call(this);

    this.mode_ = 'popOn';
    // When in roll-up mode, the index of the last row that will
    // actually display captions. If a caption is shifted to a row
    // with a lower index than this, it is cleared from the display
    // buffer
    this.topRow_ = 0;
    this.startPts_ = 0;
    this.displayed_ = createDisplayBuffer();
    this.nonDisplayed_ = createDisplayBuffer();

    this.push = function(packet) {
      var data, swap, charCode;
      // remove the parity bits
      data = packet.ccData & 0x7f7f;

      switch (data) {
      case PADDING:
        break;

      case RESUME_CAPTION_LOADING:
        this.mode_ = 'popOn';
        break;
      case END_OF_CAPTION:
        // if a caption was being displayed, it's gone now
        this.flushDisplayed(packet.pts);

        // flip memory
        swap = this.displayed_;
        this.displayed_ = this.nonDisplayed_;
        this.nonDisplayed_ = swap;

        // start measuring the time to display the caption
        this.startPts_ = packet.pts;
        break;

      case ROLL_UP_2_ROWS:
        this.topRow_ = BOTTOM_ROW - 1;
        this.mode_ = 'rollUp';
        break;
      case ROLL_UP_3_ROWS:
        this.topRow_ = BOTTOM_ROW - 2;
        this.mode_ = 'rollUp';
        break;
      case ROLL_UP_4_ROWS:
        this.topRow_ = BOTTOM_ROW - 3;
        this.mode_ = 'rollUp';
        break;
      case CARRIAGE_RETURN:
        this.flushDisplayed(packet.pts);
        this.shiftRowsUp_();
        this.startPts_ = packet.pts;
        break;

      case BACKSPACE:
        if (this.mode_ === 'popOn') {
          this.nonDisplayed_[BOTTOM_ROW] = this.nonDisplayed_[BOTTOM_ROW].slice(0, -1);
        } else {
          this.displayed_[BOTTOM_ROW] = this.displayed_[BOTTOM_ROW].slice(0, -1);
        }
        break;
      case ERASE_DISPLAYED_MEMORY:
        this.flushDisplayed(packet.pts);
        this.displayed_ = createDisplayBuffer();
        break;
      case ERASE_NON_DISPLAYED_MEMORY:
        this.nonDisplayed_ = createDisplayBuffer();
        break;

      default:
        charCode = data >>> 8;

        // ignore unsupported control codes
        if ((charCode & 0xf0) === 0x10) {
          return;
        }

        // character handling is dependent on the current mode
        this[this.mode_](packet.pts, charCode, data & 0xff);
        break;
      }
    };
  };
  Cea608Stream.prototype = new muxjs.utils.Stream();
  // Trigger a cue point that captures the current state of the
  // display buffer
  Cea608Stream.prototype.flushDisplayed = function(pts) {
    var row, i;

    for (i = 0; i < this.displayed_.length; i++) {
      row = this.displayed_[i];
      if (row.length) {
        this.trigger('data', {
          startPts: this.startPts_,
          endPts: pts,
          text: row
        });
      }
    }
  };

  // Mode Implementations
  Cea608Stream.prototype.popOn = function(pts, char0, char1) {
    var baseRow = this.nonDisplayed_[BOTTOM_ROW];

    // buffer characters
    char0 = BASIC_CHARACTER_TRANSLATION[char0] || char0;
    baseRow += String.fromCharCode(char0);

    char1 = BASIC_CHARACTER_TRANSLATION[char1] || char1;
    baseRow += String.fromCharCode(char1);
    this.nonDisplayed_[BOTTOM_ROW] = baseRow;
  };
  Cea608Stream.prototype.rollUp = function(pts, char0, char1) {
    var baseRow = this.displayed_[BOTTOM_ROW];
    if (baseRow === '') {
      // we're starting to buffer new display input, so flush out the
      // current display
      this.flushDisplayed(pts);

      this.startPts_ = pts;
    }

    char0 = BASIC_CHARACTER_TRANSLATION[char0] || char0;
    baseRow += String.fromCharCode(char0);

    char1 = BASIC_CHARACTER_TRANSLATION[char1] || char1;
    baseRow += String.fromCharCode(char1);
    this.displayed_[BOTTOM_ROW] = baseRow;
  };
  Cea608Stream.prototype.shiftRowsUp_ = function() {
    var i;
    // clear out inactive rows
    for (i = 0; i < this.topRow_; i++) {
      this.displayed_[i] = '';
    }
    // shift displayed rows up
    for (i = this.topRow_; i < BOTTOM_ROW; i++) {
      this.displayed_[i] = this.displayed_[i + 1];
    }
    // clear out the bottom row
    this.displayed_[BOTTOM_ROW] = '';
  };

  // exports
  muxjs.mp2t = muxjs.mp2t || {};
  muxjs.mp2t.CaptionStream = CaptionStream;
  muxjs.mp2t.Cea608Stream = Cea608Stream;

})(this, this.muxjs);
