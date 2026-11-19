#!/usr/bin/env python3
"""
PEKKA analysis worker.

    python analysis/analyze.py VIDEO OUT.json [--cards DIR] [--fps 30]

Reads a Clash Royale replay recording and writes OUT.json with:
  events   every card played, with team, slot and timestamp
  hands    which card each hand slot held, and for how long (diagnostics / training data)
  elixir   both elixir bars over time

While it runs it prints one JSON object per line to stdout:
  {"type":"progress","pct":0.42}  {"type":"warning","message":...}
  {"type":"done"}  or  {"type":"error","error":...}
The Next.js route relays these to the browser.

Needs ffmpeg + ffprobe on PATH, plus numpy and opencv (see requirements.txt).
"""
import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import cv2
import numpy as np

import layout as L
from cards import load_refs, match_fast, match_global, match_wide, same_card
from paths import cards_dir

TEAMS = ("red", "blue")  # red = top of the screen, blue = bottom

# Tracking thresholds (frames are analysed at --fps, 30 by default).
STABLE_CORR = 0.95   # frames this alike count as "the same picture"
HOLD_CORR = 0.90     # a settled card may wobble this much (glow, dimming)
STABLE_FRAMES = 5    # ...and must hold still this long to count as settled
MAX_MISSES = 2       # frames below HOLD_CORR before a card counts as gone
EMPTY_STD = 30.0     # an empty slot is a flat patch (std ~7-20); every card is 39+
KNOWN_MIN = 0.85     # fixed-position match this good = we know the card
DECK_MIN = 0.90      # ...and this good = it counts as part of that team's deck
WIDE_MIN = 0.85      # last resort for a card never seen sitting normally: matched
WIDE_MARGIN = 0.18   # against its own deck, and must clearly beat the runner-up
GLOBAL_MIN = 0.90    # a card drawn in an odd size (hero cards) found by searching all art
GLOBAL_MARGIN = 0.10 # ...must beat the next closest card by this much
SAME_UNKNOWN = 0.75  # two crops this alike are the same unknown card


def emit(**event):
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def fail(message):
    emit(type="error", error=message)
    sys.exit(1)


def probe(path):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height:format=duration",
             "-of", "json", path],
            capture_output=True, text=True, check=True,
        ).stdout
    except FileNotFoundError:
        fail("ffprobe isn't installed or isn't on your PATH.")
    except subprocess.CalledProcessError as e:
        fail(f"ffprobe couldn't read that video. {e.stderr.strip()}")
    info = json.loads(out)
    stream = info["streams"][0]
    return int(stream["width"]), int(stream["height"]), float(info["format"].get("duration") or 0)


def open_decoder(path, w, h, fps):
    """ffmpeg -> raw BGR frames holding just the two strips (opponent on top of you)."""
    s = w / L.REF_W
    sh = round(L.STRIP_H * s)
    top_y = round(L.TOP_STRIP_Y * s)
    bot_y = h - round((L.REF_H - L.BOT_STRIP_Y) * s)
    if bot_y + sh > h or top_y + sh > h:
        fail(f"This video ({w}x{h}) doesn't look like a phone recording of Clash Royale.")
    vf = (
        f"fps={fps},split=2[a][b];"
        f"[a]crop={w}:{sh}:0:{top_y}[t];[b]crop={w}:{sh}:0:{bot_y}[u];"
        f"[t][u]vstack,scale={L.REF_W}:{2 * L.STRIP_H}:flags=area"
    )
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-an", "-vf", vf,
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    try:
        return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError:
        fail("ffmpeg isn't installed or isn't on your PATH.")


# --- geometry in the stacked strip frame -------------------------------------------
def slot_origin(team, i):
    if team == 0:  # red, top strip
        return L.SLOT_X[i], L.TOP_CARD_Y - L.TOP_STRIP_Y
    return L.SLOT_X[i], L.STRIP_H + (L.BOT_CARD_Y - L.BOT_STRIP_Y)


ELIXIR_Y = (L.TOP_ELIXIR_Y - L.TOP_STRIP_Y, L.STRIP_H + (L.BOT_ELIXIR_Y - L.BOT_STRIP_Y))


def slot_feature(gray, x, y):
    art = gray[y + L.ART_Y : y + L.ART_Y + L.ART_H, x + L.ART_X : x + L.ART_X + L.ART_W]
    small = cv2.resize(art, (24, 24), interpolation=cv2.INTER_AREA).astype(np.float32)
    texture = float(small.std())
    v = small - small.mean()
    return (v / (np.linalg.norm(v) + 1e-6)).ravel(), texture


def read_elixir(frame, y):
    """Elixir as a number: whole points (bright segments) + progress to the next (dim part)."""
    seg_w = L.ELIXIR_SEG_W
    x0, x1 = L.ELIXIR_X0, int(L.ELIXIR_X0 + 10 * seg_w) + 6
    row = frame[y - 3 : y + 4, x0:x1].astype(np.int16).mean(axis=0)  # (cols, BGR)
    b, g, r = row[:, 0], row[:, 1], row[:, 2]
    bright = np.flatnonzero((r > 180) & (b > 180) & (g < 110))
    bright_end = int(bright[-1]) + 1 if len(bright) else 0
    whole = int(round(bright_end / seg_w))
    if whole >= 10:
        return 10.0
    empty = row[int(9.7 * seg_w) : int(9.9 * seg_w)].mean(axis=0)
    differs = np.abs(row - empty).sum(axis=1) > 60
    end = bright_end
    while end < len(differs) and differs[end]:
        end += 1
    frac = min(max((end - whole * seg_w) / seg_w, 0.0), 0.999)
    return whole + frac


class Slot:
    """Follows one hand slot.

    When a card is played its slot goes blank for a moment before the next card slides
    in, so blank gaps mark plays. Between gaps the slot holds one card, which may be
    lifted, glowing or greyed out; we keep crops of the stretches where it sits still
    so the card can be identified from its clearest frames.
    """

    def __init__(self, team, index):
        self.team, self.index = team, index
        self.x, self.y = slot_origin(team, index)
        self.done = []          # settled stretches: {start, last, ref, crop}
        self.empties = []       # blank gaps: (first_frame, last_frame)
        self.seg = None         # the settled card right now
        self.cand = None        # something that might be settling
        self.misses = 0
        self.empty_start = None

    def _crop(self, frame):
        return frame[self.y : self.y + L.CARD_H, self.x : self.x + L.CARD_W].copy()

    def _close_segment(self):
        if self.seg is not None:
            self.done.append(self.seg)
        self.seg, self.misses = None, 0

    def update(self, n, frame, gray):
        f, texture = slot_feature(gray, self.x, self.y)
        if texture < EMPTY_STD:
            if self.empty_start is None:
                self.empty_start = n
            self._close_segment()
            self.cand = None
            return
        if self.empty_start is not None:
            self.empties.append((self.empty_start, n - 1))
            self.empty_start = None

        if self.seg is not None:
            if float(f @ self.seg["ref"]) >= HOLD_CORR:
                self.seg["last"] = n
                self.misses = 0
                return
            self.misses += 1
            if self.misses < MAX_MISSES:
                return
            self._close_segment()
            self.cand = None
        if self.cand is not None and float(f @ self.cand["ref"]) >= STABLE_CORR:
            self.cand["count"] += 1
        else:
            self.cand = {"start": n, "ref": f, "count": 1}
        if self.cand["count"] >= STABLE_FRAMES:
            self.seg = {"start": self.cand["start"], "last": n, "ref": self.cand["ref"],
                        "crop": self._crop(frame)}
            self.cand = None

    def finish(self):
        self._close_segment()


def split_periods(slot):
    """Cut a slot's history into periods, each holding one card.
    Returns [{start, last, segs, gap_before}] where gap_before is the frame at which the
    previous card left (None for the first period)."""
    segs = sorted(slot.done, key=lambda s: s["start"])
    cuts = [(a, b) for a, b in slot.empties]
    periods = []
    for seg in segs:
        # which blank gaps lie between the previous segment and this one?
        gap = None
        if periods:
            prev_last = periods[-1]["segs"][-1]["last"]
            between = [c for c in cuts if prev_last < c[0] <= seg["start"]]
            if between:
                gap = between[0][0]
        elif cuts and cuts[0][0] < seg["start"]:
            gap = None  # blank before anything settled: nothing to attribute
        if gap is not None or not periods:
            periods.append({"segs": [seg], "gap_before": gap})
        else:
            periods[-1]["segs"].append(seg)
    return periods


def identify(slots, refs, out_dir):
    """Work out which card each period holds, and split periods where two different
    cards clearly follow each other with no blank gap in between."""
    # 1. Fast match: a card sitting normally in its place matches its art almost perfectly.
    for slot in slots:
        for seg in slot.done:
            ranked = match_fast(seg["crop"], refs)
            seg["score"] = round(ranked[0][1], 3) if ranked else 0.0
            seg["best"] = ranked[0][0] if ranked else None
            seg["alt"] = [(n, round(sc, 3)) for n, sc in ranked[1:3]]
            seg["sure"] = bool(ranked) and ranked[0][1] >= DECK_MIN

    # 2. Periods, plus a split wherever two *sure* different cards meet without a gap.
    for slot in slots:
        out = []
        for per in split_periods(slot):
            cur = None
            for seg in per["segs"]:
                if cur is not None and seg["sure"]:
                    sure = [x for x in cur["segs"] if x["sure"]]
                    if sure and sure[-1]["best"] != seg["best"]:
                        out.append(cur)
                        cur = {"segs": [], "gap_before": cur["segs"][-1]["last"] + 1}
                if cur is None:
                    cur = {"segs": [], "gap_before": per["gap_before"]}
                cur["segs"].append(seg)
            if cur:
                out.append(cur)
        slot.periods = out

    # 3. Name each period from its best fixed-position match.
    deck = {team: set() for team in TEAMS}
    for slot in slots:
        for per in slot.periods:
            best = max(per["segs"], key=lambda s: s["score"])
            per["card"], per["score"], per["alt"] = None, best["score"], best["alt"]
            if best["score"] >= KNOWN_MIN:
                per["card"] = best["best"]
            if best["score"] >= DECK_MIN:
                deck[TEAMS[slot.team]].add(best["best"])

    # 4. Last resort. A card that is never seen sitting normally (always lifted, glowing or
    #    greyed out) is compared with the cards we know that team has. The bar is high: a
    #    loose match here can't tell such a card from one we have no art for.
    for slot in slots:
        cards = deck[TEAMS[slot.team]]
        for per in slot.periods:
            if per["card"] or not cards:
                continue
            tried = sorted(per["segs"], key=lambda s: s["last"] - s["start"], reverse=True)[:4]
            best = (0.0, None, 0.0)
            for seg in tried:
                ranked = match_wide(seg["crop"], refs, cards)
                if ranked:
                    runner = ranked[1][1] if len(ranked) > 1 else -1.0
                    if ranked[0][1] > best[0]:
                        best = (ranked[0][1], ranked[0][0], ranked[0][1] - runner)
            if best[1] and best[0] >= WIDE_MIN and best[2] >= WIDE_MARGIN:
                per["card"], per["score"] = best[1], round(best[0], 3)

    # 5. Whatever is left. Group repeats of the same card, then try each group against all
    #    the reference art once: hero cards are drawn zoomed in compared with the downloaded
    #    art, so a size-tolerant search can still name them. Anything still unnamed is
    #    saved as unknown-N so you can name it yourself.
    groups = []  # [rep crop, [periods]]
    for slot in slots:
        for per in slot.periods:
            if per["card"]:
                continue
            rep = max(per["segs"], key=lambda s: s["last"] - s["start"])["crop"]
            for g in groups:
                if same_card(rep, g[0]) >= SAME_UNKNOWN:
                    g[1].append(per)
                    break
            else:
                groups.append([rep, [per]])

    unknown = []
    for rep, pers in groups:
        ranked = match_global(rep, refs) if len(refs) else []
        if (len(ranked) > 1 and ranked[0][1] >= GLOBAL_MIN
                and ranked[0][1] - ranked[1][1] >= GLOBAL_MARGIN):
            for per in pers:
                per["card"], per["score"] = ranked[0][0], round(ranked[0][1], 3)
            continue
        label = f"unknown-{len(unknown) + 1}"
        unknown.append(label)
        cv2.imwrite(os.path.join(out_dir, f"{label}.png"), rep)
        for per in pers:
            per["card"] = label
    return unknown


def build_events(slots, fps, n_frames):
    events, hands = [], []
    for slot in slots:
        pers = slot.periods
        for i, per in enumerate(pers):
            start = per["segs"][0]["start"] if per["gap_before"] is None else per["gap_before"]
            nxt = pers[i + 1] if i + 1 < len(pers) else None
            ended = nxt["gap_before"] if nxt else None
            hands.append({
                "team": TEAMS[slot.team], "slot": slot.index,
                "card": per["card"], "score": per["score"],
                "start": round(start / fps, 3),
                "end": round((ended if ended is not None else n_frames) / fps, 3),
            })
            if ended is not None:
                events.append({
                    "t": round(ended / fps, 3),
                    "team": TEAMS[slot.team],
                    "slot": slot.index,
                    "card": per["card"],
                    "confidence": per["score"],
                    "replacedBy": nxt["card"],
                })
        # a card that left and nothing settled afterwards (clip ended)
        if slot.empties and pers:
            last_gap = slot.empties[-1][0]
            if last_gap > pers[-1]["segs"][-1]["last"]:
                events.append({
                    "t": round(last_gap / fps, 3), "team": TEAMS[slot.team], "slot": slot.index,
                    "card": pers[-1]["card"], "confidence": pers[-1]["score"], "replacedBy": None,
                })
    events.sort(key=lambda e: (e["t"], e["team"], e["slot"]))
    hands.sort(key=lambda h: (h["start"], h["team"], h["slot"]))
    return events, hands


def scan(path, w, h, fps, total):
    """Decode the video and follow every hand slot and both elixir bars."""
    proc = open_decoder(path, w, h, fps)
    frame_bytes = L.REF_W * 2 * L.STRIP_H * 3
    slots = [Slot(t, i) for t in (0, 1) for i in range(4)]
    elixir = ([], [])
    stride = max(fps // 10, 1)
    n = 0
    last_emit = 0.0

    while True:
        buf = proc.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(2 * L.STRIP_H, L.REF_W, 3)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        for s in slots:
            s.update(n, frame, gray)
        if n % stride == 0:
            for t in (0, 1):
                elixir[t].append(round(read_elixir(frame, ELIXIR_Y[t]), 2))
        n += 1
        now = time.monotonic()
        if now - last_emit > 0.4:
            emit(type="progress", pct=round(min(n / total, 0.98), 4))
            last_emit = now

    err = proc.stderr.read().decode(errors="replace").strip()
    code = proc.wait()
    if n == 0 or (code != 0 and n < 2):
        fail(f"ffmpeg couldn't read that video. {err}")
    for s in slots:
        s.finish()
    return slots, elixir, n, stride


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--cards", default=cards_dir())
    ap.add_argument("--fps", type=int, default=30)
    args = ap.parse_args()

    out_dir = os.path.dirname(os.path.abspath(args.out))
    os.makedirs(out_dir, exist_ok=True)

    refs = load_refs(args.cards)
    if not len(refs):
        emit(type="warning", message=(
            "No reference card art found, so cards will show as unknown. "
            "Run `python analysis/fetch_cards.py` once to download it."))

    w, h, duration = probe(args.video)
    slots, elixir, n, stride = scan(args.video, w, h, args.fps, max(int(duration * args.fps), 1))
    unknown = identify(slots, refs, out_dir)
    events, hands = build_events(slots, args.fps, n)

    result = {
        "version": 1,
        "created": datetime.now(timezone.utc).isoformat(),
        "video": os.path.basename(args.video),
        "fps": args.fps,
        "duration": round(n / args.fps, 3),
        "unknownCards": unknown,
        "events": events,
        "hands": hands,
        "elixir": {"hz": args.fps // stride, "red": elixir[0], "blue": elixir[1]},
    }
    tmp = args.out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(result, f)
    os.replace(tmp, args.out)
    emit(type="done", events=len(events), unknown=len(unknown))


if __name__ == "__main__":
    main()
