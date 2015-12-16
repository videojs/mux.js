'use strict';

module.exports = function (grunt) {
  grunt.initConfig({
    browserify: {
      options: {
        browserifyOptions: {
          debug: true,
          standalone: 'muxjs'
        },
        plugin: [
        /*  ['browserify-derequire']*/
        ],
        transform: [
          require('babelify').configure({
            sourceMapRelative: './',
            loose: ['all']
          })
        ]
      },
      build: {
        files: {
          'dist/mux.js': ['lib/index.js']
        }
      },
      watch: {
        options: {
          watch: true,
          keepAlive: true
        },
        files: {
          'dist/mux.js': ['lib/index.js']
        }
      }
    },
    jshint: {
      options: {
        browserify: true,
        node: true,
        browser: true
      },
      src: './lib'
    }
  });

  require('load-grunt-tasks')(grunt);

  grunt.registerTask('build', ['jshint', 'browserify:build']);
  grunt.registerTask('watch', ['browserify:watch']);
};
