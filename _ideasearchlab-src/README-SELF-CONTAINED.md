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

## Note on the old repo (safe to delete)

The standalone `github.com/konstantinosStouras/ideasearchlab` repo is **redundant
and safe to delete**. This vendored copy is the authoritative source — it is
newer than that repo ever was, and a clean `npm run build` here reproduces the
live `lab/ideasearchlab/` bundle byte-for-byte. The only thing unique to the old
repo is its `.github/workflows/deploy.yml` (the CI we no longer use), so deleting
the repo loses nothing of value.

Until it is deleted, that dormant GitHub Action is a landmine: any push to the old
repo's `main` would rebuild from its **stale** source and overwrite
`lab/ideasearchlab/`. To remove it:

1. GitHub → the `ideasearchlab` repo → **Settings → Danger Zone → Delete this
   repository** (or **Archive** if you'd rather keep a read-only copy).
2. Nothing else references it — no app in this repo depends on it.

The Firebase project (`ideasearchlab`) and its Cloud Functions are unaffected;
the functions source lives here in `functions/` and deploys with
`firebase deploy --only functions`.
