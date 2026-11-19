import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CARDS_DIR, CUSTOM_CARDS_DIR } from "@/lib/library";
import { guard, json } from "@/lib/local";

type Ctx = { params: Promise<{ name: string }> };

/** A picture of a card for the timeline: the downloaded art, else one you saved. */
export async function GET(request: Request, { params }: Ctx) {
  const denied = guard(request);
  if (denied) return denied;
  const { name } = await params;
  if (!/^[a-z0-9-]+$/.test(name)) return json("Not found.", 404);
  for (const file of [join(CARDS_DIR, `${name}.png`), join(CUSTOM_CARDS_DIR, `${name}.png`), join(CUSTOM_CARDS_DIR, `${name}~2.png`)]) {
    try {
      const body = await readFile(file);
      return new Response(body, {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    } catch {
      /* try the next one */
    }
  }
  return json("Not found.", 404);
}
