const generate = require('videojs-generate-rollup-config');
const createTestData = require('./create-test-data.js');

// see https://github.com/videojs/videojs-generate-rollup-config
// for options

const shared = {
  primedPlugins(defaults) {
    return Object.assign(defaults, {
      createTestData: createTestData()
    });
  },
  plugins(defaults) {
    defaults.test.splice(0, 0, 'createTestData');

    return defaults;
  }
};
const mainBuilds = generate(Object.assign({input: 'lib/index.js', distName: 'mux', exportName: 'muxjs'}, shared)).builds;
const mp4Builds = generate({input: 'lib/mp4/index.js', distName: 'mux-mp4', exportName: 'muxjs'}).builds;
const flvBuilds = generate({input: 'lib/flv/index.js', distName: 'mux-flv', exportName: 'muxjs'}).builds;

const allBuilds = [];

if (mainBuilds.test) {
  allBuilds.push(mainBuilds.test);
}

if (mainBuilds.browser) {
  allBuilds.push(mainBuilds.browser, mp4Builds.browser, flvBuilds.browser);
}

// export the builds to rollup
export default allBuilds;
