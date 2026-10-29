import mp2t from '../lib/m2ts';

var metadataStream = new mp2t.MetadataStream();

self.addEventListener('message', function(e) {
  metadataStream.on('data', function(data) {
    self.postMessage(data);
  });
  metadataStream.push(e.data);
});
