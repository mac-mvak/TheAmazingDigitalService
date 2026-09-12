# The Amazing Digital Service

An AI assistant that lives inside the picture: chat overlays the image, and “show me …” replaces the scene.

## Live site

https://mac-mvak.github.io/TheAmazingDigitalService/

Pushes to `main` build the site and push it to the `gh-pages` branch. The live URL is:

https://mac-mvak.github.io/TheAmazingDigitalService/

If that URL 404s, enable Pages once: [Settings → Pages](https://github.com/mac-mvak/TheAmazingDigitalService/settings/pages) → Source **Deploy from a branch** → `gh-pages` / (root).

## Run it locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

- The assistant sits on the image. Enter sends, Shift+Enter adds a line.
- Image requests (`show me a harbor at dusk`) replace the whole scene, not a thumbnail.
- Other questions try a public text model, then Wikipedia, then a local reply.

## Build

```bash
npm run build
npm run preview
```
