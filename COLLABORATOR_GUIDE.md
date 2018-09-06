# Table of Contents
- [Releasing](#releasing)

# Releasing

- ensure the tests are passing on master
- version on npm `npm version [patch|minor|major]`
- push changes from versioning to master, and the new tags created `git push && git push --tags`
- https://github.com/videojs/mux.js/releases
- click "Draft a new release"
- fill out the form with the released version and upload the files in the `/dist` directory
- publish on npm `npm publish`. You may need to be granted permissions if this is your first time.
