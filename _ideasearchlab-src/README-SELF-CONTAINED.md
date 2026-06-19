# Ideation Challenge — self-contained source

This folder holds the **complete source** for the app served at
`https://www.stouras.com/lab/ideasearchlab/`. It lives inside the main
`konstantinosStouras.github.io` repo so the app is fully self-contained: you do
**not** need the separate `github.com/konstantinosStouras/ideasearchlab` repo to
rebuild or deploy it.

The folder name starts with `_`, so GitHub Pages' Jekyll **does not publish it** —
the source is versioned in the repo but never served to the web. Only the built
bundle in `lab/ideasearchlab/` is served.

## Layout

- `src/`, `index.html`, `vite.config.js`, `package.json` — the React/Vite front end.
- `functions/`, `firebase.json`, `firestore.rules`, `.firebaserc` — the Firebase backend.

## Build & deploy (front end)

From the repo root, just run the helper script:

```cmd
ideasearchlab-deploy-update.bat
```

It builds this source, copies the bundle into `lab/ideasearchlab/`, commits, and
pushes — live in 1–2 minutes. Or do it by hand:

```cmd
cd _ideasearchlab-src
npm install        REM first time only
npm run build      REM outputs dist/ (index.html already has the SPA redirect + 404.html)
```

then copy `dist\*` into `..\lab\ideasearchlab\` and commit.

The Vite build is self-contained: a small `spaFallback` plugin in
`vite.config.js` injects the GitHub Pages SPA redirect into `index.html` and
writes `404.html`, so there is no separate `sed`/CI post-build step anymore.

## Deploy the Cloud Functions (backend)

Functions deploy separately through Firebase (needed for AI replies and the
delete-all-users admin action):

```cmd
cd _ideasearchlab-src
firebase deploy --only functions
```

## Note on the old repo

The standalone `github.com/konstantinosStouras/ideasearchlab` repo is now
redundant. To avoid its GitHub Action overwriting `lab/ideasearchlab/` from stale
source, **archive that repo or delete its `.github/workflows/deploy.yml`**.
