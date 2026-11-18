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
