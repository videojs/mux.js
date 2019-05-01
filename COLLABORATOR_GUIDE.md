# Table of Contents
- [Releasing](#releasing)

# Releasing

- Ensure the tests are passing on master
- You may need to be granted npm publish permissions if this is your first time publishing. Try to get this working first!
- Version on npm `npm version [patch|minor|major]`
- Push changes from versioning to master, and the new tag you just created `git push && git push --tags`. You can also push the specific tag with `git push [remote] [tag]`
- Publish on npm `npm publish`
- Go to https://github.com/videojs/mux.js/releases
- Click "Draft a new release"
- Fill out the form with the released version and upload the files in the `/dist` directory
