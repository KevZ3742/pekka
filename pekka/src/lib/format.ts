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
