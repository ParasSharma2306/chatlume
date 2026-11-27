# Browser tests

`npm run test:e2e` drives headless Chrome over the real viewers (served from
this checkout on 127.0.0.1:8765) using **generated** fixtures only — every
name, number, photo and voice note is synthetic.

- `fixtures/gen.py` builds the WhatsApp `.txt`/`.zip` and Instagram `.zip`
  exports into `fixtures/out/` (gitignored; needs python3 and ffmpeg). They
  are rebuilt automatically when `gen.py` changes, or with `--regen`.
- `devserver.py` serves the repo plus `/__fixtures__/` from the same origin.
- `cdp.mjs` is a dependency-free Chrome DevTools Protocol harness (set
  `CHROME_PATH` if Chrome isn't at the macOS default).
- `phase1.mjs` Anonymize · `phase2.mjs` media gallery · `phase3.mjs` Instagram reactions.

Screenshots and exported files land in `out/` (gitignored).
