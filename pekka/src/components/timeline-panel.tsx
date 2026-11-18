"use client";

import { formatTime } from "@/lib/format";
import type { Marker } from "@/lib/types";

type TimelinePanelProps = {
  markers: Marker[];
  time: number;
  hasVideo: boolean;
  onSeek: (t: number) => void;
  onAdd: () => void;
  onLabel: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
};

/**
 * Placeholder timeline: a list of moments you flag by hand.
 * This is the slot where plays, elixir, leaks and eval swings will go.
 */
export function TimelinePanel(props: TimelinePanelProps) {
  const { markers, time, hasVideo } = props;
  const activeId = [...markers].reverse().find((m) => m.time <= time)?.id;

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-t border-seam bg-plate lg:flex-1 lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between gap-3 border-b border-seam px-5 py-3">
        <h2 className="text-lg font-semibold text-bone">Timeline</h2>
        <div className="flex gap-2">
          <button
            disabled={!hasVideo}
            onClick={props.onAdd}
            title="Mark this moment (M)"
            className="rounded bg-elixir px-3 py-1.5 text-sm font-semibold text-iron transition-opacity disabled:opacity-40"
          >
            Mark moment
          </button>
          <button
            disabled={markers.length === 0}
            onClick={props.onExport}
            className="rounded border border-seam px-3 py-1.5 text-sm text-bone transition-colors hover:bg-seam disabled:opacity-40"
          >
            Export
          </button>
        </div>
      </div>

      {markers.length === 0 ? (
        <p className="px-5 py-6 text-dim">
          {hasVideo
            ? "Nothing marked yet. Pause on a play and press M to flag it."
            : "Open a recording to start marking moments."}
        </p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto py-2">
          {markers.map((m) => (
            <li
              key={m.id}
              className={`flex items-center gap-3 border-l-2 px-4 py-2 ${
                m.id === activeId ? "border-elixir bg-iron/60" : "border-transparent"
              }`}
            >
              <button
                onClick={() => props.onSeek(m.time)}
                title="Jump to this moment"
                className="w-16 shrink-0 rounded px-1 py-0.5 text-left text-sm tabular-nums text-elixir hover:bg-seam"
              >
                {formatTime(m.time, 1)}
              </button>
              <input
                value={m.label}
                placeholder="What happened?"
                aria-label={`Note for ${formatTime(m.time, 1)}`}
                onChange={(e) => props.onLabel(m.id, e.target.value)}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-bone placeholder:text-dim hover:border-seam focus:border-seam"
              />
              <button
                onClick={() => props.onDelete(m.id)}
                aria-label={`Delete marker at ${formatTime(m.time, 1)}`}
                className="grid size-7 shrink-0 place-items-center rounded text-dim hover:bg-seam hover:text-bone"
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
