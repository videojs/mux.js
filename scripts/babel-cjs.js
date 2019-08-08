module.exports = {
  presets: [['@babel/preset-env', {
    loose: true,
    modules: 'cjs',
    targets: {browsers: ['defaults', 'ie 11']}
  }]]
};
