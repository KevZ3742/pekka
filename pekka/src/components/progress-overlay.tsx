"use client";

type ProgressOverlayProps = {
  title: string;
  detail: string;
  /** 0..1, or null when the total isn't known yet. */
  ratio: number | null;
  onCancel: () => void;
};

export function ProgressOverlay({ title, detail, ratio, onCancel }: ProgressOverlayProps) {
  const pct = ratio === null ? null : Math.round(Math.min(Math.max(ratio, 0), 1) * 100);

  return (
    <div
      role="status"
      className="absolute inset-0 grid place-items-center bg-iron/90 text-center"
    >
      <div className="w-full max-w-xs px-6">
        <p className="text-xl font-semibold">{title}</p>
        <p className="mt-2 text-dim">{detail}</p>

        <div
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
          className="mt-5 h-2 overflow-hidden rounded-full bg-seam"
        >
          <div
            className={`h-full rounded-full bg-elixir transition-[width] duration-300 ${
              pct === null ? "w-1/3 animate-pulse" : ""
            }`}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-sm tabular-nums text-dim">
          {pct === null ? "Working…" : `${pct}%`}
        </p>

        <button
          onClick={onCancel}
          className="mt-4 rounded border border-seam px-3 py-1.5 text-sm transition-colors hover:bg-seam"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
