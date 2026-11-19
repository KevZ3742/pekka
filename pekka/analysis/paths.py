"""Where PEKKA keeps its files. Mirrors src/lib/library.ts."""
import os


def library_dir():
    return os.environ.get("PEKKA_LIBRARY_DIR") or os.path.join(os.path.expanduser("~"), "pekka-library")


def cards_dir():
    return os.path.join(library_dir(), "cards")
