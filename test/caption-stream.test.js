'use strict';

var
  captionStream,
  m2ts = require('../lib/m2ts'),
  mp4 = require('../lib/mp4'),
  QUnit = require('qunit'),
  sintelCaptions = require('./utils/sintel-captions'),
  mixed608708Captions = require('./utils/mixed-608-708-captions'),
  multiChannel608Captions = require('./utils/multi-channel-608-captions');

// Create SEI nal-units from Caption packets
var makeSeiFromCaptionPacket = function(caption) {
  return {
    pts: caption.pts,
    dts: caption.dts || caption.pts,
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

// Returns a ccData byte-pair for a two character string. That is,
// it converts a string like 'hi' into the two-byte number that
// would be parsed back as 'hi' when provided as ccData.
var characters = function(text) {
  if (text.length !== 2) {
    throw new Error('ccdata must be specified two characters at a time');
  }
  return (text.charCodeAt(0) << 8) | text.charCodeAt(1);
};

QUnit.module('Caption Stream', {
  beforeEach: function() {
    captionStream = new m2ts.CaptionStream();
  }
});

QUnit.test('parses SEIs messages larger than 255 bytes', function() {
  var packets = [], data;
  captionStream.ccStreams_[0].push = function(packet) {
    packets.push(packet);
  };
  captionStream.activeCea608Streams_ = [captionStream.ccStreams_[0]];
  data = new Uint8Array(268);
  data[0] = 0x04; // payload_type === user_data_registered_itu_t_t35
  data[1] = 0xff; // payload_size
  data[2] = 0x0d; // payload_size
  data[3] = 181; // itu_t_t35_country_code
  data[4] = 0x00;
  data[5] = 0x31; // itu_t_t35_provider_code
  data[6] = 0x47;
  data[7] = 0x41;
  data[8] = 0x39;
  data[9] = 0x34; // user_identifier, "GA94"
  data[10] = 0x03; // user_data_type_code, 0x03 is cc_data
  data[11] = 0xc1; // process_cc_data, cc_count
  data[12] = 0xff; // reserved
  data[13] = 0xfc; // cc_valid, cc_type (608, field 1)
  data[14] = 0xff; // cc_data_1 with parity bit set
  data[15] = 0x0e; // cc_data_2 without parity bit set
  data[16] = 0xff; // marker_bits

  captionStream.push({
    nalUnitType: 'sei_rbsp',
    escapedRBSP: data
  });
  captionStream.flush();
  QUnit.equal(packets.length, 1, 'parsed a caption');
});

QUnit.test('parses SEIs containing multiple messages', function() {
  var packets = [], data;

  captionStream.ccStreams_[0].push = function(packet) {
    packets.push(packet);
  };
  captionStream.activeCea608Streams_ = [captionStream.ccStreams_[0]];

  data = new Uint8Array(22);
  data[0] = 0x01; // payload_type !== user_data_registered_itu_t_t35
  data[1] = 0x04; // payload_size
  data[6] = 0x04; // payload_type === user_data_registered_itu_t_t35
  data[7] = 0x0d; // payload_size
  data[8] = 181; // itu_t_t35_country_code
  data[9] = 0x00;
  data[10] = 0x31; // itu_t_t35_provider_code
  data[11] = 0x47;
  data[12] = 0x41;
  data[13] = 0x39;
  data[14] = 0x34; // user_identifier, "GA94"
  data[15] = 0x03; // user_data_type_code, 0x03 is cc_data
  data[16] = 0xc1; // process_cc_data, cc_count
  data[17] = 0xff; // reserved
  data[18] = 0xfc; // cc_valid, cc_type (608, field 1)
  data[19] = 0xff; // cc_data_1 with parity bit set
  data[20] = 0x0e; // cc_data_2 without parity bit set
  data[21] = 0xff; // marker_bits

  captionStream.push({
    nalUnitType: 'sei_rbsp',
    escapedRBSP: data
  });
  captionStream.flush();
  QUnit.equal(packets.length, 1, 'parsed a caption');
});

QUnit.test('ignores SEIs that do not have type user_data_registered_itu_t_t35', function() {
  var captions = [];
  captionStream.on('data', function(caption) {
    captions.push(caption);
  });
  captionStream.push({
    nalUnitType: 'sei_rbsp',
    escapedRBSP: new Uint8Array([
      0x05 // payload_type !== user_data_registered_itu_t_t35
    ])
  });

  QUnit.equal(captions.length, 0, 'ignored the unknown payload type');
});

QUnit.test('parses a minimal example of caption data', function() {
  var packets = [];
  captionStream.ccStreams_[0].push = function(packet) {
    packets.push(packet);
  };
  captionStream.activeCea608Streams_ = [captionStream.ccStreams_[0]];
  captionStream.push({
    nalUnitType: 'sei_rbsp',
    escapedRBSP: new Uint8Array([
      0x04, // payload_type === user_data_registered_itu_t_t35

      0x0d, // payload_size

      181, // itu_t_t35_country_code
      0x00, 0x31, // itu_t_t35_provider_code
      0x47, 0x41, 0x39, 0x34, // user_identifier, "GA94"
      0x03, // user_data_type_code, 0x03 is cc_data

      // 110 00001
      0xc1, // process_cc_data, cc_count
      0xff, // reserved
      // 1111 1100
      0xfc, // cc_valid, cc_type (608, field 1)
      0xff, // cc_data_1 with parity bit set
      0x0e, // cc_data_2 without parity bit set

      0xff // marker_bits
    ])
  });
  captionStream.flush();
  QUnit.equal(packets.length, 1, 'parsed a caption packet');
});

QUnit.test('can be parsed from a segment', function() {
  var transmuxer = new mp4.Transmuxer(),
      captions = [];

  // Setting the BMDT to ensure that captions and id3 tags are not
  // time-shifted by this value when they are output and instead are
  // zero-based
  transmuxer.setBaseMediaDecodeTime(100000);

  transmuxer.on('data', function(data) {
    if (data.captions) {
      captions = captions.concat(data.captions);
    }
  });

  transmuxer.push(sintelCaptions);
  transmuxer.flush();

  QUnit.equal(captions.length, 2, 'parsed two captions');
  QUnit.equal(captions[0].text.indexOf('ASUKA'), 0, 'parsed the start of the first caption');
  QUnit.ok(captions[0].text.indexOf('Japanese') > 0, 'parsed the end of the first caption');
  QUnit.equal(captions[0].startTime, 1, 'parsed the start time');
  QUnit.equal(captions[0].endTime, 4, 'parsed the end time');
});

QUnit.test('dispatches caption track information', function() {
  var transmuxer = new mp4.Transmuxer(),
      captions = [],
      captionStreams = {};

  // Setting the BMDT to ensure that captions and id3 tags are not
  // time-shifted by this value when they are output and instead are
  // zero-based
  transmuxer.setBaseMediaDecodeTime(100000);

  transmuxer.on('data', function(data) {
    if (data.captions) {
      captions = captions.concat(data.captions);
      for (var trackId in data.captionStreams) {
        captionStreams[trackId] = true;
      }
    }
  });

  transmuxer.push(multiChannel608Captions);
  transmuxer.flush();

  QUnit.deepEqual(captionStreams, {CC1: true, CC3: true}, 'found captions in CC1 and CC3');
  QUnit.equal(captions.length, 4, 'parsed eight captions');
  QUnit.equal(captions[0].text, 'être une période de questions', 'parsed the text of the first caption in CC3');
  QUnit.equal(captions[1].text, 'PERIOD, FOLKS.', 'parsed the text of the first caption in CC1');
});

QUnit.test('sorting is fun', function() {
  var packets, captions, seiNals;
  packets = [
    // Send another command so that the second EOC isn't ignored
    { pts: 10 * 1000, ccData: 0x1420, type: 0 },
    // RCL, resume caption loading
    { pts: 1000, ccData: 0x1420, type: 0 },
    // 'test string #1'
    { pts: 1000, ccData: characters('te'), type: 0 },
    { pts: 1000, ccData: characters('st'), type: 0 },
    { pts: 1000, ccData: characters(' s'), type: 0 },
    // 'test string #2'
    { pts: 10 * 1000, ccData: characters('te'), type: 0 },
    { pts: 10 * 1000, ccData: characters('st'), type: 0 },
    { pts: 10 * 1000, ccData: characters(' s'), type: 0 },
    // 'test string #1' continued
    { pts: 1000, ccData: characters('tr'), type: 0 },
    { pts: 1000, ccData: characters('in'), type: 0 },
    { pts: 1000, ccData: characters('g '), type: 0 },
    { pts: 1000, ccData: characters('#1'), type: 0 },
    // 'test string #2' continued
    { pts: 10 * 1000, ccData: characters('tr'), type: 0 },
    { pts: 10 * 1000, ccData: characters('in'), type: 0 },
    { pts: 10 * 1000, ccData: characters('g '), type: 0 },
    { pts: 10 * 1000, ccData: characters('#2'), type: 0 },
    // EOC, End of Caption. End display
    { pts: 10 * 1000, ccData: 0x142f, type: 0 },
    // EOC, End of Caption. Finished transmitting, begin display
    { pts: 1000, ccData: 0x142f, type: 0 },
    // Send another command so that the second EOC isn't ignored
    { pts: 20 * 1000, ccData: 0x1420, type: 0 },
    // EOC, End of Caption. End display
    { pts: 20 * 1000, ccData: 0x142f, type: 0 }
  ];
  captions = [];

  seiNals = packets.map(makeSeiFromCaptionPacket);

  captionStream.on('data', function(caption) {
     captions.push(caption);
  });

  seiNals.forEach(captionStream.push, captionStream);
  captionStream.flush();

  QUnit.equal(captions.length, 2, 'detected two captions');
  QUnit.equal(captions[0].text, 'test string #1', 'parsed caption 1');
  QUnit.equal(captions[1].text, 'test string #2', 'parsed caption 2');
});

QUnit.test('extracts all theoretical caption channels', function() {
  var captions = [];
  captionStream.ccStreams_.forEach(function(cc) {
    cc.on('data', function(caption) {
      captions.push(caption);
    });
  });

  var packets = [
    { pts: 1000, type: 0, ccData: 0x1425 },
    { pts: 2000, type: 0, ccData: characters('1a') },
    { pts: 3000, type: 0, ccData: 0x1c25 },
    { pts: 4000, type: 1, ccData: 0x1d25 },
    { pts: 5000, type: 1, ccData: characters('4a') },
    { pts: 6000, type: 0, ccData: characters('2a') },
    { pts: 7000, type: 1, ccData: characters('4b') },
    { pts: 8000, type: 1, ccData: 0x1525 },
    { pts: 9000, type: 1, ccData: characters('3a') },
    { pts: 10000, type: 0, ccData: 0x142d },
    { pts: 11000, type: 0, ccData: 0x1c2d },
    { pts: 12000, type: 0, ccData: 0x1425 },
    { pts: 13000, type: 0, ccData: characters('1b') },
    { pts: 14000, type: 0, ccData: characters('1c') },
    { pts: 15000, type: 0, ccData: 0x142d },
    { pts: 16000, type: 1, ccData: 0x152d },
    { pts: 17000, type: 1, ccData: 0x1d2d },
    { pts: 18000, type: 0, ccData: characters('2b') },
    { pts: 19000, type: 0, ccData: 0x1c2d }
  ];

  var seiNals = packets.map(makeSeiFromCaptionPacket);
  seiNals.forEach(captionStream.push, captionStream);
  captionStream.flush();

  QUnit.equal(captions.length, 6, 'got all captions');
  QUnit.equal(captions[0].text, '1a', 'cc1 first row');
  QUnit.equal(captions[1].text, '2a', 'cc2 first row');
  QUnit.equal(captions[2].text, '1a\n1b1c', 'cc1 first and second row');
  QUnit.equal(captions[3].text, '3a', 'cc3 first row');
  QUnit.equal(captions[4].text, '4a4b', 'cc4 first row');
  QUnit.equal(captions[5].text, '2a\n2b', 'cc2 first and second row');

});

QUnit.test('drops data until first command that sets activeChannel', function() {
  var captions = [];
  captionStream.ccStreams_.forEach(function(cc) {
    cc.on('data', function(caption) {
      captions.push(caption);
    });
  });

  var packets = [
    { pts: 0 * 1000, ccData: characters('no'), type: 0 },
    { pts: 0 * 1000, ccData: characters('t '), type: 0 },
    { pts: 0 * 1000, ccData: characters('th'), type: 0 },
    { pts: 0 * 1000, ccData: characters('is'), type: 0 },
    { pts: 1 * 1000, ccData: 0x142f, type: 0 },
    { pts: 1 * 1000, ccData: 0x1420, type: 0 },
    { pts: 2 * 1000, ccData: 0x142f, type: 0 },
    // RCL, resume caption loading
    { pts: 3 * 1000, ccData: 0x1420, type: 0 },
    { pts: 3 * 1000, ccData: 0x142e, type: 0 },
    { pts: 4 * 1000, ccData: characters('te'), type: 0 },
    { pts: 4 * 1000, ccData: characters('st'), type: 0 },
    { pts: 5 * 1000, ccData: 0x142f, type: 0 },
    { pts: 5 * 1000, ccData: 0x1420, type: 0 },
    { pts: 6 * 1000, ccData: 0x142f, type: 0 }
  ];

  var seiNals = packets.map(makeSeiFromCaptionPacket);
  seiNals.forEach(captionStream.push, captionStream);
  captionStream.flush();

  QUnit.equal(captions.length, 1, 'caption 1 dropped');
  QUnit.equal(captions[0].text, 'test', 'caption with ambiguous channel dropped');
  QUnit.equal(captions[0].stream, 'CC1', 'caption went to right channel');
});

QUnit.test('ignores CEA708 captions', function() {
  var captions = [];
  captionStream.ccStreams_.forEach(function(cc) {
    cc.on('data', function(caption) {
      captions.push(caption);
    });
  });

  var seiNals = mixed608708Captions.map(makeSeiFromCaptionPacket);
  seiNals.forEach(captionStream.push, captionStream);
  captionStream.flush();

  QUnit.equal(captions.length, 3, 'parsed three captions');
  QUnit.equal(captions[0].text, 'BUT IT\'S NOT SUFFERING\nRIGHW.', 'parsed first caption correctly');
  // there is also bad data in the captions, but the null ascii character is removed
  QUnit.equal(captions[1].text, 'IT\'S NOT A THREAT TO ANYBODY.', 'parsed second caption correctly');
  QUnit.equal(captions[2].text, 'WE TRY NOT TO PUT AN ANIMAL DOWN\nIF WE DON\'T HAVE TO.', 'parsed third caption correctly');
});

var cea608Stream;

QUnit.module('CEA 608 Stream', {
  beforeEach: function() {
    cea608Stream = new m2ts.Cea608Stream();
  }
});

QUnit.skip('filters null data', function() {
  QUnit.ok(false, 'not implemented');
});

QUnit.skip('removes parity bits', function() {
  QUnit.ok(false, 'not implemented');
});

QUnit.test('converts non-ASCII character codes to ASCII', function() {
  var packets, captions;
  packets = [
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    // ASCII exceptions
    { ccData: 0x2a5c, type: 0 },
    { ccData: 0x5e5f, type: 0 },
    { ccData: 0x607b, type: 0 },
    { ccData: 0x7c7d, type: 0 },
    { ccData: 0x7e7f, type: 0 },
    // EOC, End of Caption
    { pts: 1000, ccData: 0x142f, type: 0 },
    // Send another command so that the second EOC isn't ignored
    { ccData: 0x1420, type: 0 },
    // EOC, End of Caption, clear the display
    { pts: 10 * 1000, ccData: 0x142f, type: 0 }
  ];
  captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  packets.forEach(cea608Stream.push, cea608Stream);
  QUnit.equal(captions[0].text,
        String.fromCharCode(0xe1, 0xe9, 0xed, 0xf3, 0xfa, 0xe7, 0xf7, 0xd1, 0xf1, 0x2588),
        'translated non-standard characters');
});

QUnit.test('converts special character codes to ASCII', function() {
  var packets, captions;
  packets = [
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    // Special characters as defined by CEA-608
    { ccData: 0x1130, type: 0 },
    { ccData: 0x1131, type: 0 },
    { ccData: 0x1132, type: 0 },
    { ccData: 0x1133, type: 0 },
    { ccData: 0x1134, type: 0 },
    { ccData: 0x1135, type: 0 },
    { ccData: 0x1136, type: 0 },
    { ccData: 0x1137, type: 0 },
    { ccData: 0x1138, type: 0 },
    { ccData: 0x1139, type: 0 },
    { ccData: 0x113a, type: 0 },
    { ccData: 0x113b, type: 0 },
    { ccData: 0x113c, type: 0 },
    { ccData: 0x113d, type: 0 },
    { ccData: 0x113e, type: 0 },
    { ccData: 0x113f, type: 0 },
    // EOC, End of Caption
    { pts: 1000, ccData: 0x142f, type: 0 },
    // Send another command so that the second EOC isn't ignored
    { ccData: 0x1420, type: 0 },
    // EOC, End of Caption, clear the display
    { pts: 10 * 1000, ccData: 0x142f, type: 0 }
  ];
  captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  packets.forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions[0].text,
        String.fromCharCode(0xae, 0xb0, 0xbd, 0xbf, 0x2122, 0xa2, 0xa3, 0x266a,
            0xe0, 0xa0, 0xe8, 0xe2, 0xea, 0xee, 0xf4, 0xfb),
        'translated special characters');
});

QUnit.test('properly handles special and extended character codes', function() {
  var packets, captions;
  packets = [
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    // Extended characters are defined in CEA-608 as a standard character,
    // which is followed by an extended character, and the standard character
    // gets deleted.
    { ccData: 0x2200, type: 0 },
    { ccData: 0x123e, type: 0 },
    { ccData: 0x4c41, type: 0 },
    { ccData: 0x1230, type: 0 },
    { ccData: 0x2d4c, type: 0 },
    { ccData: 0x4100, type: 0 },
    { ccData: 0x1338, type: 0 },
    { ccData: 0x204c, type: 0 },
    { ccData: 0x417d, type: 0 },
    { ccData: 0x4400, type: 0 },
    { ccData: 0x1137, type: 0 },
    { ccData: 0x2200, type: 0 },
    { ccData: 0x123f, type: 0 },
    // EOC, End of Caption
    { pts: 1000, ccData: 0x142f, type: 0 },
    // Send another command so that the second EOC isn't ignored
    { ccData: 0x1420, type: 0 },
    // EOC, End of Caption, clear the display
    { pts: 10 * 1000, ccData: 0x142f, type: 0 }
  ];
  captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  packets.forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions[0].text, '«LÀ-LÅ LAÑD♪»',
        'translated special characters');
});

QUnit.test('pop-on mode', function() {
  var packets, captions;
  packets = [
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    // 'hi'
    { ccData: characters('hi'), type: 0 },
    // EOC, End of Caption. Finished transmitting, begin display
    { pts: 1000, ccData: 0x142f, type: 0 },
    // Send another command so that the second EOC isn't ignored
    { ccData: 0x1420, type: 0 },
    // EOC, End of Caption. End display
    { pts: 10 * 1000, ccData: 0x142f, type: 0 }
  ];
  captions = [];

  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  packets.forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'detected a caption');
  QUnit.deepEqual(captions[0], {
    startPts: 1000,
    endPts: 10 * 1000,
    text: 'hi',
    stream: 'CC1'
  }, 'parsed the caption');
});

QUnit.test('ignores null characters', function() {
  var packets, captions;
  packets = [
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    // 'mu'
    { ccData: characters('mu'), type: 0 },
    // null characters
    { ccData: 0x0000, type: 0 },
    // ' x'
    { ccData: characters(' x'), type: 0 },
    // EOC, End of Caption. Finished transmitting, begin display
    { pts: 1000, ccData: 0x142f, type: 0 },
    // Send another command so that the second EOC isn't ignored
    { ccData: 0x1420, type: 0 },
    // EOC, End of Caption. End display
    { pts: 10 * 1000, ccData: 0x142f, type: 0 }
  ];
  captions = [];

  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  packets.forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'detected a caption');
  QUnit.deepEqual(captions[0], {
    startPts: 1000,
    endPts: 10 * 1000,
    text: 'mu x',
    stream: 'CC1'
  }, 'ignored null characters');
});

QUnit.test('recognizes the Erase Displayed Memory command', function() {
  var packets, captions;
  packets = [
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    // '01'
    { ccData: characters('01'), type: 0 },
    // EOC, End of Caption. Finished transmitting, display '01'
    { pts: 1 * 1000, ccData: 0x142f, type: 0 },
    // EDM, Erase Displayed Memory
    { pts: 1.5 * 1000, ccData: 0x142c, type: 0 },
    // '23'
    { ccData: characters('23'), type: 0 },
    // EOC, End of Caption. Display '23'
    { pts: 2 * 1000, ccData: 0x142f, type: 0 },
    // '34'
    { ccData: characters('34'), type: 0 },
    // EOC, End of Caption. Display '34'
    { pts: 3 * 1000, ccData: 0x142f, type: 0 },
    // Send another command so that the second EOC isn't ignored
    { ccData: 0x1420, type: 0},
    // EOC, End of Caption
    { pts: 4 * 1000, ccData: 0x142f, type: 0 }
  ];
  captions = [];

  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  packets.forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 3, 'detected three captions');
  QUnit.deepEqual(captions[0], {
    startPts: 1 * 1000,
    endPts: 1.5 * 1000,
    text: '01',
    stream: 'CC1'
  }, 'parsed the first caption');
  QUnit.deepEqual(captions[1], {
    startPts: 2 * 1000,
    endPts: 3 * 1000,
    text: '23',
    stream: 'CC1'
  }, 'parsed the second caption');
  QUnit.deepEqual(captions[2], {
    startPts: 3 * 1000,
    endPts: 4 * 1000,
    text: '34',
    stream: 'CC1'
  }, 'parsed the third caption');
});

QUnit.test('backspaces are applied to non-displayed memory', function() {
  var captions = [], packets;
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  packets = [
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    // '01'
    { ccData: characters('01'), type: 0 },
    // backspace
    { ccData: 0x1421, type: 0 },
    { ccData: characters('23'), type: 0 },
    // EOC, End of Caption
    { pts: 1 * 1000, ccData: 0x142f, type: 0 },
    // Send another command so that the second EOC isn't ignored
    { ccData: 0x1420, type: 0 },
    // EOC, End of Caption
    { pts: 3 * 1000, ccData: 0x142f, type: 0 }
  ];

  packets.forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'detected a caption');
  QUnit.equal(captions[0].text, '023', 'applied the backspace');
});

QUnit.test('backspaces on cleared memory are no-ops', function() {
  var captions = [], packets;
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });
  packets = [
    // RCL, resume caption loading
    { ccData: 0x1420 },
    // backspace
    { ccData: 0x1421 },
    // EOC, End of Caption. Finished transmitting, display '01'
    { pts: 1 * 1000, ccData: 0x142f }
  ];

  packets.forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 0, 'no captions detected');
});

QUnit.test('recognizes the Erase Non-Displayed Memory command', function() {
  var packets, captions;
  packets = [
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    // '01'
    { ccData: characters('01'), type: 0 },
    // ENM, Erase Non-Displayed Memory
    { ccData: 0x142e, type: 0 },
    { ccData: characters('23'), type: 0 },
    // EOC, End of Caption. Finished transmitting, display '23'
    { pts: 1 * 1000, ccData: 0x142f, type: 0 },
    // Send another command so that the second EOC isn't ignored
    { ccData: 0x1420, type: 0 },
    // EOC, End of Caption
    { pts: 2 * 1000, ccData: 0x142f, type: 0 }
  ];
  captions = [];

  packets.forEach(cea608Stream.push, cea608Stream);

  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  packets.forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'detected one caption');
  QUnit.deepEqual(captions[0], {
    startPts: 1 * 1000,
    endPts: 2 * 1000,
    text: '23',
    stream: 'CC1'
  }, 'cleared the non-displayed memory');
});

QUnit.test('ignores unrecognized commands', function() {
  var packets, captions;
  packets = [
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    // a row-9 magenta command, which is not supported
    { ccData: 0x1f4c, type: 0 },
    // '01'
    { ccData: characters('01'), type: 0 },
    // EOC, End of Caption
    { pts: 1 * 1000, ccData: 0x142f, type: 0 },
    // Send another command so that the second EOC isn't ignored
    { ccData: 0x1420, type: 0 },
    // EOC, End of Caption
    { pts: 2 * 1000, ccData: 0x142f, type: 0 }
  ];
  captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  packets.forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions[0].text, '01', 'skipped the unrecognized commands');
});

QUnit.skip('applies preamble address codes', function() {
  QUnit.ok(false, 'not implemented');
});

QUnit.skip('applies mid-row colors', function() {
  QUnit.ok(false, 'not implemented');
});

QUnit.test('applies mid-row underline', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  var packets = [
    { ccData: 0x1425, type: 0 },
    { ccData: characters('no'), type: 0 },
    { ccData: 0x1121, type: 0 },
    { ccData: characters('ye'), type: 0 },
    { ccData: characters('s.'), type: 0 },
    { ccData: 0x142d, type: 0 }
  ];

  packets.forEach(cea608Stream.push, cea608Stream);
  QUnit.equal(captions[0].text, 'no <u>yes.</u>', 'properly closed by CR');
});

QUnit.test('applies mid-row italics', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  var packets = [
    { ccData: 0x1425, type: 0 },
    { ccData: characters('no'), type: 0 },
    { ccData: 0x112e, type: 0 },
    { ccData: characters('ye'), type: 0 },
    { ccData: characters('s.'), type: 0 },
    { ccData: 0x142d, type: 0 }
  ];

  packets.forEach(cea608Stream.push, cea608Stream);
  QUnit.equal(captions[0].text, 'no <i>yes.</i>', 'properly closed by CR');
});

QUnit.test('applies mid-row italics underline', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  var packets = [
    // RCL, resume caption loading
    { ccData: 0x1425, type: 0 },
    { ccData: characters('no'), type: 0 },
    { ccData: 0x112f, type: 0 },
    { ccData: characters('ye'), type: 0 },
    { ccData: characters('s.'), type: 0 },
    { ccData: 0x142d, type: 0 }
  ];

  packets.forEach(cea608Stream.push, cea608Stream);
  QUnit.equal(captions[0].text, 'no <i><u>yes.</u></i>', 'properly closed by CR');
});

// NOTE: With the exception of white italics PACs (the following two test
// cases), PACs only have their underline attribute extracted and used
QUnit.test('applies PAC underline', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  var packets = [
    // RCL, resume caption loading
    { ccData: 0x1425, type: 0 },
    { ccData: 0x1461, type: 0 },
    { ccData: characters('ye'), type: 0 },
    { ccData: characters('s.'), type: 0 },
    { ccData: 0x142d, type: 0 }
  ];

  packets.forEach(cea608Stream.push, cea608Stream);
  QUnit.equal(captions[0].text, '<u>yes.</u>', 'properly closed by CR');
});

QUnit.test('applies PAC white italics', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  var packets = [
    // RCL, resume caption loading
    { ccData: 0x1425, type: 0 },
    { ccData: 0x146e, type: 0 },
    { ccData: characters('ye'), type: 0 },
    { ccData: characters('s.'), type: 0 },
    { ccData: 0x142d, type: 0 }
  ];

  packets.forEach(cea608Stream.push, cea608Stream);
  QUnit.equal(captions[0].text, '<i>yes.</i>', 'properly closed by CR');
});

QUnit.test('applies PAC white italics underline', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  var packets = [
    // RCL, resume caption loading
    { ccData: 0x1425, type: 0 },
    { ccData: 0x146f, type: 0 },
    { ccData: characters('ye'), type: 0 },
    { ccData: characters('s.'), type: 0 },
    { ccData: 0x142d, type: 0 }
  ];

  packets.forEach(cea608Stream.push, cea608Stream);
  QUnit.equal(captions[0].text, '<u><i>yes.</i></u>', 'properly closed by CR');
});

QUnit.test('closes formatting at PAC row change', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  var packets = [
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    { ccData: 0x144f, type: 0 },
    { ccData: characters('ye'), type: 0 },
    { ccData: characters('s.'), type: 0 },
    { ccData: 0x1470, type: 0 },
    { ccData: characters('no'), type: 0 },
    // EOC, End of Caption
    { pts: 1 * 1000, ccData: 0x142f, type: 0 },
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    // EOC, End of Caption
    { pts: 2 * 1000, ccData: 0x142f, type: 0 }
  ];

  packets.forEach(cea608Stream.push, cea608Stream);
  QUnit.equal(captions[0].text, '<u><i>yes.</i></u>\nno', 'properly closed by PAC row change');
});

QUnit.test('closes formatting at EOC', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  var packets = [
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    { ccData: 0x146f, type: 0 },
    { ccData: characters('ye'), type: 0 },
    { ccData: characters('s.'), type: 0 },
    // EOC, End of Caption
    { pts: 1 * 1000, ccData: 0x142f, type: 0 },
    // Send another command so that the second EOC isn't ignored
    { ccData: 0x1420, type: 0 },
    // EOC, End of Caption
    { pts: 2 * 1000, ccData: 0x142f, type: 0 }
  ];

  packets.forEach(cea608Stream.push, cea608Stream);
  QUnit.equal(captions[0].text, '<u><i>yes.</i></u>', 'properly closed by EOC');
});

QUnit.test('closes formatting at negating mid-row code', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  var packets = [
    // RCL, resume caption loading
    { ccData: 0x1425, type: 0 },
    { ccData: characters('no'), type: 0 },
    { ccData: 0x112f, type: 0 },
    { ccData: characters('ye'), type: 0 },
    { ccData: characters('s.'), type: 0 },
    { ccData: 0x1120, type: 0 },
    { ccData: characters('no'), type: 0 }
  ];

  packets.forEach(cea608Stream.push, cea608Stream);
  cea608Stream.flushDisplayed();
  QUnit.equal(captions[0].text, 'no <i><u>yes.</u></i> no', 'properly closed by negating mid-row code');
});

QUnit.test('roll-up display mode', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  [ // RU2, roll-up captions 2 rows
    { ccData: 0x1425, type: 0},
    // '01'
    {
      pts: 1 * 1000,
      ccData: characters('01'),
      type: 0
    },
    // CR, carriage return
    { pts: 3 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'detected one caption');
  QUnit.deepEqual(captions[0], {
    startPts: 0 * 1000,
    endPts: 3 * 1000,
    text: '01',
    stream: 'CC1'
  }, 'parsed the caption');
  captions = [];

  [ // RU4, roll-up captions 4 rows
    { ccdata: 0x1427, type: 0 },
    // '23'
    {
      pts: 4 * 1000,
      ccData: characters('23'),
      type: 0,
      stream: 'CC1'
    },
    // CR
    { pts: 5 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'detected another caption');
  QUnit.deepEqual(captions[0], {
    startPts: 3 * 1000,
    endPts: 5 * 1000,
    text: '01\n23',
    stream: 'CC1'
  }, 'parsed the new caption and kept the caption up after the new caption');
});

QUnit.test('roll-up displays multiple rows simultaneously', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  [ // RU2, roll-up captions 2 rows
    { ccData: 0x1425, type: 0 },
    // '01'
    {
      pts: 0 * 1000,
      ccData: characters('01'),
      type: 0,
      stream: 'CC1'
    },
    // CR, carriage return
    { pts: 1 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'detected a caption');
  QUnit.deepEqual(captions[0], {
    startPts: 0 * 1000,
    endPts: 1 * 1000,
    text: '01',
    stream: 'CC1'
  }, 'created a caption for the first period');
  captions = [];

  [ // '23'
    {
      pts: 2 * 1000,
      ccData: characters('23'),
      type: 0,
      stream: 'CC1'
    },
    // CR, carriage return
    { pts: 3 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'detected another caption');
  QUnit.deepEqual(captions[0], {
    startPts: 1 * 1000,
    endPts: 3 * 1000,
    text: '01\n23',
    stream: 'CC1'
  }, 'created the top and bottom rows after the shift up');
  captions = [];

  [ // '45'
    {
      pts: 4 * 1000,
      ccData: characters('45'),
      type: 0,
      stream: 'CC1'
    },
    // CR, carriage return
    { pts: 5 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'detected third caption');
  QUnit.deepEqual(captions[0], {
    startPts: 3 * 1000,
    endPts: 5 * 1000,
    text: '23\n45',
    stream: 'CC1'
  }, 'created the top and bottom rows after the shift up');
});

QUnit.test('the roll-up count can be changed on-the-fly', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  [ // RU2, roll-up captions 2 rows
    { ccData: 0x1425, type: 0 },
    // '01'
    {
      pts: 0 * 1000,
      ccData: characters('01'),
      type: 0,
      stream: 'CC1'
    },
    // CR, carriage return
    { pts: 1 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  captions = [];

  [ // RU3, roll-up captions 3 rows
    { ccData: 0x1426, type: 0 },
    // CR, carriage return
    { pts: 2 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'still displaying a caption');
  captions = [];

  [ // RU4, roll-up captions 4 rows
    { ccData: 0x1427, type: 0 },
    // CR, carriage return
    { pts: 3 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'still displaying a caption');
  captions = [];

  // RU3, roll-up captions 3 rows
  cea608Stream.push({ ccdata: 0x1426, type: 0 });
  QUnit.equal(captions.length, 0, 'cleared the caption');
});

QUnit.test('backspaces are reflected in the generated captions', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  [ // RU2, roll-up captions 2 rows
    { ccData: 0x1425, type: 0 },
    // '01'
    {
      pts: 0 * 1000,
      ccData: characters('01'),
      type: 0
    },
    // backspace
    { ccData: 0x1421, type: 0 },
    {
      pts: 1 * 1000,
      ccData: characters('23'),
      type: 0
    },
    // CR, carriage return
    { pts: 1 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'detected a caption');
  QUnit.equal(captions[0].text, '023', 'applied the backspace');
});

QUnit.test('backspaces can remove a caption entirely', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  [ // RU2, roll-up captions 2 rows
    { ccData: 0x1425, type: 0 },
    // '01'
    {
      pts: 0 * 1000,
      ccData: characters('01'),
      type: 0
    },
    // backspace
    { ccData: 0x1421, type: 0 },
    // Send another command so that the backspace isn't
    // ignored as a duplicate command
    { ccData: 0x1425, type: 0 },
    // backspace
    { ccData: 0x1421, type: 0 },
    // CR, carriage return
    { pts: 1 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 0, 'no caption emitted');
});

QUnit.test('a second identical control code immediately following the first is ignored', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  [ // RU2, roll-up captions 2 rows
    { ccData: 0x1425, type: 0 },
    // '01'
    {
      pts: 0 * 1000,
      ccData: characters('01'),
      type: 0
    },
    // '02'
    {
      pts: 1 * 1000,
      ccData: characters('02'),
      type: 0
    },
    // backspace
    { ccData: 0x1421, type: 0 },
    // backspace
    { ccData: 0x1421, type: 0 }, // duplicate is ignored
    // backspace
    { ccData: 0x1421, type: 0 },
    // CR, carriage return
    { pts: 2 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'caption emitted');
  QUnit.equal(captions[0].text, '01', 'only two backspaces processed');
});

QUnit.test('preamble address codes on same row are NOT converted into spaces', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  [ // RU2, roll-up captions 2 rows
    { ccData: 0x1425, type: 0 },
    // '01'
    {
      pts: 0 * 1000,
      ccData: characters('01'),
      type: 0
    },
    // PAC: row 15, indent 0
    { ccData: 0x1470, type: 0 },
    // '02'
    {
      pts: 1 * 1000,
      ccData: characters('02'),
      type: 0
    },
    // CR, carriage return
    { pts: 2 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'caption emitted');
  QUnit.equal(captions[0].text, '0102', 'PACs were NOT converted to space');
});

QUnit.test('preserves newlines from PACs in pop-on mode', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  [
    // RCL, resume caption loading
    { ccData: 0x1420, type: 0 },
    { ccData: 0x142e, type: 0 },
    { ccData: 0x1350, type: 0 },
    { ccData: 0x5445, type: 0 },
    { ccData: 0x5354, type: 0 },
    { ccData: 0x1450, type: 0 },
    { ccData: 0x5354, type: 0 },
    { ccData: 0x5249, type: 0 },
    { ccData: 0x4e47, type: 0 },
    { ccData: 0x1470, type: 0 },
    { ccData: 0x4441, type: 0 },
    { ccData: 0x5441, type: 0 },
    { pts: 1 * 1000, ccData: 0x142f, type: 0 },
    { pts: 1 * 1000, ccData: 0x1420, type: 0 },
    { pts: 2 * 1000, ccData: 0x142f, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 1, 'caption emitted');
  QUnit.equal(captions[0].text, 'TEST\n\nSTRING\nDATA', 'Position PACs were converted to newlines');
});

QUnit.test('extracts real-world cc1 and cc3 channels', function() {
  var cea608Stream1 = cea608Stream;
  var cea608Stream3 = new m2ts.Cea608Stream(1, 0);
  var captions = [];
  cea608Stream1.on('data', function(caption) {
    captions.push(caption);
  });
  cea608Stream3.on('data', function(caption) {
    captions.push(caption);
  });

  var packets = [
    { pts: 425316, type: 0, ccData: 5158 }, // RU3
    { pts: 431322, type: 0, ccData: 5165 }, // CR
    { pts: 440331, type: 0, ccData: 4944 }, // position 11,0
    { pts: 443334, type: 0, ccData: 20549 }, // PE
    { pts: 449340, type: 0, ccData: 21065 }, // RI
    { pts: 449340, type: 0, ccData: 0 }, // padding
    { pts: 452343, type: 0, ccData: 20292 }, // OD
    { pts: 458349, type: 0, ccData: 11264 }, // ,
    { pts: 458349, type: 0, ccData: 0 }, // padding
    { pts: 461352, type: 0, ccData: 0 }, // padding
    { pts: 467358, type: 0, ccData: 8192 }, // (space)
    { pts: 467358, type: 0, ccData: 17920 }, // F
    { pts: 470361, type: 0, ccData: 0 }, // padding
    { pts: 476367, type: 0, ccData: 0 }, // padding
    { pts: 476367, type: 0, ccData: 20300 }, // OL
    { pts: 479370, type: 0, ccData: 19283 }, // KS
    { pts: 485376, type: 0, ccData: 0 }, // padding
    { pts: 485376, type: 0, ccData: 11776 }, // .
    { pts: 674565, type: 0, ccData: 5158 }, // RU3
    { pts: 677568, type: 0, ccData: 5165 }, // CR
    { pts: 371262, type: 1, ccData: 5414 }, // RU3
    { pts: 377268, type: 1, ccData: 0 }, // padding
    { pts: 377268, type: 1, ccData: 4944 }, // position 11,0
    { pts: 380271, type: 1, ccData: 0 }, // padding
    { pts: 386277, type: 1, ccData: 4412 }, // ê
    { pts: 386277, type: 1, ccData: 0 }, // padding
    { pts: 389280, type: 1, ccData: 29810 }, // tr
    { pts: 395286, type: 1, ccData: 25888 }, // e(space)
    { pts: 395286, type: 1, ccData: 30062 }, // un
    { pts: 398289, type: 1, ccData: 25888 }, // e(space)
    { pts: 404295, type: 1, ccData: 28764 }, // pé
    { pts: 404295, type: 1, ccData: 29289 }, // ri
    { pts: 407298, type: 1, ccData: 28516 }, // od
    { pts: 413304, type: 1, ccData: 25856 }, // e
    { pts: 413304, type: 1, ccData: 0 }, // padding
    { pts: 443334, type: 1, ccData: 8292 }, // (space)d
    { pts: 449340, type: 1, ccData: 25888 }, // e(space)
    { pts: 449340, type: 1, ccData: 29045 }, // qu
    { pts: 452343, type: 1, ccData: 25971 }, // es
    { pts: 458349, type: 1, ccData: 29801 }, // ti
    { pts: 458349, type: 1, ccData: 28526 }, // on
    { pts: 461352, type: 1, ccData: 29440 }, // s
    { pts: 467358, type: 1, ccData: 5421 }, // CR
    { pts: 467358, type: 1, ccData: 0 }, // padding
    { pts: 470361, type: 1, ccData: 5414 }, // RU3
    { pts: 476367, type: 1, ccData: 0 } // padding
  ];

  packets.forEach(function(packet) {
    cea608Stream1.push(packet);
    cea608Stream3.push(packet);
  });

  var cc1 = {stream: 'CC1', text: 'PERIOD, FOLKS.'};
  var cc3 = {stream: 'CC3', text: 'être une période de questions'};

  QUnit.equal(captions.length, 2, 'caption emitted');
  QUnit.equal(captions[0].stream, cc1.stream, 'cc1 stream detected');
  QUnit.equal(captions[0].text, cc1.text, 'cc1 stream extracted successfully');
  QUnit.equal(captions[1].stream, cc3.stream, 'cc3 stream detected');
  QUnit.equal(captions[1].text, cc3.text, 'cc3 stream extracted successfully');
});

QUnit.test('backspaces stop at the beginning of the line', function() {
  var captions = [];
  cea608Stream.on('data', function(caption) {
    captions.push(caption);
  });

  [ // RU2, roll-up captions 2 rows
    { ccData: 0x1425, type: 0 },
    // '01'
    {
      pts: 0 * 1000,
      ccData: characters('01'),
      type: 0
    },
    // backspace
    { ccData: 0x1421, type: 0 },
    // Send another command so that the backspace isn't
    // ignored as a duplicate command
    { ccData: 0x1425, type: 0 },
    // backspace
    { ccData: 0x1421, type: 0 },
    // Send another command so that the backspace isn't
    // ignored as a duplicate command
    { ccData: 0x1425, type: 0 },
    // backspace
    { ccData: 0x1421, type: 0 },
    // CR, carriage return
    { pts: 1 * 1000, ccData: 0x142d, type: 0 }
  ].forEach(cea608Stream.push, cea608Stream);

  QUnit.equal(captions.length, 0, 'no caption emitted');
});

QUnit.skip('paint-on display mode', function() {
  QUnit.ok(false, 'not implemented');
});
