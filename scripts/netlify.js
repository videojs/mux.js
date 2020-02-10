const shell = require('shelljs');

shell.exec('git clone https://github.com/videojs/http-streaming');
shell.cd('http-streaming');
shell.exec('npm ci');
shell.exec('npm link ../');
shell.exec('npm run netlify');
shell.cp('-R', 'deploy',  '../');
shell.cd('..');
shell.rm('-rf', 'http-streaming');
