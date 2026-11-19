# analysis/

Python worker that reads a recording and writes what happened in it. The app starts it
for you (Analyze button); you never talk to it directly, but you can:

    python3 analysis/setup.py      # once: venv, numpy + opencv, card art
    analysis/.venv/bin/python analysis/analyze.py VIDEO OUT.json   # run by hand

Output (`<recording>/analysis/analysis.json`): `events` (every card played, with team,
slot, time), `hands` (what each slot held and when), `elixir` (both bars at 10 Hz).
Cards with no reference art are saved as `unknown-N.png` next to it.

- `layout.py`  where things are on screen (pixels at 1170x2532, rescaled for other sizes)
- `cards.py`   reference art + matching
- `analyze.py` decoding, tracking, play detection

Teams: `red` is the top of the screen, `blue` the bottom.
Needs ffmpeg + ffprobe on PATH. Override Python with `PEKKA_PYTHON`.

## Cards missing from the downloaded art

Evolved and hero cards are drawn differently in-game than in the downloaded art, so some
show up as "Unknown card N". Name them once in the Plays tab: the picture is saved to
`~/pekka-library/cards/custom/` (`name.png`, `name~2.png`, ...) and every later analysis
recognises it. Hero cards that are in the downloaded art are found automatically.
