import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { entryDir, entryPath, listEntries, writeEntry } from "@/lib/library";
import { guard, json } from "@/lib/local";
import type { LibraryEntry } from "@/lib/types";

const ALLOWED_FPS = new Set([24, 30, 60]);

/** All saved recordings, newest first. */
export async function GET(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  return Response.json(await listEntries(), {
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Save an uploaded recording. The body is the raw file; details ride in the
 * query string: ?name=&type=&key=&fps=
 */
export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  if (!request.body) return json("No file was sent.", 400);

  const q = new URL(request.url).searchParams;
  const name = (q.get("name") || "recording").slice(0, 200);
  const type = q.get("type") || "video/mp4";
  if (!type.startsWith("video/")) return json("That isn't a video file.", 400);
  const fpsParam = Number(q.get("fps") ?? 60);
  const fps = ALLOWED_FPS.has(fpsParam) ? fpsParam : 60;

  const ext = /\.[a-z0-9]{1,5}$/i.exec(name)?.[0].toLowerCase() ?? ".mp4";
  const id = randomUUID();
  const originalFile = `original${ext}`;

  await mkdir(entryDir(id), { recursive: true });
  try {
    // Stream to disk so big recordings never sit in memory.
    await pipeline(
      Readable.fromWeb(request.body as unknown as NodeWebStream),
      createWriteStream(entryPath(id, originalFile)),
    );
    const { size } = await stat(entryPath(id, originalFile));
    const entry: LibraryEntry = {
      id,
      key: (q.get("key") || name).slice(0, 400),
      name,
      createdAt: new Date().toISOString(),
      sizeBytes: size,
      originalFile,
      originalType: type,
      converted: false,
      fps,
      markers: [],
    };
    // meta.json is written last, so half-uploaded folders never show up in history.
    await writeEntry(entry);
    return Response.json(entry);
  } catch (err) {
    await rm(entryDir(id), { recursive: true, force: true }).catch(() => {});
    return json(err instanceof Error ? err.message : "Couldn't save the recording.", 500);
  }
}
