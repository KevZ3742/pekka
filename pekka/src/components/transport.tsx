"use client";

import { useRef } from "react";
import { formatTime } from "@/lib/format";
import type { Marker } from "@/lib/types";

const RATES = [0.25, 0.5, 1, 2];
const FPS_OPTIONS = [24, 30, 60];

type TransportProps = {
  time: number;
  duration: number;
  playing: boolean;
  rate: number;
  fps: number;
  markers: Marker[];
  onSeek: (t: number) => void;
  onToggle: () => void;
  onStep: (frames: number) => void;
  onRate: (r: number) => void;
  onFps: (f: number) => void;
};

function Scrubber({
  time,
  duration,
  markers,
  onSeek,
}: Pick<TransportProps, "time" | "duration" | "markers" | "onSeek">) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const seekFromPointer = (clientX: number) => {
    const el = trackRef.current;
    if (!el || !duration) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    onSeek(ratio * duration);
  };

  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={formatTime(time)}
      className="relative h-9 cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekFromPointer(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) seekFromPointer(e.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-seam" />
      <div
        className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-elixir"
        style={{ width: `${pct}%` }}
      />
      {duration > 0 &&
        markers.map((m) => (
          <div
            key={m.id}
            className="pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bone/80"
            style={{ left: `${(m.time / duration) * 100}%` }}
          />
        ))}
      <div
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-iron bg-bone"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

function StepIcon({ flip }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-5 ${flip ? "-scale-x-100" : ""}`}
      fill="currentColor"
      aria-hidden
    >
      <path d="M7 5h2v14H7zM11 5l9 7-9 7z" />
    </svg>
  );
}

export function Transport(props: TransportProps) {
  const { time, duration, playing, rate, fps, markers } = props;
  const frame = Math.floor(time * fps + 1e-3);

  const iconButton =
    "grid size-10 place-items-center rounded text-bone transition-colors hover:bg-seam disabled:opacity-40";

  return (
    <div className="flex h-36 flex-col justify-between border-t border-seam bg-plate px-4 pb-3 pt-1">
      <Scrubber
        time={time}
        duration={duration}
        markers={markers}
        onSeek={props.onSeek}
      />

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold tabular-nums leading-none text-bone">
            {formatTime(time)}
          </div>
          <div className="mt-1 text-sm tabular-nums text-dim">
            of {formatTime(duration, 1)} · frame {frame}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            className={iconButton}
            aria-label="Back one frame"
            title="Back one frame (←)"
            onClick={() => props.onStep(-1)}
          >
            <StepIcon flip />
          </button>
          <button
            className="grid size-12 place-items-center rounded-full bg-elixir text-iron transition-transform active:scale-95"
            aria-label={playing ? "Pause" : "Play"}
            title="Play / pause (Space)"
            onClick={props.onToggle}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden>
                <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden>
                <path d="M8 5l11 7-11 7z" />
              </svg>
            )}
          </button>
          <button
            className={iconButton}
            aria-label="Forward one frame"
            title="Forward one frame (→)"
            onClick={() => props.onStep(1)}
          >
            <StepIcon />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex rounded border border-seam" role="group" aria-label="Playback speed">
          {RATES.map((r) => (
            <button
              key={r}
              aria-pressed={rate === r}
              onClick={() => props.onRate(r)}
              className={`px-2.5 py-0.5 text-sm tabular-nums transition-colors ${
                rate === r ? "bg-seam text-bone" : "text-dim hover:text-bone"
              }`}
            >
              {r}×
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-dim">
          fps
          <select
            value={fps}
            onChange={(e) => props.onFps(Number(e.target.value))}
            className="rounded border border-seam bg-iron px-1.5 py-0.5 text-bone"
          >
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
