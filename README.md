# adthakur: the story so far, as a film

adthakur.com is one full screen: a short film, drawn live in the browser with JavaScript "brush strokes"
(no images, no video). The viewer drives it. A click, tap, swipe or the arrow keys reveal the next caption,
and after a shot's last caption the camera moves to the next shot. All words appear only in the
handwritten caption boxes.

The main story is just my life: Pokhara, Budhanilkantha School, moving to Lexington for Washington and Lee.
It ends on a choice: **projects**, **experience**, **words I live by** (two quotes that give meaning to my life)
or **résumé**, plus email, GitHub and LinkedIn. Projects, experience and words each open on a gallery: small
ink pictures pegged to a line, one per story. Clicking a picture plays that story's short film, which then
returns to the gallery, so nobody has to sit through anything they didn't pick.

## What's in the folder

| File | What it does |
| --- | --- |
| `index.html` | The page: one canvas for the film, plus a hidden text version of the whole story for screen readers, search engines, and browsers without JavaScript. |
| `film.js` | Everything you see: the brush engine, the drawn scenes, the galleries, the caption boxes, the camera moves, and the controls. |
| `styles.css` | Makes the film fill the screen with no scrolling, and places the invisible real links over the drawn link boxes. |
| `assets/` | The résumé PDF and the tab icon. (Older photos and screenshots are still here but no longer used.) |
| `_headers` | Tells Cloudflare to have browsers re-check files before reusing saved copies, so edits show up right away. |
| `_redirects` | Old links like `/projects` forward to the matching shot (for example `/#lipi-ai`). |
| `archive/` | The very first version of the site, kept as a backup on this computer only (not in Git, not published). |

## Changing the words

Open `film.js` and find `SHOT` near the bottom. Each shot has the scene it draws, where its caption boxes sit
(`anchor`: `tl` top-left, `tr`, `bl`, `br`, or `tc` top-center), its `lines` (the caption boxes, in order), and
optionally `links` (clickable boxes such as "visit ↗") and `choices` (boxes that start another section).
A line written as a list, like `[["first part", "second part", "\nthird part"]]`, is one box that grows: each
part is its own click and types into the same box (a part starting with `\n` starts a new line in the box).
A gallery shot has `items`: the shots it shows as pictures, with the label written under each.

`TRACKS`, just below, sets the order: `main` is the life story, and `projects`, `experience`, `words` and `resume`
are the sections viewers can choose at the end. A section whose first shot is a gallery treats the rest as its
pictures. To add a section, add its shots to `SHOT`, list them in a new track, and add a choice for it in the
`today` shot. To add another quote, copy the `penguins` shot, give it a new name and scene, add that name to
the `words` track, and add it to the `items` of the `words` gallery. Keep each line short; long
lines wrap inside the box. If you change the story, update the hidden text version in `index.html` too.

You can link straight to a shot or a section, for example https://adthakur.com/#diatometer or
https://adthakur.com/#projects.

## Controls

- Next: click or tap (anywhere but the left edge), swipe left, or press → / Space / Enter.
- Back: click the left edge, swipe right, or press ←.
- Back to the gallery from inside a story, or to the choices from a gallery: Escape (or ← at the start).
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
