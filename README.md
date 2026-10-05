# adthakur: the story so far

A one-page site for Aditya Bikram Thakur, live at https://adthakur.com. It tells the story so far in chapters,
from Pokhara to DiatoMeter, each with an ink drawing or a real screenshot. It is plain HTML, CSS, and a little
JavaScript. There is no framework and no build step, so what you see in these files is exactly what the browser gets.

## What's in the folder

| File | What it does |
| --- | --- |
| `index.html` | The whole site: your name and photo, then nine chapters, ending with how to reach you. Each chapter is a `<section class="chapter">`; the words are plain paragraphs you can edit directly. |
| `ink.js` | The ink drawings. Any `<canvas class="ink" data-scene="...">` gets that scene, which draws itself with brush strokes the first time you scroll to it. The handwritten label on each drawing is in `SCENES` near the bottom. |
| `styles.css` | How everything looks. Colors are "tokens" at the very top (like `--background`), in light and dark mode. |
| `site.js` | The theme button (system → light → dark). |
| `pixels.js` | The animated dot pattern behind the top of the page. |
| `assets/` | Your photo, project screenshots, certificate images, the résumé PDF, and the tab icon. |
| `_headers` | Tells Cloudflare to have browsers re-check files before reusing saved copies, so edits show up right away. |
| `_redirects` | The site used to have separate pages; this forwards old links like `/projects` to the right chapter. |
| `archive/` | The very first version of the site, kept as a backup on this computer only (not in Git, not published). |

## Adding a chapter

Copy one `<section class="chapter">` block in `index.html`, change the number, date, title and paragraphs, and
give it a new `id`. For a drawing, reuse a `data-scene` name from `SCENES` in `ink.js`; for a photo or
screenshot, use a `<figure class="figure">` block like the ones in the Nepalingo or DiatoMeter chapters.

## Your photo

Replace `assets/photo.jpg` (currently a 1200 x 1200 square, shown up to 520px wide). Frame it so there's room
below your chin; a crop that ends at the chin looks like the head was cut off. If the new photo has a different
shape, update the `width` and `height` on its `<img>` in `index.html`.

## See it on your own computer

Open a terminal in this folder and run:

```bash
python3 -m http.server 8417
```

Then open http://localhost:8417 in a browser. Press Ctrl+C in the terminal to stop it.

## Where it's hosted

The code lives on GitHub at **https://github.com/sirElvinn/adthakur**, and the site is live at
**https://adthakur.com** (also **www.adthakur.com** and **adthakur-site.pages.dev**).

It runs on Cloudflare Pages, in the project named `adthakur-site`, which is connected to the GitHub repo.
There is no build step: Cloudflare serves the files in this repo exactly as they are.
(An older project called `adthakur` was the first, upload-only version; it is no longer attached to the domain.)

## Publishing a change

Every push to the `main` branch publishes itself. Open a terminal in this folder and run:

```bash
git add -A && git commit -m "Describe what you changed" && git push
```

About a minute later the change is live on adthakur.com. In Cloudflare, **Workers & Pages → adthakur-site →
Deployments** lists every version, and any earlier one can be put back with one click ("Rollback").

## Keeping it up to date

- New résumé: replace `assets/aditya-thakur-resume.pdf` with the new PDF, keeping the same file name.
- Different colors: change the tokens near the top of `styles.css` (one set for light mode, one for dark).
