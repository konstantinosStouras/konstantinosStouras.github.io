# Independent projects and unchanged website addresses

Application source now lives in separate repositories. This repository is the homepage, shared site assets, the literature service and its existing data automations, and the publishing map for the independent projects.

`.github/projects.json` maps each project to its own source repository. `.gitmodules` pins exact website-source commits at the original public paths. GitHub Pages pulls those public submodules when building the existing Jekyll website. Archives, backend code, and build-only sources are held only in their separate repositories; production does not download them. Do not add `.nojekyll`, change CNAME, or publish a second Pages site over any mounted path.

## Everyday work

Edit and commit an application in its own sibling repository under the local GitHub folder. Push that application normally. The **Publish independent projects** workflow checks for updates twice per hour, updates only the publishing references, runs the existing integration checks, and requests a GitHub Pages rebuild. GitHub schedules can be delayed. For immediate publication after a push:

```cmd
gh workflow run sync-projects.yml --repo konstantinosStouras/konstantinosStouras.github.io
```

For an assembled local integration checkout, run `git submodule update --init --recursive`. For an uncluttered homepage-only checkout, keep the submodule paths excluded by sparse checkout and work on the sibling clones instead. The submodules are publishing references; they do not duplicate the app source in this repository's history going forward.

IdeaSearchLab is built in `ideasearchlab-source` and its compiled output is committed in `lab-ideasearchlab`; the homepage's `ideasearchlab-deploy-update.bat` now uses those sibling folders. Chinese Practice is built in `chinese-learning-source` (`npm run build`); copy its `site/chinese/` output into `chinese-learning`, commit and push the source and website repositories, then request publication. Keep older hashed assets when updating built sites during classes.

## Preserved dependencies

Public paths, relative imports, shared account widgets and Firebase project identities are preserved. Backend and build-source repositories are labelled separately in the map. Integration checks temporarily load the backend sources at their former paths to exercise the deployment guards; production never needs these directories. Deploy Firebase only with the explicitly named project and the existing project guards.

The literature service has eight existing repository secrets and many data-writing schedules. It remains here until those credentials and jobs can be moved together; never turn its folder into a read-only reference while its workflows still write to it. Its private secret values cannot be read back from GitHub to copy to another repository.

## Migration and recovery

Each source repository's first commit contains the exact original Git tree, with the original repository commit and folder recorded in its commit message. The homepage repository retains all earlier history. Roll back a project publishing reference to a known good source commit if an app regresses. Keep older working copies with local edits until their changes are reconciled.
