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

'use strict';

// -----------------
// Link To Transport
// -----------------

// Supplemental enhancement information (SEI) NAL units have a
// payload type field to indicate how they are to be
// interpreted. CEAS-708 caption content is always transmitted with
// payload type 0x04.
var USER_DATA_REGISTERED_ITU_T_T35 = 4,
    RBSP_TRAILING_BITS = 128,
    Stream = require('../utils/stream');

/**
  * Parse a supplemental enhancement information (SEI) NAL unit.
  * Stops parsing once a message of type ITU T T35 has been found.
  *
  * @param bytes {Uint8Array} the bytes of a SEI NAL unit
  * @return {object} the parsed SEI payload
  * @see Rec. ITU-T H.264, 7.3.2.3.1
  */
var parseSei = function(bytes) {
  var
    i = 0,
    result = {
      payloadType: -1,
      payloadSize: 0
    },
    payloadType = 0,
    payloadSize = 0;

  // go through the sei_rbsp parsing each each individual sei_message
  while (i < bytes.byteLength) {
    // stop once we have hit the end of the sei_rbsp
    if (bytes[i] === RBSP_TRAILING_BITS) {
      break;
    }

    // Parse payload type
    while (bytes[i] === 0xFF) {
      payloadType += 255;
      i++;
    }
    payloadType += bytes[i++];

    // Parse payload size
    while (bytes[i] === 0xFF) {
      payloadSize += 255;
      i++;
    }
    payloadSize += bytes[i++];

    // this sei_message is a 608/708 caption so save it and break
    // there can only ever be one caption message in a frame's sei
    if (!result.payload && payloadType === USER_DATA_REGISTERED_ITU_T_T35) {
      result.payloadType = payloadType;
      result.payloadSize = payloadSize;
      result.payload = bytes.subarray(i, i + payloadSize);
      break;
    }

    // skip the payload and parse the next message
    i += payloadSize;
    payloadType = 0;
    payloadSize = 0;
  }

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

  this.captionPackets_ = [];

  this.field1_ = new Cea608Stream(); // eslint-disable-line no-use-before-define

  // forward data and done events from field1_ to this CaptionStream
  this.field1_.on('data', this.trigger.bind(this, 'data'));
  this.field1_.on('done', this.trigger.bind(this, 'done'));
};
CaptionStream.prototype = new Stream();
CaptionStream.prototype.push = function(event) {
  var sei, userData;

  // only examine SEI NALs
  if (event.nalUnitType !== 'sei_rbsp') {
    return;
  }

  // parse the sei
  sei = parseSei(event.escapedRBSP);

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

  // parse out CC data packets and save them for later
  this.captionPackets_ = this.captionPackets_.concat(parseCaptionPackets(event.pts, userData));
};

CaptionStream.prototype.flush = function() {
  // make sure we actually parsed captions before proceeding
  if (!this.captionPackets_.length) {
    this.field1_.flush();
    return;
  }

  // In Chrome, the Array#sort function is not stable so add a
  // presortIndex that we can use to ensure we get a stable-sort
  this.captionPackets_.forEach(function(elem, idx) {
    elem.presortIndex = idx;
  });

  // sort caption byte-pairs based on their PTS values
  this.captionPackets_.sort(function(a, b) {
    if (a.pts === b.pts) {
      return a.presortIndex - b.presortIndex;
    }
    return a.pts - b.pts;
  });

  // Push each caption into Cea608Stream
  this.captionPackets_.forEach(this.field1_.push, this.field1_);

  this.captionPackets_.length = 0;
  this.field1_.flush();
  return;
};
// ----------------------
// Session to Application
// ----------------------

var BASIC_CHARACTER_TRANSLATION = {
  0x2a: 0xe1,
  0x5c: 0xe9,
  0x5e: 0xed,
  0x5f: 0xf3,
  0x60: 0xfa,
  0x7b: 0xe7,
  0x7c: 0xf7,
  0x7d: 0xd1,
  0x7e: 0xf1,
  0x7f: 0x2588
};

var getCharFromCode = function(code) {
  if (code === null) {
    return '';
  }
  code = BASIC_CHARACTER_TRANSLATION[code] || code;
  return String.fromCharCode(code);
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
  this.lastControlCode_ = null;

  this.push = function(packet) {
    // Ignore other channels
    if (packet.type !== 0) {
      return;
    }
    var data, swap, char0, char1;
    // remove the parity bits
    data = packet.ccData & 0x7f7f;

    // ignore duplicate control codes
    if (data === this.lastControlCode_) {
      this.lastControlCode_ = null;
      return;
    }

    // Store control codes
    if ((data & 0xf000) === 0x1000) {
      this.lastControlCode_ = data;
    } else {
      this.lastControlCode_ = null;
    }

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
      char0 = data >>> 8;
      char1 = data & 0xff;

      // Look for a Channel 1 Preamble Address Code
      if (char0 >= 0x10 && char0 <= 0x17 &&
          char1 >= 0x40 && char1 <= 0x7F &&
          (char0 !== 0x10 || char1 < 0x60)) {
        // Follow Safari's lead and replace the PAC with a space
        char0 = 0x20;
        // we only want one space so make the second character null
        // which will get become '' in getCharFromCode
        char1 = null;
      }

      // Look for special character sets
      if ((char0 === 0x11 || char0 === 0x19) &&
          (char1 >= 0x30 && char1 <= 0x3F)) {
        // Put in eigth note and space
        char0 = 0x266A;
        char1 = '';
      }

      // ignore unsupported control codes
      if ((char0 & 0xf0) === 0x10) {
        return;
      }

      // remove null chars
      if (char0 === 0x00) {
        char0 = null;
      }
      if (char1 === 0x00) {
        char1 = null;
      }

      // character handling is dependent on the current mode
      this[this.mode_](packet.pts, char0, char1);
      break;
    }
  };
};
Cea608Stream.prototype = new Stream();
// Trigger a cue point that captures the current state of the
// display buffer
Cea608Stream.prototype.flushDisplayed = function(pts) {
  var content = this.displayed_
    // remove spaces from the start and end of the string
    .map(function(row) {
      return row.trim();
    })
    // remove empty rows
    .filter(function(row) {
      return row.length;
    })
    // combine all text rows to display in one cue
    .join('\n');

  if (content.length) {
    this.trigger('data', {
      startPts: this.startPts_,
      endPts: pts,
      text: content
    });
  }
};

// Mode Implementations
Cea608Stream.prototype.popOn = function(pts, char0, char1) {
  var baseRow = this.nonDisplayed_[BOTTOM_ROW];

  // buffer characters
  baseRow += getCharFromCode(char0);
  baseRow += getCharFromCode(char1);
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

  baseRow += getCharFromCode(char0);
  baseRow += getCharFromCode(char1);

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
module.exports = {
  CaptionStream: CaptionStream,
  Cea608Stream: Cea608Stream
};
