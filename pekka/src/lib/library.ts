import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LibraryEntry } from "./types";

/**
 * Where saved recordings live. Outside the project on purpose, so it never
 * ends up in git or trips the dev server's file watcher. Override with
 * PEKKA_LIBRARY_DIR.
 */
export const LIBRARY_DIR =
  process.env.PEKKA_LIBRARY_DIR || join(homedir(), "pekka-library");

export const CONVERTED_FILE = "video.mp4";

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isValidId = (id: string) => ID_RE.test(id);

export const entryDir = (id: string) => join(LIBRARY_DIR, id);
export const entryPath = (id: string, file: string) => join(entryDir(id), file);

export async function readEntry(id: string): Promise<LibraryEntry | null> {
  if (!isValidId(id)) return null;
  try {
    return JSON.parse(await readFile(entryPath(id, "meta.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function writeEntry(entry: LibraryEntry): Promise<void> {
  const tmp = entryPath(entry.id, `meta.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(entry, null, 2));
  await rename(tmp, entryPath(entry.id, "meta.json"));
}

export async function listEntries(): Promise<LibraryEntry[]> {
  let names: string[];
  try {
    names = await readdir(LIBRARY_DIR);
  } catch {
    return [];
  }
  const entries = await Promise.all(names.map((n) => readEntry(n)));
  return entries
    .filter((e): e is LibraryEntry => e !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Route modules can be bundled separately, so keep the lock table global.
const g = globalThis as { __pekkaLocks?: Map<string, Promise<unknown>> };
const locks = (g.__pekkaLocks ??= new Map());

/** Read-modify-write one entry's meta.json without two requests clobbering each other. */
export function updateEntry(
  id: string,
  fn: (entry: LibraryEntry) => LibraryEntry,
): Promise<LibraryEntry | null> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(async () => {
    const entry = await readEntry(id);
    if (!entry) return null;
    const updated = fn(entry);
    await writeEntry(updated);
    return updated;
  });
  locks.set(
    id,
    next.catch(() => {}),
  );
  return next;
}
