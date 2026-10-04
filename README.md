# adthakur: personal portfolio

A four-page portfolio site for Aditya Bikram Thakur, live at https://adthakur.com. It is plain HTML, CSS, and a little JavaScript.
There is no framework and no build step, so what you see in these files is exactly what the browser gets.

## What's in the folder

The design is a dark, minimal, four-page layout inspired by hemss.me, with your own content and a pixel
background written from scratch.

| File | What it does |
| --- | --- |
| `index.html` | About page: name, photo (Fig. 1.1) and short bio. |
| `projects.html` | DiatoMeter, Nepalingo, SATitude, walden.life, each with a figure. |
| `experience.html` | Incubate Nepal (links to the Nepalingo project), Lipi AI, education and certificates. |
| `contact.html` | Email, LinkedIn, GitHub, résumé. Has the pixel mountains at the bottom. |
| `styles.css` | How everything looks. Colors are "tokens" at the very top (like `--background`), so one change recolors the whole site, in light and dark mode. |
| `site.js` | The theme button (system → light → dark) and the little notes that pop up over dashed phrases. |
| `pixels.js` | The animated pixel background. Comments at the top explain how it works. |
| `assets/` | Images, the résumé PDF, and the tab icon. |
| `_headers` | Tells Cloudflare to have browsers re-check files before reusing saved copies, so edits show up right away. |
| `archive/` | The first version of the site, kept as a backup on this computer only (not in Git, not published). |

The header and the phone tab bar are copied into all four pages. If you rename a page or add one,
change the menu in each file.

## Adding your images

- **Your photo:** replace `assets/photo.jpg` (currently a 1400 x 1050 crop, 4:3). If the new photo has a
  different shape, update the `width` and `height` on its `<img>` in `index.html`, and edit the `Fig. 1.1` caption.
- **A project image:** copy the `<figure class="figure">` block from the DiatoMeter entry in `projects.html`,
  point it at your new file in `assets/`, and number the caption Fig. 2.2, 2.3, and so on.
- Keep images under about 500 KB so the pages load fast. On a Mac you can shrink one with
  `sips -Z 1600 photo.jpg`.

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

- New project: copy one of the `<article class="entry">` blocks in `projects.html` and change the words.
- New résumé: replace `assets/aditya-thakur-resume.pdf` with the new PDF, keeping the same file name.
- Different colors: change the tokens near the top of `styles.css` (one set for light mode, one for dark).
