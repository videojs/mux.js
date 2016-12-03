var transmuxer = require('./transmuxer');

module.exports = {
  tag: require('./flv-tag'),
  Transmuxer: transmuxer.Transmuxer,
  getFlvHeader: transmuxer.getFlvHeader
};
