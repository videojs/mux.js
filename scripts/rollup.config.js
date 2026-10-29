const generate = require('videojs-generate-rollup-config');
const dataFiles = require('rollup-plugin-data-files');
const worker = require('rollup-plugin-worker-factory');

// see https://github.com/videojs/videojs-generate-rollup-config
// for options

// videojs-generate-rollup-config 6.2.2 and later inline global/window in the
// browser builds, which changes the UMD wrapper that mux.js has always shipped
const browserGlobals = {
  globals(defaults) {
    Object.assign(defaults.browser, {
      global: 'window',
      'global/window': 'window',
      'global/document': 'document'
    });

    return defaults;
  },
  plugins(defaults) {
    defaults.browser = defaults.browser.filter((name) => name !== 'externalGlobals');

    return defaults;
  }
};

const shared = {
  primedPlugins(defaults) {
    defaults = Object.assign(defaults, {
      dataFiles: dataFiles({
        segments: {include: 'test/segments/**'}
      })
    });

    defaults.worker = worker({plugins: [
      defaults.resolve,
      defaults.json,
      defaults.commonjs,
      defaults.babel
    ]});

    return defaults;
  },
  globals: browserGlobals.globals,
  plugins(defaults) {
    defaults = browserGlobals.plugins(defaults);
    defaults.module.splice(2, 0, 'worker');
    defaults.browser.splice(2, 0, 'worker');
    defaults.test.splice(3, 0, 'worker');
    defaults.test.splice(0, 0, 'dataFiles');

    // istanbul is only in the list for regular builds and not watch
    if (defaults.test.indexOf('istanbul') !== -1) {
      defaults.test.splice(defaults.test.indexOf('istanbul'), 1);
    }

    return defaults;
  }
};
const mainBuilds = generate(Object.assign({input: 'lib/index.js', distName: 'mux', exportName: 'muxjs'}, shared)).builds;
const mp4Builds = generate(Object.assign({input: 'lib/mp4/index.js', distName: 'mux-mp4', exportName: 'muxjs'}, browserGlobals)).builds;
const flvBuilds = generate(Object.assign({input: 'lib/flv/index.js', distName: 'mux-flv', exportName: 'muxjs'}, browserGlobals)).builds;

const allBuilds = [];

if (mainBuilds.test) {
  allBuilds.push(mainBuilds.test);
}

if (mainBuilds.browser) {
  allBuilds.push(mainBuilds.browser, mp4Builds.browser, flvBuilds.browser);
}

// export the builds to rollup
export default allBuilds;
