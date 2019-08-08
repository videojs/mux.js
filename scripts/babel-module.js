
module.exports = {
  presets: [['@babel/preset-env', {
    loose: true,
    modules: false,
    targets: {browsers: ['defaults', 'ie 11']}
  }]]
};
