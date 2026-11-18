"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Marker, ReviewExport } from "@/lib/types";
import { Transport } from "./transport";
import { TimelinePanel } from "./timeline-panel";

export function Reviewer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const srcRef = useRef<string | null>(null);
  const convertRef = useRef<AbortController | null>(null);

  const [src, setSrc] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [fps, setFps] = useState(60);
  const [aspect, setAspect] = useState(16 / 9);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState(false);

  /* ---------- loading ---------- */

  /** Point the player at a new URL and free the previous one. */
  const swapSrc = useCallback((url: string | null) => {
    if (srcRef.current) URL.revokeObjectURL(srcRef.current);
    srcRef.current = url;
    setSrc(url);
  }, []);

  const loadFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("video/")) {
        setError("That isn't a video file. Drop an .mp4 or .mov recording.");
        return;
      }
      convertRef.current?.abort();
      fileRef.current = file;
      setError(null);
      setConverted(false);
      setConverting(false);
      swapSrc(URL.createObjectURL(file));
      setFileName(file.name);
      setTime(0);
      setDuration(0);
      setPlaying(false);
      setMarkers([]);
    },
    [swapSrc],
  );

  /** Re-encode through the local ffmpeg route (H.264, constant frame rate). */
  const convert = useCallback(async () => {
    const file = fileRef.current;
    if (!file) return;
    convertRef.current?.abort();
    const controller = new AbortController();
    convertRef.current = controller;

    setError(null);
    setConverting(true);
    setPlaying(false);
    try {
      const res = await fetch(`/api/convert?fps=${fps}`, {
        method: "POST",
        body: file,
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Conversion failed.");
      }
      const blob = await res.blob();
      if (controller.signal.aborted) return;
      setTime(0);
      setDuration(0);
      setConverted(true);
      swapSrc(URL.createObjectURL(blob));
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Conversion failed.");
    } finally {
      if (convertRef.current === controller) {
        setConverting(false);
        convertRef.current = null;
      }
    }
  }, [fps, swapSrc]);

  /* ---------- actions ---------- */

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const max = Number.isFinite(v.duration) ? v.duration : Infinity;
    const clamped = Math.min(Math.max(t, 0), max);
    v.currentTime = clamped;
    setTime(clamped);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => setPlaying(false));
    else v.pause();
  }, []);

  /** Step by whole frames, landing mid-frame so the browser shows frame n, not n-1. */
  const stepFrames = useCallback(
    (n: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      const frame = Math.floor(v.currentTime * fps + 1e-3);
      seek((frame + n + 0.5) / fps);
    },
    [fps, seek],
  );

  const changeRate = useCallback((r: number) => {
    setRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  }, []);

  const addMarker = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const marker: Marker = {
      id: crypto.randomUUID(),
      time: v.currentTime,
      label: "",
    };
    setMarkers((prev) => [...prev, marker].sort((a, b) => a.time - b.time));
  }, []);

  const exportMarkers = useCallback(() => {
    const data: ReviewExport = { version: 1, video: fileName, fps, markers };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/\.[^.]+$/, "") || "review"}.pekka.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [fileName, fps, markers]);

  useEffect(() => {
    return () => {
      convertRef.current?.abort();
      if (srcRef.current) URL.revokeObjectURL(srcRef.current);
    };
  }, []);

  /* ---------- smooth clock while playing ---------- */

  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const tick = () => {
      if (videoRef.current) setTime(videoRef.current.currentTime);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (tag === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const v = videoRef.current;
      if (!v) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) seek(v.currentTime - 1);
          else stepFrames(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) seek(v.currentTime + 1);
          else stepFrames(1);
          break;
        case "m":
        case "M":
          e.preventDefault();
          addMarker();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, stepFrames, seek, addMarker]);

  /* ---------- render ---------- */

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr] bg-iron text-bone">
      <header className="flex h-12 items-center justify-between gap-4 border-b border-seam bg-plate px-5">
        <div className="flex items-baseline gap-3">
          <span className="text-xl font-bold tracking-wide">PEKKA</span>
          <span className="hidden text-sm text-dim md:inline">
            Perfectly Evaluated King-tower Kill Algorithm
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          {fileName && (
            <span className="truncate text-sm text-dim" title={fileName}>
              {fileName}
            </span>
          )}
          {src && (
            <button
              onClick={() => void convert()}
              disabled={converting}
              title="Re-encode to H.264 at a constant frame rate"
              className="shrink-0 rounded border border-seam px-3 py-1.5 text-sm transition-colors hover:bg-seam disabled:opacity-40"
            >
              {converted ? `Re-convert at ${fps} fps` : "Convert to mp4"}
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 rounded border border-seam px-3 py-1.5 text-sm transition-colors hover:bg-seam"
          >
            {src ? "Open another" : "Open video"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              loadFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      <main className="grid min-h-0 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] lg:flex">
        <section
          className="stage-col flex min-h-0 min-w-0 flex-col"
          style={{ "--ar": aspect } as React.CSSProperties}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            loadFile(e.dataTransfer.files[0]);
          }}
        >
          <div
            className={`relative min-h-0 flex-1 bg-black transition-shadow ${
              dragOver ? "shadow-[inset_0_0_0_2px_var(--color-elixir)]" : ""
            }`}
          >
            {src ? (
              <video
                ref={videoRef}
                src={src}
                playsInline
                preload="metadata"
                className="absolute inset-0 size-full object-contain"
                onClick={togglePlay}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  // Some browsers decode only the audio of HEVC and report no
                  // error, so a zero-width video means "can't play this".
                  if (v.videoWidth === 0) {
                    if (!converted && !converting) void convert();
                    else if (!converting)
                      setError("This browser still can't play that file.");
                    return;
                  }
                  setDuration(v.duration);
                  if (v.videoWidth && v.videoHeight)
                    setAspect(v.videoWidth / v.videoHeight);
                }}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onSeeked={(e) => setTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() => {
                  if (!converted && !converting) void convert();
                  else if (!converting)
                    setError("This browser still can't play that file.");
                }}
              />
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 grid place-items-center text-center"
              >
                <span className="max-w-sm px-6">
                  <span className="block text-2xl font-semibold">
                    Drop a replay recording here
                  </span>
                  <span className="mt-2 block text-dim">
                    Or click to choose a file. Screen recordings from your
                    phone work best.
                  </span>
                </span>
              </button>
            )}
            {converting && (
              <div
                role="status"
                className="absolute inset-0 grid place-items-center bg-iron/90 text-center"
              >
                <p className="max-w-xs px-6">
                  <span className="block text-xl font-semibold">
                    Converting for playback
                  </span>
                  <span className="mt-2 block text-dim">
                    Re-encoding to H.264 at {fps} fps. Long recordings can take
                    a minute.
                  </span>
                </p>
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="absolute inset-x-0 bottom-0 bg-iron/95 px-5 py-3 text-sm text-bone"
              >
                {error}
              </p>
            )}
          </div>

          <Transport
            time={time}
            duration={duration}
            playing={playing}
            rate={rate}
            fps={fps}
            markers={markers}
            onSeek={seek}
            onToggle={togglePlay}
            onStep={stepFrames}
            onRate={changeRate}
            onFps={setFps}
          />
        </section>

        <TimelinePanel
          markers={markers}
          time={time}
          hasVideo={!!src}
          onSeek={seek}
          onAdd={addMarker}
          onLabel={(id, label) =>
            setMarkers((prev) =>
              prev.map((m) => (m.id === id ? { ...m, label } : m)),
            )
          }
          onDelete={(id) => setMarkers((prev) => prev.filter((m) => m.id !== id))}
          onExport={exportMarkers}
        />
      </main>
    </div>
  );
}
