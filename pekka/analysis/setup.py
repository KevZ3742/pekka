#!/usr/bin/env python3
"""
One-time setup for card recognition:

    python3 analysis/setup.py          (Windows: py analysis\\setup.py)

Creates analysis/.venv, installs numpy + opencv into it, and downloads the
reference card art. The app finds the venv by itself afterwards.
"""
import os
import shutil
import subprocess
import sys
import venv

HERE = os.path.dirname(os.path.abspath(__file__))
VENV = os.path.join(HERE, ".venv")


def main():
    if sys.version_info < (3, 9):
        sys.exit("Python 3.9 or newer is required.")
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            print(f"warning: {tool} isn't on your PATH (the app needs it for conversion and analysis)")

    if not os.path.isdir(VENV):
        print("Creating analysis/.venv ...")
        venv.EnvBuilder(with_pip=True).create(VENV)
    exe = os.path.join(VENV, "Scripts", "python.exe") if os.name == "nt" else os.path.join(VENV, "bin", "python")

    print("Installing numpy and opencv ...")
    subprocess.check_call([exe, "-m", "pip", "install", "-q", "-r", os.path.join(HERE, "requirements.txt")])
    print("Downloading reference card art ...")
    subprocess.check_call([exe, os.path.join(HERE, "fetch_cards.py")], cwd=HERE)
    print("\nAll set. Open a recording in PEKKA and press Analyze.")


if __name__ == "__main__":
    main()
