# Dataset Library maintenance

Research task, methods, evidence standards, review queues and latest progress are maintained in the dataset fork:

- [Handoff and publication workflow](https://github.com/konstantinosStouras/datasets/blob/main/_research/HANDOFF.md)
- [Verification methods](https://github.com/konstantinosStouras/datasets/blob/main/_research/METHODS.md)
- [Current status and unfinished leads](https://github.com/konstantinosStouras/datasets/blob/main/_research/STATUS.md)

The owner requests updates to those Markdown files whenever new findings, methods, deployment details or blockers arise. Keep one authoritative handoff rather than divergent copies.

The fork's root `research-additions.json` and generated `catalog-public.json` are the live sources. Files here are bundled maintenance/fallback inputs and can lag behind; do not overwrite newer fork records with these copies. Never expose the full source JSON through the public website.

## Sharing assets

`../index.html` provides static Open Graph and Twitter Card tags, canonical URL, JSON-LD DataCatalog metadata, square thumbnail hints and icon links. `../og-image.jpg` is the existing 1200 × 630 branded preview. `../site.webmanifest` provides bookmark/home-screen identity; no offline functionality is implied.

Icons use the header's `d.` mark, green `#164f46` and cream `#fffdf6`. Rebuild with Pillow and a local Georgia regular font:

```sh
python make-icons.py --font /path/to/georgia.ttf
```

After changes, check one canonical URL/og:url, one og:image, real image dimensions/size, and all linked files. Verify live HTTP responses without login and with social crawler user agents after GitHub Pages completes. Actual app previews can remain cached; live tag checks are not tests within WhatsApp/Facebook/LinkedIn themselves.
