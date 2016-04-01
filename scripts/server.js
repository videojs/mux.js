var express = require('express');
var path = require('path');
var serveStatic = require('serve-static');
var portscanner = require('portscanner');

// Configuration for the server.
var PORT = 9999;
var MAX_PORT = PORT + 100;
var HOST = '127.0.0.1';

var app = express();

app.use(serveStatic(path.join(__dirname, '..')));

portscanner.findAPortNotInUse(PORT, MAX_PORT, HOST, function(error, port) {
  if (error) {
    throw error;
  }

  console.log('Server started on ' + HOST + ':' + port);
  app.listen(port);
});
