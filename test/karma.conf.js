// Karma configuration
// Generated on Tue Aug 25 2015 17:41:45 GMT-0400 (EDT)

module.exports = function(config) {
  config.set({

    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',


    // frameworks to use
    // available frameworks: https://npmjs.org/browse/keyword/karma-adapter
    frameworks: ['qunit'],


    // list of files / patterns to load in the browser
    files: [
      '../lib/utils/stream.js',
      '../lib/utils/exp-golomb.js',
      '../lib/mp4/mp4-generator.js',
      '../lib/tools/mp4-inspector.js',
      '../lib/codecs/aac.js',
      '../lib/codecs/h264.js',
      '../lib/m2ts/m2ts.js',
      '../lib/m2ts/caption-stream.js',
      '../lib/m2ts/metadata-stream.js',
      '../lib/mp4/transmuxer.js',
      '../lib/flv/flv-tag.js',
      '../lib/flv/transmuxer.js',

      'sintel-captions.js',
      'test-segment.js',
      'id3-generator.js',

      'exp-golomb-test.js',
      'mp4-generator-test.js',
      'mp4-inspector-test.js',
      'transmuxer-test.js',
      'metadata-stream-test.js',
      'caption-stream-test.js'
    ],


    // list of files to exclude
    exclude: [
    ],


    // preprocess matching files before serving them to the browser
    // available preprocessors: https://npmjs.org/browse/keyword/karma-preprocessor
    preprocessors: {
    },


    // test results reporter to use
    // possible values: 'dots', 'progress'
    // available reporters: https://npmjs.org/browse/keyword/karma-reporter
    reporters: ['progress'],


    // web server port
    port: 9876,


    // enable / disable colors in the output (reporters and logs)
    colors: true,


    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_INFO,


    // enable / disable watching file and executing tests whenever any file changes
    autoWatch: false,


    // start these browsers
    // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
    browsers: process.env.TRAVIS ? ['Firefox'] : ['Chrome'],


    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: false
  })
}
