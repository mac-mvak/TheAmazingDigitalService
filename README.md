# The Amazing Digital Service

A small TypeScript website: looping video on top, a text input, and an image fetch.

## Live site

After this repo is merged to `main` and GitHub Pages is enabled (Settings → Pages → Source: **GitHub Actions**), the site is at:

https://mac-mvak.github.io/TheAmazingDigitalService/

This repository is currently private. GitHub Pages on a private repo needs GitHub Pro, Team, or Enterprise; on the free plan, make the repo public first.

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
