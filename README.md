# adthakur: the story so far, as a film

adthakur.com is one full screen: a short film, drawn live in the browser with JavaScript "brush strokes"
(no images, no video). The viewer drives it. A click, tap, swipe or the arrow keys reveal the next caption,
and after a shot's last caption the camera moves to the next shot. All words appear only in the
handwritten caption boxes. The last shot has clickable boxes for email, GitHub, LinkedIn and the résumé.

There is no framework and no build step, so what you see in these files is exactly what the browser gets.

## What's in the folder

| File | What it does |
| --- | --- |
| `index.html` | The page: one canvas for the film, plus a hidden text version of the whole story for screen readers, search engines, and browsers without JavaScript. |
| `film.js` | Everything you see: the brush engine, the ten drawn scenes, the caption boxes, the camera moves, and the controls. |
| `styles.css` | Makes the film fill the screen with no scrolling, and places the invisible real links over the drawn link boxes. |
| `assets/` | The résumé PDF and the tab icon. (Older photos and screenshots are still here but no longer used.) |
| `_headers` | Tells Cloudflare to have browsers re-check files before reusing saved copies, so edits show up right away. |
| `_redirects` | Old links like `/projects` forward to the matching shot (for example `/#lipi-ai`). |
| `archive/` | The very first version of the site, kept as a backup on this computer only (not in Git, not published). |

## Changing the words

Open `film.js` and find `SHOTS` near the bottom. Each shot has an `id`, the scene it draws, where its caption
boxes sit (`anchor`: `tl` top-left, `tr`, `bl`, `br`, or `tc` top-center), how the camera arrives (`enter`:
`pan`, `rise`, `zoom` or `wipe`), and its `lines`, the caption boxes in order. Keep each line short; long lines
wrap onto two lines inside the box. If you change the story, update the hidden text version in `index.html` too.

You can link straight to a shot with its id, for example https://adthakur.com/#diatometer.

## Controls

- Next: click or tap (anywhere but the left edge), swipe left, or press → / Space / Enter.
- Back: click the left edge, swipe right, or press ←.
- Start over: Home, or the "watch again" box at the end.

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
