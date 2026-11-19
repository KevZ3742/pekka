import { readdir } from "node:fs/promises";
import { CARDS_DIR, CUSTOM_CARDS_DIR } from "@/lib/library";
import { guard } from "@/lib/local";

/** Names of every card we have reference pictures for (downloaded art and your own). */
export async function GET(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  const names = new Set<string>();
  for (const [dir, stripVariant] of [[CARDS_DIR, false], [CUSTOM_CARDS_DIR, true]] as const) {
    try {
      for (const f of await readdir(dir)) {
        if (!f.toLowerCase().endsWith(".png")) continue;
        const base = f.slice(0, -4);
        const name = stripVariant ? base.split("~")[0] : base;
        if (!name.endsWith("-hero-ev1")) names.add(name); // not a real thing: one or the other
      
      }
    } catch {
      /* folder doesn't exist yet */
    }
  }
  return Response.json({ cards: [...names].sort() }, { headers: { "Cache-Control": "no-store" } });
}
