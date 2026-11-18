import { rm } from "node:fs/promises";
import { entryDir, isValidId, readEntry, updateEntry } from "@/lib/library";
import { guard, json } from "@/lib/local";
import type { LibraryEntry, Marker } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

const ALLOWED_FPS = new Set([24, 30, 60]);
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/** Only whitelisted fields get through; everything else is ignored. */
function parsePatch(body: unknown): Partial<LibraryEntry> | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const patch: Partial<LibraryEntry> = {};

  if (typeof b.fps === "number" && ALLOWED_FPS.has(b.fps)) patch.fps = b.fps;
  if (positive(b.duration)) patch.duration = b.duration;
  if (positive(b.width)) patch.width = b.width;
  if (positive(b.height)) patch.height = b.height;

  if (Array.isArray(b.markers)) {
    const markers: Marker[] = [];
    for (const m of b.markers.slice(0, 2000)) {
      if (
        typeof m === "object" && m !== null &&
        typeof (m as Marker).id === "string" &&
        typeof (m as Marker).time === "number" &&
        Number.isFinite((m as Marker).time) &&
        typeof (m as Marker).label === "string"
      ) {
        const { id, time, label } = m as Marker;
        markers.push({ id: id.slice(0, 100), time, label: label.slice(0, 1000) });
      }
    }
    patch.markers = markers;
  }
  return patch;
}

/** Update a recording's markers, frame rate, or measured video size. */
export async function PATCH(request: Request, { params }: Ctx) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await params;
  if (!isValidId(id)) return json("Not found.", 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json("Invalid JSON.", 400);
  }
  const patch = parsePatch(body);
  if (!patch) return json("Invalid update.", 400);

  const entry = await updateEntry(id, (e) => ({ ...e, ...patch, id: e.id }));
  if (!entry) return json("Not found.", 404);
  return Response.json(entry);
}

/** Remove a recording and everything saved with it. */
export async function DELETE(request: Request, { params }: Ctx) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await params;
  if (!isValidId(id) || !(await readEntry(id))) return json("Not found.", 404);
  await rm(entryDir(id), { recursive: true, force: true });
  return Response.json({ ok: true });
}
