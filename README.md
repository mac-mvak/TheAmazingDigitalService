# The Amazing Digital Service

A small TypeScript website: looping video on top, a text input, and an image fetch.

## Live site

https://mac-mvak.github.io/TheAmazingDigitalService/

Pushes to `main` build the site and deploy it with GitHub Actions. The workflow turns Pages on automatically. If the repo is private on the free plan, GitHub will still 404 until the repo is public.

## Run it locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

- The hero uses a looping muted video from `public/video/hero.mp4`.
- The archive still in `public/images/fetched-input.jpg` was fetched from Picsum and committed to the repo.
- Type a word and submit to fetch another still (`https://picsum.photos/seed/<query>/…`).

## Build

```bash
npm run build
npm run preview
```

To preview the GitHub Pages path locally:

```bash
GITHUB_PAGES=true npm run build
GITHUB_PAGES=true npm run preview
```

Then open [http://localhost:4173/TheAmazingDigitalService/](http://localhost:4173/TheAmazingDigitalService/).
