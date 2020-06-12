/**
 * mux.js
 *
 * Copyright (c) Brightcove
 * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
 */
var fs = require('fs');

var fileOptions = {encoding: 'utf-8'};

var bundlePath = process.argv[2];
var bundleContents = fs.readFileSync(bundlePath, fileOptions);

var thisScriptSource = fs.readFileSync(__filename, fileOptions);
var licenseHeader = thisScriptSource.split('*/')[0] + '*/\n';

fs.writeFileSync(bundlePath, licenseHeader + bundleContents, fileOptions);
