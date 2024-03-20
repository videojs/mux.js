const fs = require('fs');
const mp4 = require('./lib/mp4');
const file = fs.readFileSync(process.argv[2] || './bad-708.ts');

// https://github.com/google/ExoPlayer/blob/16b51d689c6a1a5ec327d1977a5fe8de9fefe41e/library/core/src/main/java/com/google/android/exoplayer2/text/cea/Cea708Decoder.java#L529
const transmuxer = new mp4.Transmuxer();

// Setting the BMDT to ensure that captions and id3 tags are not
// time-shifted by this value when they are output and instead are
// zero-based
transmuxer.setBaseMediaDecodeTime(100000);

transmuxer.on('data', function(data) {
  if (data.captions) {
    console.log(data.captions);
  }
});

transmuxer.push(file);
transmuxer.flush();
