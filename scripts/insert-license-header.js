/*! @license
 * mux.js
 * Copyright (c) Brightcove
 * SPDX-License-Identifier: Apache-2.0
 */
var fs = require('fs');

var fileOptions = {encoding: 'utf-8'};

var bundlePath = process.argv[2];
var bundleContents = fs.readFileSync(bundlePath, fileOptions);

var thisScriptSource = fs.readFileSync(__filename, fileOptions);
var licenseHeader = thisScriptSource.split('*/')[0] + '*/\n';

fs.writeFileSync(bundlePath, licenseHeader + bundleContents, fileOptions);
