# The Amazing Digital Service

An AI assistant interface in TypeScript: chat on a looping video backdrop, with lookups and fetched stills.

## Live site

https://mac-mvak.github.io/TheAmazingDigitalService/

Pushes to `main` build and deploy with GitHub Actions. If the repo is private on the free plan, GitHub Pages will 404 until the repo is public.

## Run it locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

- The chat composer is the main interface. Enter sends, Shift+Enter adds a line.
- Image requests (`show me a harbor at dusk`) fetch a still.
- Other questions try a public text model, then Wikipedia, then a local reply.

## Build

```bash
npm run build
npm run preview
```
