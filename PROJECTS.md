# Independent projects and unchanged website addresses

Application source now lives in separate repositories. This repository is the homepage, shared site assets, the literature service and its existing data automations, and the publishing map for the independent projects.

`.github/projects.json` maps each original website path to its own source repository. `.gitmodules` pins exact source commits at those same paths. GitHub Pages pulls public submodules when building the existing Jekyll website. Do not add `.nojekyll`, change CNAME, or publish a second Pages site over any of these mounted paths.

## Everyday work

Edit and commit an application in its own sibling repository under the local GitHub folder. Push that application normally. The **Publish independent projects** workflow checks for updates twice per hour, updates only the publishing references, runs the existing integration checks, and requests a GitHub Pages rebuild. GitHub schedules can be delayed. For immediate publication after a push:

```cmd
gh workflow run sync-projects.yml --repo konstantinosStouras/konstantinosStouras.github.io
```

For an assembled local integration checkout, run `git submodule update --init --recursive`. For an uncluttered homepage-only checkout, keep the submodule paths excluded by sparse checkout and work on the sibling clones instead. The submodules are publishing references; they do not duplicate the app source in this repository's history going forward.

## Preserved dependencies

Public paths, relative imports, shared account widgets, Firebase project identities, and underscore-prefixed nonserved source directories retain their original locations in the assembled website. Backend and build-source repositories are labelled separately in the map. Deploy Firebase only with the explicitly named project and the existing project guards.

The literature service has eight existing repository secrets and many data-writing schedules. It remains here until those credentials and jobs can be moved together; never turn its folder into a read-only reference while its workflows still write to it. Its private secret values cannot be read back from GitHub to copy to another repository.

## Migration and recovery

Each source repository's first commit contains the exact original Git tree, with the original repository commit and folder recorded in its commit message. The homepage repository retains all earlier history. Roll back a project publishing reference to a known good source commit if an app regresses. Keep older working copies with local edits until their changes are reconciled.
