import { readFile } from "node:fs/promises";
import { ANALYSIS_FILE, entryPath, isValidId } from "@/lib/library";
import { guard, json } from "@/lib/local";

type Ctx = { params: Promise<{ id: string }> };

/** The saved analysis for a recording (404 until it has been analyzed). */
export async function GET(request: Request, { params }: Ctx) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await params;
  if (!isValidId(id)) return json("Not found.", 404);
  try {
    const body = await readFile(entryPath(id, ANALYSIS_FILE));
    return new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return json("This recording hasn't been analyzed yet.", 404);
  }
}
