'use strict';

var QUnit = require('qunit'),
    emsg = require('../lib/mp4/emsg'),
    generateEmsgBoxData = require('./utils/mp4-helpers').generateEmsgBoxData,
    messageData = new Uint8Array([0x64, 0x61, 0x74, 0x61]); // data;

QUnit.module('EMSG Parsing');

QUnit.test('Can parse a v0 emsg box', function(assert) {
    var boxData = generateEmsgBoxData(0, messageData);
    var parsedBox = emsg.parseEmsgBox(boxData);
    // we're getting wrong version for some reason
    assert.equal(parsedBox.scheme_id_uri, 'urn:foo:bar:2023\0', 'parsed v1 box has expected scheme_id_uri');
    assert.equal(parsedBox.value, 'foo.bar.value\0', 'parsed v1 box has expected value');
    assert.equal(parsedBox.timescale, 100, 'parsed v1 box has expected timescale');
    assert.equal(parsedBox.presentation_time, undefined, 'parsed v1 box has expected presentation_time');
    assert.equal(parsedBox.presentation_time_delta, 1000, 'parsed v1 box has expected presentation_time_delta');
    assert.equal(parsedBox.event_duration, 0, 'parsed v1 box has expected event_duration');
    assert.equal(parsedBox.id, 1, 'parsed v1 box has expected id');
    assert.deepEqual(parsedBox.message_data, messageData, 'parsed v1 box has expected data');

});

QUnit.test('Can parse a v1 emsg box', function(assert) {
    var boxData = generateEmsgBoxData(1, messageData);
    var parsedBox = emsg.parseEmsgBox(boxData);
    // we're getting wrong version for some reason
    assert.equal(parsedBox.scheme_id_uri, 'urn:foo:bar:2023\0', 'parsed v1 box has expected scheme_id_uri');
    assert.equal(parsedBox.value, 'foo.bar.value\0', 'parsed v1 box has expected value');
    assert.equal(parsedBox.timescale, 100, 'parsed v1 box has expected timescale');
    assert.equal(parsedBox.presentation_time, 10000, 'parsed v1 box has expected presentation_time');
    assert.equal(parsedBox.presentation_time_delta, undefined, 'parsed v1 box has expected presentation_time_delta');
    assert.equal(parsedBox.event_duration, 1, 'parsed v1 box has expected event_duration');
    assert.equal(parsedBox.id, 2, 'parsed v1 box has expected id');
    assert.deepEqual(parsedBox.message_data, messageData, 'parsed v1 box has expected data');

});
