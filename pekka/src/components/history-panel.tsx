"use client";

import { useEffect } from "react";
import { formatBytes, formatDate, formatTime } from "@/lib/format";
import type { LibraryEntry } from "@/lib/types";

type HistoryPanelProps = {
  open: boolean;
  entries: LibraryEntry[];
  currentId: string | null;
  onClose: () => void;
  onOpen: (entry: LibraryEntry) => void;
  onDelete: (entry: LibraryEntry) => void;
};

export function HistoryPanel({
  open,
  entries,
  currentId,
  onClose,
  onOpen,
  onDelete,
}: HistoryPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 top-12 z-20 bg-black/40" onClick={onClose}>
      <aside
        aria-label="History"
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-seam bg-plate shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-seam px-5 py-3">
          <h2 className="text-lg font-semibold">History</h2>
          <button
            onClick={onClose}
            aria-label="Close history"
            className="grid size-7 place-items-center rounded text-dim hover:bg-seam hover:text-bone"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="px-5 py-6 text-dim">
            Recordings you open are saved here, so you can come back to them
            without converting again.
          </p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto py-2">
            {entries.map((e) => (
              <li
                key={e.id}
                className={`flex items-stretch border-l-2 ${
                  e.id === currentId ? "border-elixir bg-iron/60" : "border-transparent"
                }`}
              >
                <button
                  onClick={() => onOpen(e)}
                  className="min-w-0 flex-1 px-4 py-3 text-left transition-colors hover:bg-seam/50"
                >
                  <span className="block truncate font-medium" title={e.name}>
                    {e.name}
                  </span>
                  <span className="mt-0.5 block truncate text-sm tabular-nums text-dim">
                    {[
                      formatDate(e.createdAt),
                      formatBytes(e.sizeBytes),
                      e.duration ? formatTime(e.duration, 0) : null,
                      e.markers.length
                        ? `${e.markers.length} mark${e.markers.length === 1 ? "" : "s"}`
                        : null,
                      e.converted ? `converted ${e.convertedFps ?? e.fps} fps` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
                <button
                  onClick={() => onDelete(e)}
                  aria-label={`Delete ${e.name}`}
                  title="Delete from disk"
                  className="grid w-10 shrink-0 place-items-center text-dim transition-colors hover:bg-seam hover:text-bone"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
