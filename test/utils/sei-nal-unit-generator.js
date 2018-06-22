/**
 * Helper functions for creating 608/708 SEI NAL units
 */

'use strict';

var box = require('./mp4-helpers').box;

// Create SEI nal-units from Caption packets
var makeSeiFromCaptionPacket = function(caption) {
  return {
    pts: caption.pts,
    dts: caption.dts,
    nalUnitType: 'sei_rbsp',
    escapedRBSP: new Uint8Array([
      0x04, // payload_type === user_data_registered_itu_t_t35

      0x0e, // payload_size

      181, // itu_t_t35_country_code
      0x00, 0x31, // itu_t_t35_provider_code
      0x47, 0x41, 0x39, 0x34, // user_identifier, "GA94"
      0x03, // user_data_type_code, 0x03 is cc_data

      // 110 00001
      0xc1, // process_cc_data, cc_count
      0xff, // reserved
      // 1111 1100
      (0xfc | caption.type), // cc_valid, cc_type (608, field 1)
      (caption.ccData & 0xff00) >> 8, // cc_data_1
      caption.ccData & 0xff, // cc_data_2 without parity bit set

      0xff // marker_bits
    ])
  };
};

// Create SEI nal-units from Caption packets
var makeSeiFromMultipleCaptionPackets = function(captionHash) {
  var pts = captionHash.pts,
    dts = captionHash.dts,
    captions = captionHash.captions;

  var data = [];
  captions.forEach(function(caption) {
    data.push(0xfc | caption.type);
    data.push((caption.ccData & 0xff00) >> 8);
    data.push(caption.ccData & 0xff);
  });

  return {
    pts: pts,
    dts: dts,
    nalUnitType: 'sei_rbsp',
    escapedRBSP: new Uint8Array([
      0x04, // payload_type === user_data_registered_itu_t_t35

      (0x0b + (captions.length * 3)), // payload_size

      181, // itu_t_t35_country_code
      0x00, 0x31, // itu_t_t35_provider_code
      0x47, 0x41, 0x39, 0x34, // user_identifier, "GA94"
      0x03, // user_data_type_code, 0x03 is cc_data

      // 110 00001
      (0x6 << 5) | captions.length, // process_cc_data, cc_count
      0xff // reserved
    ].concat(data).concat([0xff /* marker bits */])
    )
  };
};

var makeMdatFromCaptionPackets = function(packets) {
  var mdat = ['mdat'];
  var seis = packets.map(makeSeiFromCaptionPacket);

  seis.forEach(function(sei) {
    mdat.push(0x00);
    mdat.push(0x00);
    mdat.push(0x00);
    mdat.push(sei.escapedRBSP.length + 1); // nal length
    mdat.push(0x06); // declare nal type as SEI
    // SEI message
    sei.escapedRBSP.forEach(function(byte) {
      mdat.push(byte);
    });
  });

  return box.apply(null, mdat);
};

// Returns a ccData byte-pair for a two character string. That is,
// it converts a string like 'hi' into the two-byte number that
// would be parsed back as 'hi' when provided as ccData.
var characters = function(text) {
  if (text.length !== 2) {
    throw new Error('ccdata must be specified two characters at a time');
  }
  return (text.charCodeAt(0) << 8) | text.charCodeAt(1);
};

module.exports = {
  makeSeiFromCaptionPacket: makeSeiFromCaptionPacket,
  makeSeiFromMultipleCaptionPackets: makeSeiFromMultipleCaptionPackets,
  makeMdatFromCaptionPackets: makeMdatFromCaptionPackets,
  characters: characters
};
