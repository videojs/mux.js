module.exports = {
  tag: require('./flv-tag'),
  Transmuxer: require('./transmuxer').Transmuxer,
  AudioSegmentStream: require('./transmuxer').AudioSegmentStream,
  VideoSegmentStream: require('./transmuxer').VideoSegmentStream,
  CoalesceStream: require('./coalesce-stream')
};
