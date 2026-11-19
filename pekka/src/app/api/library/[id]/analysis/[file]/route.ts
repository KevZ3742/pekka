import { readFile } from "node:fs/promises";
import { entryPath, isValidId } from "@/lib/library";
import { guard, json } from "@/lib/local";

type Ctx = { params: Promise<{ id: string; file: string }> };

/** Crops of cards the analysis couldn't name: unknown-1.png, unknown-2.png, ... */
export async function GET(request: Request, { params }: Ctx) {
  const denied = guard(request);
  if (denied) return denied;
  const { id, file } = await params;
  if (!isValidId(id) || !/^unknown-\d+\.png$/.test(file)) return json("Not found.", 404);
  try {
    const body = await readFile(entryPath(id, `analysis/${file}`));
    return new Response(body, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch {
    return json("Not found.", 404);
  }
}
