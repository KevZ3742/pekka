import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ANALYSIS_FILE, CUSTOM_CARDS_DIR, entryPath, isValidId } from "@/lib/library";
import { guard, json } from "@/lib/local";
import { parseCardName, slugFromLabel } from "@/lib/format";
import type { Analysis } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

const exists = (p: string) => stat(p).then(() => true, () => false);

/**
 * Name a card the analysis couldn't recognise. Saves its picture so every future analysis
 * knows it, and relabels this recording's analysis straight away.
 * Body: { unknown: "unknown-2", name: "Evo Valkyrie" }
 */
export async function POST(request: Request, { params }: Ctx) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await params;
  if (!isValidId(id)) return json("Not found.", 404);

  let body: { unknown?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return json("Invalid JSON.", 400);
  }
  const unknown = typeof body.unknown === "string" ? body.unknown : "";
  const name = typeof body.name === "string" ? body.name : "";
  const slug = slugFromLabel(name);
  const parsed = parseCardName(name);
  if (parsed.evo && parsed.hero) return json("A card is either Evo or Hero, not both.", 400);
  if (!/^unknown-\d+$/.test(unknown)) return json("That isn't an unrecognised card.", 400);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) {
    return json("Give the card a name, like “Evo Valkyrie” or “Hero Knight”.", 400);
  }

  const analysisPath = entryPath(id, ANALYSIS_FILE);
  let analysis: Analysis;
  try {
    analysis = JSON.parse(await readFile(analysisPath, "utf8"));
  } catch {
    return json("This recording hasn't been analyzed yet.", 404);
  }
  if (!analysis.unknownCards.includes(unknown)) return json("That card has already been named.", 409);

  // Keep the picture. A card can have several (different glow states), so don't overwrite.
  const crop = entryPath(id, `analysis/${unknown}.png`);
  if (!(await exists(crop))) return json("The picture of that card is missing.", 404);
  await mkdir(CUSTOM_CARDS_DIR, { recursive: true });
  let target = join(CUSTOM_CARDS_DIR, `${slug}.png`);
  for (let n = 2; await exists(target); n++) target = join(CUSTOM_CARDS_DIR, `${slug}~${n}.png`);
  await copyFile(crop, target);

  // Rewrite this analysis.
  const relabel = (c: string | null) => (c === unknown ? slug : c);
  for (const e of analysis.events) {
    e.card = relabel(e.card) as string;
    e.replacedBy = relabel(e.replacedBy);
  }
  for (const h of analysis.hands) h.card = relabel(h.card) as string;
  analysis.unknownCards = analysis.unknownCards.filter((u) => u !== unknown);
  const tmp = `${analysisPath}.tmp`;
  await writeFile(tmp, JSON.stringify(analysis));
  await rename(tmp, analysisPath);
  await rm(crop, { force: true });

  return Response.json({ analysis, slug });
}
