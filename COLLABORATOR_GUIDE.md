# Table of Contents
- [Releasing](#releasing)

# Releasing

- Ensure the tests are passing on main
- You may need to be granted npm publish permissions if this is your first time publishing. Try to get this working first!
- Version on npm `npm version [patch|minor|major]`
- Push changes from versioning to main, and the new tag you just created `git push && git push --tags`. You can also push the specific tag with `git push [remote] [tag]`
