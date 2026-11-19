const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** 83.4567 -> "1:23.456". Pass precision 0 for "1:23", 1 for "1:23.4". */
export function formatTime(seconds: number, precision = 3): string {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(s / 60);
  const whole = Math.floor(s % 60);
  if (precision === 0) return `${m}:${pad(whole)}`;
  const scale = 10 ** precision;
  const frac = Math.floor((s % 1) * scale);
  return `${m}:${pad(whole)}.${pad(frac, precision)}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "the-log" -> "The Log", "archers-ev1" -> "Archers (Evo)", "unknown-3" -> "Unknown card 3". */
export function cardLabel(slug: string): string {
  const unknown = /^unknown-(\d+)$/.exec(slug);
  if (unknown) return `Unknown card ${unknown[1]}`;
  let evo = false;
  let hero = false;
  const words = slug.split("-").filter((w) => {
    if (w === "ev1") return !(evo = true);
    if (w === "hero") return !(hero = true);
    return true;
  });
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const tags = [hero && "Hero", evo && "Evo"].filter(Boolean).join(" ");
  return tags ? `${name} (${tags})` : name;
}

export type CardVariant = "normal" | "evo" | "hero";

const EVO_WORDS = new Set(["evo", "evolution", "evolved", "ev1"]);

/**
 * Splits a name or slug into the base card and which variant words it carries:
 * "Evo Valkyrie" -> { base: "valkyrie", evo: true, hero: false }.
 * Mini P.E.K.K.A -> "mini-pekka". Evo and hero can be in any position.
 */
export function parseCardName(text: string): { base: string; evo: boolean; hero: boolean } {
  const words = text
    .toLowerCase()
    .replace(/[.'\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  let evo = false;
  let hero = false;
  const base = words.filter((w) => {
    if (EVO_WORDS.has(w)) return !(evo = true);
    if (w === "hero") return !(hero = true);
    return true;
  });
  return { base: base.join("-"), evo, hero };
}

/** "valkyrie" + "hero" -> "valkyrie-hero"; "princess" + "evo" -> "princess-ev1". */
export function cardSlug(base: string, variant: CardVariant): string {
  return variant === "hero" ? `${base}-hero` : variant === "evo" ? `${base}-ev1` : base;
}

/** The reverse of cardLabel: "Evo Valkyrie" -> "valkyrie-ev1", "Hero Knight" -> "knight-hero". */
export function slugFromLabel(text: string): string {
  const { base, evo, hero } = parseCardName(text);
  return cardSlug(base, hero ? "hero" : evo ? "evo" : "normal");
}

/** Removes "evo"/"hero" words from what someone typed, keeping the rest as written. */
export function stripVariantWords(text: string): string {
  return text
    .replace(/\b(evo|evolution|evolved|ev1|hero)\b/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
