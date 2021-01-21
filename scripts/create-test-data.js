const fs = require('fs');
const path = require('path');
const baseDir = path.join(__dirname, '..');
const segmentsDir = path.join(baseDir, 'test', 'segments');

const getSegments = () => (fs.readdirSync(segmentsDir) || [])
  .filter((f) => ((/\.(ts|mp4|key|webm|aac|ac3|m4s)/).test(path.extname(f))))
  .map((f) => path.resolve(segmentsDir, f));

const buildSegmentString = function() {
  const segmentData = {};

  getSegments().forEach((file) => {
    // read the file directly as a buffer before converting to base64
    const base64Segment = fs.readFileSync(file).toString('base64');

    segmentData[path.basename(file)] = base64Segment;
  });

  let segmentsFile =
    'import base64ToUint8Array from "@videojs/vhs-utils/es/decode-b64-to-uint8-array.js";\n' +
    'const segments = {\n';

  Object.keys(segmentData).forEach((key) => {
    // use a function since the segment may be cleared out on usage
    segmentsFile += `  '${key}': () => base64ToUint8Array('${segmentData[key]}'),\n`;
  });

  segmentsFile += '};\nexport default segments;';

  return segmentsFile;
};

/* we refer to them as .js, so that babel and other plugins can work on them */
const segmentsKey = 'create-test-data!segments.js';

module.exports = function() {
  return {
    name: 'createTestData',
    buildStart() {
      this.addWatchFile(segmentsDir);

      [].concat(getSegments())
        .forEach((file) => this.addWatchFile(file));
    },
    resolveId(importee, importer) {
      // if this is not an id we can resolve return
      if (importee.indexOf('create-test-data!') !== 0) {
        return;
      }

      const name = importee.split('!')[1];

      if (name.indexOf('segments') === 0) {
        return segmentsKey;
      }
    },
    load(id) {
      if (id === segmentsKey) {
        return buildSegmentString.call(this);
      }
    }
  };
};
