"""Reference card art, and matching an in-game card against it."""
import os

import cv2
import numpy as np

import layout as L

# How much bigger/smaller than normal a card may look (picked-up cards grow a little).
WIDE_FACTORS = (0.9, 1.0, 1.1, 1.2, 1.3, 1.45)
COARSE_FACTORS = (1.0, 1.15, 1.3)
CENTER = 70  # side of the central window used by the wide search


def _art(gray):
    return gray[L.ART_Y : L.ART_Y + L.ART_H, L.ART_X : L.ART_X + L.ART_W]


def _center(gray):
    o = (L.ART_W - CENTER) // 2
    return gray[L.ART_Y + o : L.ART_Y + o + CENTER, L.ART_X + o : L.ART_X + o + CENTER]


class Refs:
    """Reference cards. A card can have several pictures (the downloaded art plus any
    crops you've named yourself), so names repeat."""

    def __init__(self):
        self.names, self.patches = [], []
        self.full = {}  # name -> [full gray images] for the wide search

    def __len__(self):
        return len(self.names)

    def unique_names(self):
        return sorted(set(self.names))

    def _add(self, name, patch, full):
        m = L.REF_MARGIN
        if patch.shape != (L.ART_H + 2 * m, L.ART_W + 2 * m):
            return
        self.names.append(name)
        self.patches.append(patch)
        self.full.setdefault(name, []).append(full)

    def load_dir(self, cards_dir):
        m = L.REF_MARGIN
        if not os.path.isdir(cards_dir):
            return
        for fn in sorted(os.listdir(cards_dir)):
            if not fn.lower().endswith(".png") or fn.lower().endswith("-hero-ev1.png"):
                continue  # "hero evo" isn't a thing: a card is one or the other
            img = cv2.imread(os.path.join(cards_dir, fn), cv2.IMREAD_UNCHANGED)
            if img is None:
                continue
            if img.ndim == 3 and img.shape[2] == 4:
                alpha = img[..., 3:4].astype(np.float32) / 255.0
                img = (img[..., :3] * alpha + 128 * (1 - alpha)).astype(np.uint8)
            elif img.ndim == 2:
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
            img = cv2.resize(img, None, fx=L.REF_SCALE, fy=L.REF_SCALE, interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            y0, x0 = L.REF_OFF_Y - m, L.REF_OFF_X - m
            self._add(fn[:-4], gray[y0 : y0 + L.ART_H + 2 * m, x0 : x0 + L.ART_W + 2 * m], gray)

    def load_custom(self, custom_dir):
        """Cards you've named yourself: saved in-game crops (145x180), already at game scale.
        `name.png`, `name~2.png`, ... are several pictures of the same card."""
        m = L.REF_MARGIN
        if not os.path.isdir(custom_dir):
            return
        for fn in sorted(os.listdir(custom_dir)):
            if not fn.lower().endswith(".png"):
                continue
            img = cv2.imread(os.path.join(custom_dir, fn))
            if img is None or img.shape[:2] != (L.CARD_H, L.CARD_W):
                continue
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            y0, x0 = L.ART_Y - m, L.ART_X - m
            self._add(fn[:-4].split("~")[0],
                      gray[y0 : y0 + L.ART_H + 2 * m, x0 : x0 + L.ART_W + 2 * m], gray)


def load_refs(cards_dir):
    refs = Refs()
    refs.load_dir(cards_dir)
    refs.load_custom(os.path.join(cards_dir, "custom"))
    return refs


def match_fast(card_bgr, refs):
    """Card sitting in its normal place. Returns [(name, score)] best first (top 3)."""
    if not len(refs):
        return []
    tmpl = _art(cv2.cvtColor(card_bgr, cv2.COLOR_BGR2GRAY))
    scores = np.empty(len(refs), np.float32)
    for i, patch in enumerate(refs.patches):
        scores[i] = cv2.matchTemplate(patch, tmpl, cv2.TM_CCOEFF_NORMED).max()
    order = np.argsort(-scores)[:3]
    return [(refs.names[i], float(scores[i])) for i in order]


def _wide(card_gray, image, factors=WIDE_FACTORS):
    """Best score of the card's central window anywhere in `image`, at a few sizes."""
    tmpl = _center(card_gray)
    best = -1.0
    for f in factors:
        img = image if f == 1.0 else cv2.resize(image, None, fx=f, fy=f, interpolation=cv2.INTER_LINEAR)
        if img.shape[0] < CENTER or img.shape[1] < CENTER:
            continue
        best = max(best, float(cv2.matchTemplate(img, tmpl, cv2.TM_CCOEFF_NORMED).max()))
    return best


def match_wide(card_bgr, refs, candidates):
    """Like match_fast, but tolerant of a card that's been lifted, enlarged or dimmed.
    Only searches `candidates` (a team's own deck), which keeps it fast and unambiguous."""
    gray = cv2.cvtColor(card_bgr, cv2.COLOR_BGR2GRAY)
    scored = [(n, max(_wide(gray, img) for img in refs.full[n])) for n in candidates if n in refs.full]
    return sorted(scored, key=lambda x: -x[1])


def match_global(card_bgr, refs, keep=12):
    """Search every reference card, coarsely first, then the best few properly. Slower, so
    only used on cards the fast match couldn't place (hero cards are drawn zoomed in)."""
    gray = cv2.cvtColor(card_bgr, cv2.COLOR_BGR2GRAY)
    coarse = sorted(
        ((n, max(_wide(gray, img, COARSE_FACTORS) for img in refs.full[n])) for n in refs.unique_names()),
        key=lambda x: -x[1],
    )[:keep]
    return match_wide(card_bgr, refs, [n for n, _ in coarse])


def same_card(a_bgr, b_bgr):
    """How alike two in-game crops are (0..1), whatever state each is in."""
    a = cv2.cvtColor(a_bgr, cv2.COLOR_BGR2GRAY)
    b = cv2.cvtColor(b_bgr, cv2.COLOR_BGR2GRAY)
    return max(_wide(a, b), _wide(b, a))
