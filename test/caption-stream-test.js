(function(window, muxjs, undefined) {
  'use strict';

  var captionStream;

  module('Caption Stream', {
    beforeEach: function() {
      captionStream = new muxjs.mp2t.CaptionStream();
    }
  });

  QUnit.skip('parses SEIs larger than 255 bytes', function() {
    var captions = [];
    captionStream.on('data', function(caption) {
      captions.push(caption);
    });
    captionStream.push({
      nalUnitType: 'sei_rbsp',
      data: new Uint8Array(312)
    });

    equal(captions.length, 1, 'parsed a caption');
  });

  test('ignores SEIs that do not have type user_data_registered_itu_t_t35', function() {
    var captions = [];
    captionStream.on('data', function(caption) {
      captions.push(caption);
    });
    captionStream.push({
      nalUnitType: 'sei_rbsp',
      data: new Uint8Array([
        0x06, // nal_unit_type
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
      data: new Uint8Array([
        0x06, // nal_unit_type
        0x04, // payload_type !== user_data_registered_itu_t_t35

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

    equal(packets.length, 1, 'parsed a caption packet');
  });

  test('can be parsed from a segment', function() {
    var transmuxer = new muxjs.mp4.Transmuxer(),
        captions = [];

    transmuxer.on('data', function(data) {
      if (data.captions) {
        captions = captions.concat(data.captions);
      }
    });

    transmuxer.push(window.sintelCaptions);
    transmuxer.flush();

    equal(captions.length, 2, 'parsed two captions');
    equal(captions[0].text.indexOf('ASUKA'), 0, 'parsed the start of the first caption');
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
    var packets, captions, i;
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
      // EOC, End of Caption, clear the display
      { pts: 10 * 1000, ccData: 0x142f }
    ];
    captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });
    for (i = 0; i < packets.length; i++) {
      cea608Stream.push(packets[i]);
    }

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
      // EOC, End of Caption. End display
      { pts: 10 * 1000, ccData: 0x142f }
    ];
    captions = [];

    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    cea608Stream.push(packets[0]);
    cea608Stream.push(packets[1]);
    cea608Stream.push(packets[2]);
    cea608Stream.push(packets[3]);

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
      // EOC, End of Caption
      { pts: 4 * 1000, ccData: 0x142f }
    ];
    captions = [];

    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    packets.forEach(function(packet) {
      cea608Stream.push(packet);
    });
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
    var captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    // RCL, resume caption loading
    cea608Stream.push({ ccData: 0x1420 });
    // '01'
    cea608Stream.push({
      ccData: characters('01')
    });
    // backspace
    cea608Stream.push({ ccData: 0x1421 });
    cea608Stream.push({
      ccData: characters('23')
    });
    // EOC, End of Caption
    cea608Stream.push({ pts: 1 * 1000, ccData: 0x142f });
    // EOC, End of Caption
    cea608Stream.push({ pts: 3 * 1000, ccData: 0x142f });

    equal(captions.length, 1, 'detected a caption');
    equal(captions[0].text, '023', 'applied the backspace');
  });

  test('backspaces on cleared memory are no-ops', function() {
    var captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    // RCL, resume caption loading
    cea608Stream.push({ ccData: 0x1420 });
    // backspace
    cea608Stream.push({ ccData: 0x1421 });
    // EOC, End of Caption. Finished transmitting, display '01'
    cea608Stream.push({ pts: 1 * 1000, ccData: 0x142f });

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
      // EOC, End of Caption
      { pts: 2 * 1000, ccData: 0x142f }
    ];
    captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    packets.forEach(function(packet) {
      cea608Stream.push(packet);
    });
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
      // EOC, End of Caption
      { pts: 2 * 1000, ccData: 0x142f }
    ];
    captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    packets.forEach(function(packet) {
      cea608Stream.push(packet);
    });
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

    // RU2, roll-up captions 2 rows
    cea608Stream.push({ ccData: 0x1425 });
    // '01'
    cea608Stream.push({
      pts: 1 * 1000,
      ccData: characters('01')
    });
    // CR, carriage return
    cea608Stream.push({ pts: 3 * 1000, ccData: 0x142d });

    equal(captions.length, 1, 'detected one caption');
    deepEqual(captions[0], {
      startPts: 1 * 1000,
      endPts: 3 * 1000,
      text: '01'
    }, 'parsed the caption')
    captions = [];

    // RU4, roll-up captions 4 rows
    cea608Stream.push({ ccdata: 0x1427 });
    // '23'
    cea608Stream.push({
      pts: 4 * 1000,
      ccData: characters('23')
    });
    // CR
    cea608Stream.push({ pts: 5 * 1000, ccData: 0x142d });
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

    // RU2, roll-up captions 2 rows
    cea608Stream.push({ ccData: 0x1425 });
    // '01'
    cea608Stream.push({
      pts: 0 * 1000,
      ccData: characters('01')
    });
    // CR, carriage return
    cea608Stream.push({ pts: 1 * 1000, ccData: 0x142d });
    equal(captions.length, 1, 'detected a caption');
    deepEqual(captions[0], {
      startPts: 0 * 1000,
      endPts: 1 * 1000,
      text: '01'
    }, 'created a caption for the first period');
    captions = [];

    // '23'
    cea608Stream.push({
      pts: 2 * 1000,
      ccData: characters('23')
    });
    // CR, carriage return
    cea608Stream.push({ pts: 3 * 1000, ccData: 0x142d });
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

    // '45'
    cea608Stream.push({
      pts: 4 * 1000,
      ccData: characters('45')
    });
    // CR, carriage return
    cea608Stream.push({ pts: 5 * 1000, ccData: 0x142d });
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

    // RU2, roll-up captions 2 rows
    cea608Stream.push({ ccData: 0x1425 });
    // '01'
    cea608Stream.push({
      pts: 0 * 1000,
      ccData: characters('01')
    });
    // CR, carriage return
    cea608Stream.push({ pts: 1 * 1000, ccData: 0x142d });
    captions = [];

    // RU3, roll-up captions 3 rows
    cea608Stream.push({ ccData: 0x1426 });
    // CR, carriage return
    cea608Stream.push({ pts: 2 * 1000, ccData: 0x142d });
    equal(captions.length, 1, 'still displaying a caption');
    captions = [];

    // RU4, roll-up captions 4 rows
    cea608Stream.push({ ccData: 0x1427 });
    // CR, carriage return
    cea608Stream.push({ pts: 3 * 1000, ccData: 0x142d });
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

    // RU2, roll-up captions 2 rows
    cea608Stream.push({ ccData: 0x1425 });
    // '01'
    cea608Stream.push({
      pts: 0 * 1000,
      ccData: characters('01')
    });
    // backspace
    cea608Stream.push({ ccData: 0x1421 });
    cea608Stream.push({
      pts: 1 * 1000,
      ccData: characters('23')
    });
    // CR, carriage return
    cea608Stream.push({ pts: 1 * 1000, ccData: 0x142d });

    equal(captions.length, 1, 'detected a caption');
    equal(captions[0].text, '023', 'applied the backspace');
  });

  test('backspaces can remove a caption entirely', function() {
    var captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    // RU2, roll-up captions 2 rows
    cea608Stream.push({ ccData: 0x1425 });
    // '01'
    cea608Stream.push({
      pts: 0 * 1000,
      ccData: characters('01')
    });
    // backspace
    cea608Stream.push({ ccData: 0x1421 });
    // backspace
    cea608Stream.push({ ccData: 0x1421 });
    // CR, carriage return
    cea608Stream.push({ pts: 1 * 1000, ccData: 0x142d });

    equal(captions.length, 0, 'no caption emitted');
  });

  test('backspaces stop at the beginning of the line', function() {
    var captions = [];
    cea608Stream.on('data', function(caption) {
      captions.push(caption);
    });

    // RU2, roll-up captions 2 rows
    cea608Stream.push({ ccData: 0x1425 });
    // '01'
    cea608Stream.push({
      pts: 0 * 1000,
      ccData: characters('01')
    });
    // backspace
    cea608Stream.push({ ccData: 0x1421 });
    // backspace
    cea608Stream.push({ ccData: 0x1421 });
    // backspace
    cea608Stream.push({ ccData: 0x1421 });
    // CR, carriage return
    cea608Stream.push({ pts: 1 * 1000, ccData: 0x142d });

    equal(captions.length, 0, 'no caption emitted');
  });

  QUnit.skip('paint-on display mode', function() {
    ok(false, 'not implemented');
  });

})(this, this.muxjs);
