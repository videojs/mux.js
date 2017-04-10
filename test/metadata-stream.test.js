'use strict';
/*
  ======== A Handy Little QUnit Reference ========
  http://api.qunitjs.com/

  Test methods:
  module(name, {[setup][ ,teardown]})
  test(name, callback)
  expect(numberOfAssertions)
  stop(increment)
  start(decrement)
  Test assertions:
  ok(value, [message])
  equal(actual, expected, [message])
  notEqual(actual, expected, [message])
  deepEqual(actual, expected, [message])
  notDeepEqual(actual, expected, [message])
  strictEqual(actual, expected, [message])
  notStrictEqual(actual, expected, [message])
  throws(block, [expected], [message])
*/

var metadataStream, stringToInts, stringToCString, id3Tag, id3Frame, id3Generator, mp2t, QUnit,
    webworkify, metadataStreamTestWorker;

mp2t = require('../lib/m2ts');
QUnit = require('qunit');
id3Generator = require('./utils/id3-generator');
webworkify = require('webworkify');
metadataStreamTestWorker = require('./metadata-stream-test-worker');
stringToInts = id3Generator.stringToInts;
stringToCString = id3Generator.stringToCString;
id3Tag = id3Generator.id3Tag;
id3Frame = id3Generator.id3Frame;

QUnit.module('MetadataStream', {
  setup: function() {
    metadataStream = new mp2t.MetadataStream();
  }
});

QUnit.test('can construct a MetadataStream', function() {
 QUnit.ok(metadataStream, 'does not return null');
});


QUnit.test('parses simple ID3 metadata out of PES packets', function() {
  var
    events = [],
    wxxxPayload = [
      0x00 // text encoding. ISO-8859-1
    ].concat(stringToCString('ad tag URL'), // description
              stringToInts('http://example.com/ad?v=1234&q=7')), // value
    id3Bytes,
    size;

  metadataStream.on('data', function(event) {
    events.push(event);
  });

  id3Bytes = new Uint8Array(stringToInts('ID3').concat([
    0x03, 0x00,            // version 3.0 of ID3v2 (aka ID3v.2.3.0)
    0x40,                  // flags. include an extended header
    0x00, 0x00, 0x00, 0x00, // size. set later

    // extended header
    0x00, 0x00, 0x00, 0x06, // extended header size. no CRC
    0x00, 0x00,             // extended flags
    0x00, 0x00, 0x00, 0x02  // size of padding

    // frame 0
    // http://id3.org/id3v2.3.0#User_defined_text_information_frame
  ], id3Frame('WXXX',
              wxxxPayload), // value
  // frame 1
  // custom tag
  id3Frame('XINF',
            [
              0x04, 0x03, 0x02, 0x01 // arbitrary data
            ]), [
              0x00, 0x00             // padding
            ]));

  // set header size field
  size = id3Bytes.byteLength - 10;
  id3Bytes[6] = (size >>> 21) & 0x7f;
  id3Bytes[7] = (size >>> 14) & 0x7f;
  id3Bytes[8] = (size >>>  7) & 0x7f;
  id3Bytes[9] = (size)        & 0x7f;

  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 1000,

    // header
    data: id3Bytes
  });

  QUnit.equal(events.length, 1, 'parsed one tag');
  QUnit.equal(events[0].frames.length, 2, 'parsed two frames');
  QUnit.equal(events[0].frames[0].key, 'WXXX', 'parsed a WXXX frame');
  QUnit.deepEqual(new Uint8Array(events[0].frames[0].data),
            new Uint8Array(wxxxPayload),
            'attached the frame payload');
  QUnit.equal(events[0].frames[1].key, 'XINF', 'parsed a user-defined frame');
  QUnit.deepEqual(new Uint8Array(events[0].frames[1].data),
            new Uint8Array([0x04, 0x03, 0x02, 0x01]),
            'attached the frame payload');
  QUnit.equal(events[0].pts, 1000, 'did not modify the PTS');
  QUnit.equal(events[0].dts, 1000, 'did not modify the PTS');
});

QUnit.test('skips non-ID3 metadata events', function() {
  var events = [];
  metadataStream.on('data', function(event) {
    events.push(event);
  });

  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 1000,

    // header
    data: new Uint8Array([0])
  });

  QUnit.equal(events.length, 0, 'did not emit an event');
});

// missing cases:
// unsynchronization
// CRC
// no extended header
// compressed frames
// encrypted frames
// frame groups
// too large/small tag size values
// too large/small frame size values
QUnit.test('parses TXXX frames without null terminators', function() {
  var events = [];
  metadataStream.on('data', function(event) {
    events.push(event);
  });

  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,

    // header
    data: new Uint8Array(id3Tag(id3Frame('TXXX',
                                          0x03, // utf-8
                                          stringToCString('get done'),
                                          stringToInts('{ "key": "value" }')),
                                [0x00, 0x00]))
  });

  QUnit.equal(events.length, 1, 'parsed one tag');
  QUnit.equal(events[0].frames.length, 1, 'parsed one frame');
  QUnit.equal(events[0].frames[0].key, 'TXXX', 'parsed the frame key');
  QUnit.equal(events[0].frames[0].description, 'get done', 'parsed the description');
  QUnit.deepEqual(JSON.parse(events[0].frames[0].data), { key: 'value' }, 'parsed the data');
});

QUnit.test('parses TXXX frames with null terminators', function() {
  var events = [];
  metadataStream.on('data', function(event) {
    events.push(event);
  });

  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,

    // header
    data: new Uint8Array(id3Tag(id3Frame('TXXX',
                                          0x03, // utf-8
                                          stringToCString('get done'),
                                          stringToCString('{ "key": "value" }')),
                                [0x00, 0x00]))
  });

  QUnit.equal(events.length, 1, 'parsed one tag');
  QUnit.equal(events[0].frames.length, 1, 'parsed one frame');
  QUnit.equal(events[0].frames[0].key, 'TXXX', 'parsed the frame key');
  QUnit.equal(events[0].frames[0].description, 'get done', 'parsed the description');
  QUnit.deepEqual(JSON.parse(events[0].frames[0].data), { key: 'value' }, 'parsed the data');
});

QUnit.test('parses WXXX frames', function() {
  var events = [], url = 'http://example.com/path/file?abc=7&d=4#ty';
  metadataStream.on('data', function(event) {
    events.push(event);
  });

  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,

    // header
    data: new Uint8Array(id3Tag(id3Frame('WXXX',
                                          0x03, // utf-8
                                          stringToCString(''),
                                          stringToInts(url)),
                                [0x00, 0x00]))
  });

  QUnit.equal(events.length, 1, 'parsed one tag');
  QUnit.equal(events[0].frames.length, 1, 'parsed one frame');
  QUnit.equal(events[0].frames[0].key, 'WXXX', 'parsed the frame key');
  QUnit.equal(events[0].frames[0].description, '', 'parsed the description');
  QUnit.equal(events[0].frames[0].url, url, 'parsed the value');
});

QUnit.test('parses TXXX frames with characters that have a single-digit hexadecimal representation', function() {
  var events = [], value = String.fromCharCode(7);
  metadataStream.on('data', function(event) {
    events.push(event);
  });

  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,

    // header
    data: new Uint8Array(id3Tag(id3Frame('TXXX',
                                          0x03, // utf-8
                                          stringToCString(''),
                                          stringToCString(value)),
                                [0x00, 0x00]))
  });

  QUnit.equal(events[0].frames[0].data,
        value,
        'parsed the single-digit character');
});

QUnit.test('parses PRIV frames', function() {
  var
    events = [],
    payload = stringToInts('arbitrary data may be included in the payload ' +
                            'of a PRIV frame');

  metadataStream.on('data', function(event) {
    events.push(event);
  });

  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,

    // header
    data: new Uint8Array(id3Tag(id3Frame('PRIV',
                                          stringToCString('priv-owner@example.com'),
                                          payload)))
  });

  QUnit.equal(events.length, 1, 'parsed a tag');
  QUnit.equal(events[0].frames.length, 1, 'parsed a frame');
  QUnit.equal(events[0].frames[0].key, 'PRIV', 'frame key is PRIV');
  QUnit.equal(events[0].frames[0].owner, 'priv-owner@example.com', 'parsed the owner');
  QUnit.deepEqual(new Uint8Array(events[0].frames[0].data),
            new Uint8Array(payload),
            'parsed the frame private data');

});

QUnit.test('parses tags split across pushes', function() {
  var
    events = [],
    owner = stringToCString('owner@example.com'),
    payload = stringToInts('A TS packet is 188 bytes in length so that it can' +
                            ' be easily transmitted over ATM networks, an ' +
                            'important medium at one time. We want to be sure' +
                            ' that ID3 frames larger than a TS packet are ' +
                            'properly re-assembled.'),
    tag = new Uint8Array(id3Tag(id3Frame('PRIV', owner, payload))),
    front = tag.subarray(0, 100),
    back = tag.subarray(100);

  metadataStream.on('data', function(event) {
    events.push(event);
  });

  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,
    data: front,
    dataAlignmentIndicator: true
  });

  QUnit.equal(events.length, 0, 'parsed zero tags');

  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,
    data: back,
    dataAlignmentIndicator: false
  });

  QUnit.equal(events.length, 1, 'parsed a tag');
  QUnit.equal(events[0].frames.length, 1, 'parsed a frame');
  QUnit.equal(events[0].frames[0].data.byteLength,
        payload.length,
        'collected data across pushes');

  // parses subsequent fragmented tags
  tag = new Uint8Array(id3Tag(id3Frame('PRIV',
                                        owner, payload, payload)));
  front = tag.subarray(0, 188);
  back = tag.subarray(188);
  events = [];
  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 2000,
    dts: 2000,
    data: front,
    dataAlignmentIndicator: true
  });
  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 2000,
    dts: 2000,
    data: back,
    dataAlignmentIndicator: false
  });

  QUnit.equal(events.length, 1, 'parsed a tag');
  QUnit.equal(events[0].frames.length, 1, 'parsed a frame');
  QUnit.equal(events[0].frames[0].data.byteLength,
        2 * payload.length,
        'collected data across pushes');
});

QUnit.test('id3 frame is malformed first time but gets corrected in the next frame', function() {
  var
    events = [],
    owner = stringToCString('owner@example.com'),
    payload = stringToInts('A TS packet is 188 bytes in length so that it can' +
                            ' be easily transmitted over ATM networks, an ' +
                            'important medium at one time. We want to be sure' +
                            ' that ID3 frames larger than a TS packet are ' +
                            'properly re-assembled.'),
    tag = new Uint8Array(id3Tag(id3Frame('PRIV', owner, payload))),
    front = tag.subarray(0, 100);

  metadataStream.on('data', function(event) {
    events.push(event);
  });

  // receives incomplete id3
  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,
    data: front,
    dataAlignmentIndicator: true
  });

  QUnit.equal(events.length, 0, 'parsed zero tags');

  // receives complete id3
  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,
    data: tag,
    dataAlignmentIndicator: true
  });

  QUnit.equal(events.length, 1, 'parsed a tag');
  QUnit.equal(events[0].frames.length, 1, 'parsed a frame');
  QUnit.equal(events[0].frames[0].data.byteLength,
        payload.length,
        'collected data across pushes');
});

QUnit.test('id3 frame reports more data than its tagsize ', function() {
  var
    events = [],
    owner = stringToCString('owner@example.com'),
    payload = stringToInts('A TS packet is 188 bytes in length so that it can' +
                            ' be easily transmitted over ATM networks, an ' +
                            'important medium at one time. We want to be sure' +
                            ' that ID3 frames larger than a TS packet are ' +
                            'properly re-assembled.'),
    tag = new Uint8Array(id3Tag(id3Frame('PRIV', owner, payload))),
    d = new Uint8Array([0x04, 0x05, 0x06]),
    data = new Uint8Array(tag.byteLength + d.byteLength);

  data.set(tag);
  data.set(d, tag.length);

  metadataStream.on('data', function(event) {
    events.push(event);
  });

  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,
    data: data,
    dataAlignmentIndicator: true
  });

  QUnit.equal(events.length, 1, 'parsed a tag');
  QUnit.equal(events[0].frames.length, 1, 'parsed a frame');
  QUnit.equal(events[0].frames[0].data.byteLength,
        payload.length,
        'collected data across pushes');
});

QUnit.test('ignores tags when the header is fragmented', function() {

  var
    events = [],
    tag = new Uint8Array(id3Tag(id3Frame('PRIV',
                                          stringToCString('owner@example.com'),
                                          stringToInts('payload')))),
    // split the 10-byte ID3 tag header in half
    front = tag.subarray(0, 5),
    back = tag.subarray(5);

  metadataStream.on('data', function(event) {
    events.push(event);
  });

  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,
    data: front
  });
  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,
    data: back
  });

  QUnit.equal(events.length, 0, 'parsed zero tags');

  metadataStream.push({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1500,
    dts: 1500,
    data: new Uint8Array(id3Tag(id3Frame('PRIV',
                                          stringToCString('owner2'),
                                          stringToInts('payload2'))))
  });
  QUnit.equal(events.length, 1, 'parsed one tag');
  QUnit.equal(events[0].frames[0].owner, 'owner2', 'dropped the first tag');
});

// https://html.spec.whatwg.org/multipage/embedded-content.html#steps-to-expose-a-media-resource-specific-text-track
QUnit.test('constructs the dispatch type', function() {
  metadataStream = new mp2t.MetadataStream({
    descriptor: new Uint8Array([0x03, 0x02, 0x01, 0x00])
  });

  QUnit.equal(metadataStream.dispatchType, '1503020100', 'built the dispatch type');
});


QUnit.test('can parse PRIV frames in web worker', function(assert) {
  var payload = stringToInts('arbitrary'),
      worker = webworkify(metadataStreamTestWorker),
      done = assert.async();

  worker.addEventListener('message', function(e) {
    QUnit.equal(e.data.frames[0].key, 'PRIV', 'frame key is PRIV');
    QUnit.deepEqual(new Uint8Array(e.data.frames[0].data), new Uint8Array(payload),
                    'parsed the frame private data');
    done();
  });

  worker.postMessage({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,
    // header
    data: new Uint8Array(id3Tag(id3Frame('PRIV',
                                          stringToCString('priv-owner@example.com'),
                                          payload)))
  });
});

QUnit.test('can parse TXXX frames in web worker', function(assert) {
  var worker = webworkify(metadataStreamTestWorker),
      done = assert.async();

  worker.addEventListener('message', function(e) {
    QUnit.equal(e.data.frames[0].key, 'TXXX', 'frame key is TXXX');
    QUnit.equal(e.data.frames[0].description, 'get done', 'parsed the description');
    QUnit.deepEqual(JSON.parse(e.data.frames[0].data), { key: 'value' }, 'parsed the data');
    done();
  });

  worker.postMessage({
    type: 'timed-metadata',
    trackId: 7,
    pts: 1000,
    dts: 900,
    // header
    data: new Uint8Array(id3Tag(id3Frame('TXXX',
                                          0x03, // utf-8
                                          stringToCString('get done'),
                                          stringToCString('{ "key": "value" }')),
                                [0x00, 0x00]))
  });
});

QUnit.test('triggers special event after parsing a timestamp ID3 tag', function() {
  var
    array = new Uint8Array(73),
    streamTimestamp = 'com.apple.streaming.transportStreamTimestamp',
    priv = 'PRIV',
    count = 0,
    frame,
    tag,
    metadataStream,
    chunk,
    i;

  metadataStream = new mp2t.MetadataStream();
  metadataStream.on('timestamp', function(f) {
    frame = f;
    count += 1;
  });
  metadataStream.on('data', function(t) {
    tag = t;
  });

  array[0] = 73;
  array[1] = 68;
  array[2] = 51;
  array[3] = 4;
  array[9] = 63;
  array[17] = 53;
  array[70] = 13;
  array[71] = 187;
  array[72] = 160;
  for (i = 0; i < priv.length; i++) {
    array[i + 10] = priv.charCodeAt(i);
  }
  for (i = 0; i < streamTimestamp.length; i++) {
    array[i + 20] = streamTimestamp.charCodeAt(i);
  }
  chunk = {
    type: 'timed-metadata',
    data: array
  };

  metadataStream.push(chunk);
  QUnit.equal(count, 1, 'timestamp event triggered once');
  QUnit.equal(frame.timeStamp, 900000, 'Initial timestamp fired and calculated correctly');
  QUnit.equal(tag.pts, 10 * 90e3, 'set tag PTS');
  QUnit.equal(tag.dts, 10 * 90e3, 'set tag DTS');
});
