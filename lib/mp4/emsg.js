var parseStringUntilNullChar = function(data) {
    var index = 0;
    var curChar = String.fromCharCode(data[index]);
    var retString = '';
    while (curChar !== '\0') {
        retString += curChar;
        index++;
        curChar = String.fromCharCode(data[index]);
    }
    // Add nullChar
    retString += curChar;
    return retString;
};

var parseEmsgBox = function(boxData) {
    var offset = 0
    var version = boxData[offset];
    var scheme_id_uri, value, timescale, presentation_time, presentation_time_delta, event_duration, id;
    // version 0 vs version 1 have different formats.
    if (version === 0) {
        // Parse id and value strings first.
        scheme_id_uri = parseStringUntilNullChar(boxData);
        offset += scheme_id_uri.length - 1;
        value = parseStringUntilNullChar(boxData.subarray(offset));

        var dv = new DataView(boxData);
        timescale = dv.getUint32(12);
        presentation_time_delta = dv.getUint32(16);
        event_duration = dv.getUint32(20);
        id = dv.getUint32(24);
        offset = 28;
    } else if (version === 1) {
        var dv = new DataView(boxData);
        timescale = dv.getUint32(0);
        presentation_time = dv.getBigUint64(4);
        event_duration = dv.getUint32(12);
        id = dv.getUint32(16);

        offset = 20;
        scheme_id_uri = parseStringUntilNullChar(boxData.subarray(offset));
        offset += scheme_id_uri.length - 1;
        value = parseStringUntilNullChar(boxData.subarray(offset));
        offset += value.length - 1;
        
    }
    var message_data = boxData.subarray(offset, boxData.byteLength);
    return { scheme_id_uri, value, 
            timescale, presentation_time, 
            presentation_time_delta, 
            event_duration, id, 
            message_data };
};

var scaleTime = function(presentationTime, timescale, timeDelta, offset) {
    return presentationTime ? presentationTime / timescale : offset + timeDelta / timescale;
};

// TODO: This may need to return more ID3 specific data rather than just data, pts, duration.
var getEmsgData = function(data, ptOffset) {
    var emsgBoxes = findBox(data, ['emsg']);
    var parsedBoxes = [];
    emsgBoxes.forEach(function(boxData) {
        // TODO: We may need to check for ID3 specific schemeIdURI before returning data.
        var parsedBox = parseEmsgBox(boxData);
        var pts = scaleTime(parsedBox.presentation_time, parsedBox.timescale, parsedBox.presentation_time_delta, ptOffset);
        var duration = scaleTime(parsedBox.duration, parsedBox.timescale);
        parsedBoxes.push({
            data: parsedBox.message_data,
            pts,
            duration,
        });
    });
    return parsedBoxes;
};

module.exports = getEmsgData;