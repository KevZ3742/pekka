import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { CONVERTED_FILE, entryPath, isValidId, readEntry } from "@/lib/library";
import { guard, json } from "@/lib/local";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Serves a saved recording with HTTP Range support, which <video> needs for
 * seeking. ?v=original|converted (defaults to converted when it exists).
 */
export async function GET(request: Request, { params }: Ctx) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await params;
  if (!isValidId(id)) return json("Not found.", 404);
  const entry = await readEntry(id);
  if (!entry) return json("Not found.", 404);

  const variant = new URL(request.url).searchParams.get("v");
  const useConverted = variant === "converted" || (variant !== "original" && entry.converted);
  const file = useConverted ? CONVERTED_FILE : entry.originalFile;
  const type = useConverted ? "video/mp4" : entry.originalType;
  const path = entryPath(id, file);

  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return json("That video file is missing.", 404);
  }
  if (size === 0) return json("That video file is empty.", 404);

  let start = 0;
  let end = size - 1;
  let status = 200;
  const header = request.headers.get("range");
  if (header) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(header);
    const unsatisfiable = () =>
      new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    if (!m || (m[1] === "" && m[2] === "")) return unsatisfiable();
    if (m[1] === "") {
      start = Math.max(size - Number(m[2]), 0); // suffix range: last N bytes
    } else {
      start = Number(m[1]);
      if (m[2] !== "") end = Math.min(Number(m[2]), size - 1);
    }
    if (start > end || start >= size) return unsatisfiable();
    status = 206;
  }

  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
    "Cache-Control": "no-store",
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;

  const stream = createReadStream(path, { start, end });
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status,
    headers,
  });
}
