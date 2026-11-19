#!/usr/bin/env python3
"""
Download reference card art (RoyaleAPI/cr-api-assets, cards-150) into
~/pekka-library/cards so the analysis can name the cards it sees.

    python analysis/fetch_cards.py          # only fetches what's missing
    python analysis/fetch_cards.py --force  # re-download everything

The art belongs to Supercell and is only kept on your own machine for matching.
Cards that are too new to be in that set show up as "Unknown card N"; those can be
named once from the timeline and are remembered (see cards/custom).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request

from paths import cards_dir

REPO = "RoyaleAPI/cr-api-assets"
FOLDER = "cards-150"
UA = {"User-Agent": "pekka-fetch-cards"}


def http(url, timeout=30):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def list_via_api():
    data = json.loads(http(f"https://api.github.com/repos/{REPO}/contents/{FOLDER}"))
    return [(f["name"], f.get("download_url") or
             f"https://raw.githubusercontent.com/{REPO}/master/{FOLDER}/{f['name']}")
            for f in data if f["name"].lower().endswith(".png")]


def fetch_via_api(dest, force):
    files = list_via_api()
    todo = [(n, u) for n, u in files if force or not os.path.exists(os.path.join(dest, n))]
    print(f"{len(files)} cards available, {len(todo)} to download")
    for i, (name, url) in enumerate(todo, 1):
        with open(os.path.join(dest, name), "wb") as f:
            f.write(http(url))
        if i % 25 == 0 or i == len(todo):
            print(f"  {i}/{len(todo)}")
    return len(files)


def fetch_via_git(dest, force):
    """GitHub's API is rate limited on shared networks; a sparse clone isn't."""
    if not shutil.which("git"):
        raise RuntimeError("git isn't installed")
    with tempfile.TemporaryDirectory() as tmp:
        repo = os.path.join(tmp, "assets")
        run = lambda *a, **k: subprocess.run(a, check=True, capture_output=True, **k)
        run("git", "clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse",
            f"https://github.com/{REPO}.git", repo)
        run("git", "-C", repo, "sparse-checkout", "set", FOLDER)
        src = os.path.join(repo, FOLDER)
        names = [n for n in os.listdir(src) if n.lower().endswith(".png")]
        copied = 0
        for n in names:
            target = os.path.join(dest, n)
            if force or not os.path.exists(target):
                shutil.copyfile(os.path.join(src, n), target)
                copied += 1
        print(f"{len(names)} cards available, {copied} copied")
        return len(names)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", default=cards_dir())
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.dest, exist_ok=True)

    try:
        total = fetch_via_api(args.dest, args.force)
    except Exception as e:  # rate limit, offline, ...
        print(f"GitHub API unavailable ({e}); trying git instead...")
        try:
            total = fetch_via_git(args.dest, args.force)
        except Exception as e2:
            sys.exit(f"Couldn't download card art: {e2}")
    print(f"Done. {total} reference cards in {args.dest}")


if __name__ == "__main__":
    main()
