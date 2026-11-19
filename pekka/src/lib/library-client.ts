import type { Analysis, LibraryEntry, Marker } from "./types";

/** URL the <video> element should load for a saved recording. */
export function videoUrl(
  entry: LibraryEntry,
  variant: "converted" | "original" = entry.converted ? "converted" : "original",
): string {
  const bust = encodeURIComponent(entry.convertedAt ?? entry.createdAt);
  return `/api/library/${entry.id}/video?v=${variant}&t=${bust}`;
}

/** Identifies "the same file opened again" without hashing gigabytes. */
export const fileKey = (file: File) =>
  `${file.name}|${file.size}|${file.lastModified}`;

async function errorFrom(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error ?? fallback;
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const res = await fetch("/api/library", { cache: "no-store" });
  if (!res.ok) throw new Error(await errorFrom(res, "Couldn't load history."));
  return res.json();
}

/** Upload with progress (fetch can't report upload progress, XHR can). */
export function uploadOriginal(
  file: File,
  fps: number,
  onProgress: (ratio: number) => void,
  signal: AbortSignal,
): Promise<LibraryEntry> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const qs = new URLSearchParams({
      name: file.name,
      type: file.type,
      key: fileKey(file),
      fps: String(fps),
    });
    xhr.open("POST", `/api/library?${qs}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: { error?: string } | LibraryEntry | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* fall through */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) {
        resolve(body as LibraryEntry);
      } else {
        reject(new Error((body as { error?: string } | null)?.error ?? "Couldn't save the recording."));
      }
    };
    xhr.onerror = () => reject(new Error("Couldn't reach the local server."));
    signal.addEventListener(
      "abort",
      () => {
        xhr.abort();
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
    xhr.send(file);
  });
}

/** Read a newline-delimited JSON response, calling `onEvent` for each line. */
async function readEvents(res: Response, onEvent: (event: Record<string, unknown>) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
  }
  if (buf.trim()) onEvent(JSON.parse(buf));
}

/** Re-encode a saved recording; ratio is 0..1, or null while the length is unknown. */
export async function convertEntry(
  id: string,
  fps: number,
  onProgress: (ratio: number | null) => void,
  signal: AbortSignal,
): Promise<LibraryEntry> {
  const res = await fetch(`/api/convert?id=${encodeURIComponent(id)}&fps=${fps}`, {
    method: "POST",
    signal,
  });
  if (!res.ok || !res.body) throw new Error(await errorFrom(res, "Conversion failed."));

  const result: { entry: LibraryEntry | null } = { entry: null };
  await readEvents(res, (ev) => {
    if (ev.type === "progress") onProgress(ev.pct as number | null);
    else if (ev.type === "done") result.entry = ev.entry as LibraryEntry;
    else if (ev.type === "error") throw new Error(ev.error as string);
  });
  if (!result.entry) throw new Error("Conversion ended unexpectedly.");
  return result.entry;
}

/** Run card recognition on a saved recording. */
export async function analyzeEntry(
  id: string,
  handlers: { onProgress: (ratio: number) => void; onWarning: (message: string) => void },
  signal: AbortSignal,
): Promise<{ entry: LibraryEntry; analysis: Analysis }> {
  const res = await fetch(`/api/analyze?id=${encodeURIComponent(id)}`, { method: "POST", signal });
  if (!res.ok || !res.body) throw new Error(await errorFrom(res, "Analysis failed."));

  const result: { entry: LibraryEntry | null; analysis: Analysis | null } = {
    entry: null,
    analysis: null,
  };
  await readEvents(res, (ev) => {
    if (ev.type === "progress") handlers.onProgress(ev.pct as number);
    else if (ev.type === "warning") handlers.onWarning(ev.message as string);
    else if (ev.type === "done") {
      result.entry = ev.entry as LibraryEntry;
      result.analysis = ev.analysis as Analysis;
    } else if (ev.type === "error") throw new Error(ev.error as string);
  });
  if (!result.entry || !result.analysis) throw new Error("Analysis ended unexpectedly.");
  return { entry: result.entry, analysis: result.analysis };
}

/** A recording's saved analysis, or null if it hasn't been analyzed. */
export async function getAnalysis(id: string): Promise<Analysis | null> {
  const res = await fetch(`/api/library/${id}/analysis`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await errorFrom(res, "Couldn't load the analysis."));
  return res.json();
}

export type EntryPatch = Partial<{
  fps: number;
  duration: number;
  width: number;
  height: number;
  markers: Marker[];
}>;

export async function patchEntry(id: string, patch: EntryPatch): Promise<LibraryEntry> {
  const res = await fetch(`/api/library/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorFrom(res, "Couldn't save changes."));
  return res.json();
}

export async function deleteEntry(id: string): Promise<void> {
  const res = await fetch(`/api/library/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorFrom(res, "Couldn't delete that recording."));
}

/** Names of every card we have a picture of. */
export async function listCards(): Promise<string[]> {
  const res = await fetch("/api/cards", { cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()).cards ?? [];
}

/** Name an unrecognised card; it is remembered for future analyses too. */
export async function nameCard(id: string, unknown: string, name: string): Promise<Analysis> {
  const res = await fetch(`/api/library/${id}/analysis/name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unknown, name }),
  });
  if (!res.ok) throw new Error(await errorFrom(res, "Couldn't save that name."));
  return (await res.json()).analysis;
}
