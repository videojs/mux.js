(function(window, muxjs, undefined) {
  'use strict';

  var captionStream;

  module('Caption Stream', {
    beforeEach: function() {
      captionStream = new muxjs.mp2t.CaptionStream();
    }
  });

  test('parses SEIs messages larger than 255 bytes', function() {
    var packets = [], data;
    captionStream.field1_.push = function(packet) {
      packets.push(packet);
    };
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
    data[10] = 0x03; //user_data_type_code, 0x03 is cc_data
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
    equal(packets.length, 1, 'parsed a caption');
  });

  test('parses SEIs containing multiple messages', function() {
    var packets = [], data;

    captionStream.field1_.push = function(packet) {
      packets.push(packet);
    };

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
    data[15] = 0x03; //user_data_type_code, 0x03 is cc_data
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
    equal(packets.length, 1, 'parsed a caption');
  });

  test('ignores SEIs that do not have type user_data_registered_itu_t_t35', function() {
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

    equal(captions.length, 0, 'ignored the unknown payload type');
  });

  test('parses a minimal example of caption data', function() {
    var packets = [];
    captionStream.field1_.push = function(packet) {
      packets.push(packet);
    };
    captionStream.push({
      nalUnitType: 'sei_rbsp',
      escapedRBSP: new Uint8Array([
        0x04, // payload_type === user_data_registered_itu_t_t35

        0x0d, // payload_size

        181, // itu_t_t35_country_code
        0x00, 0x31, // itu_t_t35_provider_code
        0x47, 0x41, 0x39, 0x34, // user_identifier, "GA94"
        0x03, //user_data_type_code, 0x03 is cc_data

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
    equal(packets.length, 1, 'parsed a caption packet');
  });

  test('can be parsed from a segment', function() {
    var transmuxer = new muxjs.mp4.Transmuxer(),
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

    transmuxer.push(window.sintelCaptions);
    transmuxer.flush();

    equal(captions.length, 2, 'parsed two captions');
    equal(captions[0].text.indexOf('  ASUKA'), 0, 'parsed the start of the first caption');
    ok(captions[0].text.indexOf('Japanese') > 0, 'parsed the end of the first caption');
    equal(captions[0].startTime, 1, 'parsed the start time');
    equal(captions[0].endTime, 4, 'parsed the end time');
  });

  var cea608Stream;

  // Returns a ccData byte-pair for a two character string. That is,
  // it converts a string like 'hi' into the two-byte number that
  // would be parsed back as 'hi' when provided as ccData.
  var characters = function(text) {
    if (text.length !== 2) {
      throw new Error('ccdata must be specified two characters at a time');
    }
    return (text.charCodeAt(0) << 8) | text.charCodeAt(1);
  };

  module('CEA 608 Stream', {
    beforeEach: function() {
      cea608Stream = new muxjs.mp2t.Cea608Stream();
    }
  });

  QUnit.skip('filters null data', function() {
    ok(false, 'not implemented');
  });

  QUnit.skip('removes parity bits', function() {
    ok(false, 'not implemented');
  });

  test('converts non-standard character codes to ASCII', function() {
    var packets, captions;
    packets = [
      // RCL, resume caption loading
      { ccData: 0x1420 },
      // ASCII exceptions
      { ccData: 0x2a5c },
      { ccData: 0x5e5f },
      { ccData: 0x607b },
      { ccData: 0x7c7d },
      { ccData: 0x7e7f },
      // EOC, End of Caption
      { pts: 1000, ccData: 0x142f },
      // Send another command so that the second EOC isn't ignored
      { ccData: 0x1420 },
      // EOC, End of Caption, clear the display
      { pts: 10 * 1000, ccData: 0x142f }
    ];
    captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    packets.forEach(cea608Stream.push, cea608Stream);

    equal(captions[0].text,
          String.fromCharCode(0xe1, 0xe9, 0xed, 0xf3, 0xfa, 0xe7, 0xf7, 0xd1, 0xf1, 0x2588),
          'translated non-standard characters');
  });

  test('pop-on mode', function() {
    var packets, captions;
    packets = [
      // RCL, resume caption loading
      { ccData: 0x1420 },
      // 'hi'
      { ccData: characters('hi') },
      // EOC, End of Caption. Finished transmitting, begin display
      { pts: 1000, ccData: 0x142f },
      // Send another command so that the second EOC isn't ignored
      { ccData: 0x1420 },
      // EOC, End of Caption. End display
      { pts: 10 * 1000, ccData: 0x142f }
    ];
    captions = [];

    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    packets.forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 1, 'detected a caption')
    deepEqual(captions[0], {
      startPts: 1000,
      endPts: 10 * 1000,
      text: 'hi'
    }, 'parsed the caption');
  });

  test('recognizes the Erase Displayed Memory command', function() {
    var packets, captions;
    packets = [
      // RCL, resume caption loading
      { ccData: 0x1420 },
      // '01'
      { ccData: characters('01') },
      // EOC, End of Caption. Finished transmitting, display '01'
      { pts: 1 * 1000, ccData: 0x142f },
      // EDM, Erase Displayed Memory
      { pts: 1.5 * 1000, ccData: 0x142c },
      // '23'
      { ccData: characters('23') },
      // EOC, End of Caption. Display '23'
      { pts: 2 * 1000, ccData: 0x142f },
      // '34'
      { ccData: characters('34') },
      // EOC, End of Caption. Display '34'
      { pts: 3 * 1000, ccData: 0x142f },
      // Send another command so that the second EOC isn't ignored
      { ccData: 0x1420 },
      // EOC, End of Caption
      { pts: 4 * 1000, ccData: 0x142f }
    ];
    captions = [];

    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    packets.forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 3, 'detected three captions');
    deepEqual(captions[0], {
      startPts: 1 * 1000,
      endPts: 1.5 * 1000,
      text: '01'
    }, 'parsed the first caption');
    deepEqual(captions[1], {
      startPts: 2 * 1000,
      endPts: 3 * 1000,
      text: '23'
    }, 'parsed the second caption');
    deepEqual(captions[2], {
      startPts: 3 * 1000,
      endPts: 4 * 1000,
      text: '34'
    }, 'parsed the third caption');
  });

  test('backspaces are applied to non-displayed memory', function() {
    var captions = [], packets;
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    packets = [
      // RCL, resume caption loading
      { ccData: 0x1420 },
      // '01'
      { ccData: characters('01') },
      // backspace
      { ccData: 0x1421 },
      { ccData: characters('23') },
      // EOC, End of Caption
      { pts: 1 * 1000, ccData: 0x142f },
      // Send another command so that the second EOC isn't ignored
      { ccData: 0x1420 },
      // EOC, End of Caption
      { pts: 3 * 1000, ccData: 0x142f }
    ];

    packets.forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 1, 'detected a caption');
    equal(captions[0].text, '023', 'applied the backspace');
  });

  test('backspaces on cleared memory are no-ops', function() {
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

    equal(captions.length, 0, 'no captions detected');
  });

  test('recognizes the Erase Non-Displayed Memory command', function() {
    var packets, captions;
    packets = [
      // RCL, resume caption loading
      { ccData: 0x1420 },
      // '01'
      { ccData: characters('01') },
      // ENM, Erase Non-Displayed Memory
      { ccData: 0x142e },
      { ccData: characters('23') },
      // EOC, End of Caption. Finished transmitting, display '23'
      { pts: 1 * 1000, ccData: 0x142f },
      // Send another command so that the second EOC isn't ignored
      { ccData: 0x1420 },
      // EOC, End of Caption
      { pts: 2 * 1000, ccData: 0x142f }
    ];
    captions = [];

    packets.forEach(cea608Stream.push, cea608Stream);

    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    packets.forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 1, 'detected one caption');
    deepEqual(captions[0], {
      startPts: 1 * 1000,
      endPts: 2 * 1000,
      text: '23'
    }, 'cleared the non-displayed memory');
  });

  test('ignores unrecognized commands', function() {
    var packets, captions;
    packets = [
      // RCL, resume caption loading
      { ccData: 0x1420 },
      // a row-9 indent 28 underline, which is not supported
      { ccData: 0x1f7f },
      // '01'
      { ccData: characters('01') },
      // EOC, End of Caption
      { pts: 1 * 1000, ccData: 0x142f },
      // Send another command so that the second EOC isn't ignored
      { ccData: 0x1420 },
      // EOC, End of Caption
      { pts: 2 * 1000, ccData: 0x142f }
    ];
    captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    packets.forEach(cea608Stream.push, cea608Stream);

    equal(captions[0].text, '01', 'skipped the unrecognized commands');
  });

  QUnit.skip('applies preamble address codes', function() {
    ok(false, 'not implemented')
  });

  test('roll-up display mode', function() {
    var captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    [ // RU2, roll-up captions 2 rows
      { ccData: 0x1425 },
      // '01'
      {
        pts: 1 * 1000,
        ccData: characters('01')
      },
      // CR, carriage return
      { pts: 3 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 1, 'detected one caption');
    deepEqual(captions[0], {
      startPts: 1 * 1000,
      endPts: 3 * 1000,
      text: '01'
    }, 'parsed the caption')
    captions = [];

    [ // RU4, roll-up captions 4 rows
      { ccdata: 0x1427 },
      // '23'
      {
        pts: 4 * 1000,
        ccData: characters('23')
      },
      // CR
      { pts: 5 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 3, 'detected another caption');
    deepEqual(captions[0], {
      startPts: 3 * 1000,
      endPts: 4 * 1000,
      text: '01'
    }, 'displayed the caption after the carriage return');
    deepEqual(captions[1], {
      startPts: 4 * 1000,
      endPts: 5 * 1000,
      text: '01'
    }, 'kept the caption up after the new caption');
    deepEqual(captions[2], {
      startPts: 4 * 1000,
      endPts: 5 * 1000,
      text: '23'
    }, 'parsed the new caption');
  });

  test('roll-up displays multiple rows simultaneously', function() {
    var captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    [ // RU2, roll-up captions 2 rows
      { ccData: 0x1425 },
      // '01'
      {
        pts: 0 * 1000,
        ccData: characters('01')
      },
      // CR, carriage return
      { pts: 1 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 1, 'detected a caption');
    deepEqual(captions[0], {
      startPts: 0 * 1000,
      endPts: 1 * 1000,
      text: '01'
    }, 'created a caption for the first period');
    captions = [];

    [ // '23'
      {
        pts: 2 * 1000,
        ccData: characters('23')
      },
      // CR, carriage return
      { pts: 3 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 3, 'detected three captions');
    deepEqual(captions[0], {
      startPts: 1 * 1000,
      endPts: 2 * 1000,
      text: '01'
    }, 'created the top row for the second period');
    deepEqual(captions[1], {
      startPts: 2 * 1000,
      endPts: 3 * 1000,
      text: '01'
    }, 'created the top row after the shift up');
    deepEqual(captions[2], {
      startPts: 2 * 1000,
      endPts: 3 * 1000,
      text: '23'
    }, 'created the bottom row for the second period');
    captions = [];

    [ // '45'
      {
        pts: 4 * 1000,
        ccData: characters('45')
      },
      // CR, carriage return
      { pts: 5 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 3, 'detected three captions');
    deepEqual(captions[0], {
      startPts: 3 * 1000,
      endPts: 4 * 1000,
      text: '23'
    }, 'created the top row for the third period');
    deepEqual(captions[1], {
      startPts: 4 * 1000,
      endPts: 5 * 1000,
      text: '23'
    }, 'created the top row after the shift up');
    deepEqual(captions[2], {
      startPts: 4 * 1000,
      endPts: 5 * 1000,
      text: '45'
    }, 'created the bottom row for the third period');
  });

  test('the roll-up count can be changed on-the-fly', function() {
    var captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    [ // RU2, roll-up captions 2 rows
      { ccData: 0x1425 },
      // '01'
      {
        pts: 0 * 1000,
        ccData: characters('01')
      },
      // CR, carriage return
      { pts: 1 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    captions = [];

    [ // RU3, roll-up captions 3 rows
      { ccData: 0x1426 },
      // CR, carriage return
      { pts: 2 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 1, 'still displaying a caption');
    captions = [];

    [ // RU4, roll-up captions 4 rows
      { ccData: 0x1427 },
      // CR, carriage return
      { pts: 3 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 1, 'still displaying a caption');
    captions = [];

    // RU3, roll-up captions 3 rows
    cea608Stream.push({ ccdata: 0x1426 });
    equal(captions.length, 0, 'cleared the caption');
  });

  test('backspaces are reflected in the generated captions', function() {
    var captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    [ // RU2, roll-up captions 2 rows
      { ccData: 0x1425 },
      // '01'
      {
        pts: 0 * 1000,
        ccData: characters('01')
      },
      // backspace
      { ccData: 0x1421 },
      {
        pts: 1 * 1000,
        ccData: characters('23')
      },
      // CR, carriage return
      { pts: 1 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 1, 'detected a caption');
    equal(captions[0].text, '023', 'applied the backspace');
  });

  test('backspaces can remove a caption entirely', function() {
    var captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    [ // RU2, roll-up captions 2 rows
      { ccData: 0x1425 },
      // '01'
      {
        pts: 0 * 1000,
        ccData: characters('01')
      },
      // backspace
      { ccData: 0x1421 },
      // Send another command so that the backspace isn't
      // ignored as a duplicate command
      { ccData: 0x1425 },
      // backspace
      { ccData: 0x1421 },
      // CR, carriage return
      { pts: 1 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 0, 'no caption emitted');
  });

  test('a second identical control code immediately following the first is ignored', function() {
    var captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    [ // RU2, roll-up captions 2 rows
      { ccData: 0x1425 },
      // '01'
      {
        pts: 0 * 1000,
        ccData: characters('01')
      },
      // '02'
      {
        pts: 1 * 1000,
        ccData: characters('02')
      },
      // backspace
      { ccData: 0x1421 },
      // backspace
      { ccData: 0x1421 }, // duplicate is ignored
      // backspace
      { ccData: 0x1421 },
      // CR, carriage return
      { pts: 2 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 1, 'caption emitted');
    equal(captions[0].text, '01', 'only two backspaces processed');
  });

  test('preable address codes are converted into spaces', function() {
    var captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    [ // RU2, roll-up captions 2 rows
      { ccData: 0x1425 },
      // '01'
      {
        pts: 0 * 1000,
        ccData: characters('01')
      },
      // PAC: row 15, indent 0
      { ccData: 0x1470 },
      // '02'
      {
        pts: 1 * 1000,
        ccData: characters('02')
      },
      // CR, carriage return
      { pts: 2 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 1, 'caption emitted');
    equal(captions[0].text, '01  02', 'PACs are was converted to space');
  });

  test('backspaces stop at the beginning of the line', function() {
    var captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    [ // RU2, roll-up captions 2 rows
      { ccData: 0x1425 },
      // '01'
      {
        pts: 0 * 1000,
        ccData: characters('01')
      },
      // backspace
      { ccData: 0x1421 },
      // Send another command so that the backspace isn't
      // ignored as a duplicate command
      { ccData: 0x1425 },
      // backspace
      { ccData: 0x1421 },
      // Send another command so that the backspace isn't
      // ignored as a duplicate command
      { ccData: 0x1425 },
      // backspace
      { ccData: 0x1421 },
      // CR, carriage return
      { pts: 1 * 1000, ccData: 0x142d }
    ].forEach(cea608Stream.push, cea608Stream);

    equal(captions.length, 0, 'no caption emitted');
  });

  QUnit.skip('paint-on display mode', function() {
    ok(false, 'not implemented');
  });

})(this, this.muxjs);
