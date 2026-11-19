"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Analysis, LibraryEntry, Marker, ReviewExport } from "@/lib/types";
import {
  analyzeEntry,
  convertEntry,
  deleteEntry,
  fileKey,
  getAnalysis,
  listLibrary,
  nameCard,
  patchEntry,
  uploadOriginal,
  videoUrl,
} from "@/lib/library-client";
import { Transport } from "./transport";
import { TimelinePanel, type AnalysisStatus } from "./timeline-panel";
import { HistoryPanel } from "./history-panel";
import { ProgressOverlay } from "./progress-overlay";

export function Reviewer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const srcRef = useRef<string | null>(null);
  const convertRef = useRef<AbortController | null>(null);
  const saveRef = useRef<{
    controller: AbortController;
    promise: Promise<string | null>;
  } | null>(null);
  const analyzeRef = useRef<AbortController | null>(null);
  /** Which analysis (recording + run) is currently on screen, so we don't refetch it. */
  const analysisRef = useRef<{ id: string; at: string } | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const historyRef = useRef<LibraryEntry[]>([]);
  /** Signature of what the server last stored, so we only PATCH real changes. */
  const persistedRef = useRef("");
  const pendingRef = useRef<{
    id: string;
    fps: number;
    markers: Marker[];
    sig: string;
  } | null>(null);

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
  const [convertProgress, setConvertProgress] = useState<number | null>(null);
  const [saveProgress, setSaveProgress] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [history, setHistory] = useState<LibraryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [analysisState, setAnalysisState] = useState<{ id: string; data: Analysis } | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState<number | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeWarning, setAnalyzeWarning] = useState<string | null>(null);

  /* ---------- history ---------- */

  const setCurrent = useCallback((id: string | null) => {
    currentIdRef.current = id;
    setCurrentId(id);
  }, []);

  const upsert = useCallback((entry: LibraryEntry) => {
    setHistory((prev) =>
      prev.some((e) => e.id === entry.id)
        ? prev.map((e) => (e.id === entry.id ? entry : e))
        : [entry, ...prev],
    );
  }, []);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    let alive = true;
    listLibrary()
      .then((entries) => {
        if (alive) setHistory(entries);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /** Write any not-yet-saved markers / frame rate to disk right now. */
  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    persistedRef.current = p.sig;
    patchEntry(p.id, { fps: p.fps, markers: p.markers })
      .then(upsert)
      .catch(() => {
        persistedRef.current = "";
      });
  }, [upsert]);

  // Markers and frame rate follow the recording around: save shortly after each change.
  useEffect(() => {
    if (!currentId) return;
    const sig = JSON.stringify([currentId, fps, markers]);
    if (sig === persistedRef.current) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = { id: currentId, fps, markers, sig };
    const t = setTimeout(flushPending, 400);
    return () => clearTimeout(t);
  }, [currentId, fps, markers, flushPending]);

  // Remember the video's real length and size once the browser has read them.
  useEffect(() => {
    if (!currentId || !duration || !dims) return;
    const entry = history.find((e) => e.id === currentId);
    if (!entry) return;
    if (
      entry.width === dims.w &&
      entry.height === dims.h &&
      Math.abs((entry.duration ?? 0) - duration) < 0.01
    )
      return;
    patchEntry(currentId, { duration, width: dims.w, height: dims.h })
      .then(upsert)
      .catch(() => {});
  }, [currentId, duration, dims, history, upsert]);

  /* ---------- loading ---------- */

  /** Point the player at a new URL and free the previous one. */
  const swapSrc = useCallback((url: string | null) => {
    if (srcRef.current) URL.revokeObjectURL(srcRef.current);
    srcRef.current = url;
    setSrc(url);
  }, []);

  /** Stop whatever is in flight and clear per-video state before loading another. */
  const resetPlayback = useCallback(() => {
    flushPending();
    convertRef.current?.abort();
    saveRef.current?.controller.abort();
    saveRef.current = null;
    analyzeRef.current?.abort();
    analyzeRef.current = null;
    setAnalyzeProgress(null);
    setAnalyzeError(null);
    setAnalyzeWarning(null);
    setError(null);
    setSaveError(null);
    setConverting(false);
    setConvertProgress(null);
    setSaveProgress(null);
    setTime(0);
    setDuration(0);
    setDims(null);
    setPlaying(false);
  }, [flushPending]);

  /** Open a recording from history. */
  const openEntry = useCallback(
    (entry: LibraryEntry) => {
      setHistoryOpen(false);
      if (entry.id === currentIdRef.current) return;
      resetPlayback();
      fileRef.current = null;
      persistedRef.current = JSON.stringify([entry.id, entry.fps, entry.markers]);
      setCurrent(entry.id);
      setFileName(entry.name);
      setFps(entry.fps);
      setMarkers(entry.markers);
      setConverted(entry.converted);
      if (entry.width && entry.height) setAspect(entry.width / entry.height);
      swapSrc(videoUrl(entry));
    },
    [resetPlayback, setCurrent, swapSrc],
  );

  const loadFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("video/")) {
        setError("That isn't a video file. Drop an .mp4 or .mov recording.");
        return;
      }
      // Seen this one before? Reuse the saved copy (and its conversion and markers).
      const key = fileKey(file);
      const existing = historyRef.current.find((e) => e.key === key);
      if (existing) {
        openEntry(existing);
        return;
      }

      resetPlayback();
      fileRef.current = file;
      setCurrent(null);
      setConverted(false);
      setMarkers([]);
      setFileName(file.name);
      persistedRef.current = "";
      swapSrc(URL.createObjectURL(file)); // play straight away from memory

      // ...and save a copy in the background for history / training data.
      const controller = new AbortController();
      setSaveProgress(0);
      const promise = uploadOriginal(file, fps, setSaveProgress, controller.signal)
        .then((entry) => {
          if (controller.signal.aborted) return null;
          upsert(entry);
          persistedRef.current = JSON.stringify([entry.id, entry.fps, entry.markers]);
          setCurrent(entry.id);
          setSaveProgress(null);
          return entry.id;
        })
        .catch((err) => {
          if (!controller.signal.aborted) {
            setSaveProgress(null);
            setSaveError(err instanceof Error ? err.message : "Couldn't save the recording.");
          }
          return null;
        });
      saveRef.current = { controller, promise };
    },
    [fps, openEntry, resetPlayback, setCurrent, swapSrc, upsert],
  );

  /** Re-encode through the local ffmpeg route (H.264, constant frame rate). */
  const convert = useCallback(async () => {
    convertRef.current?.abort();
    const controller = new AbortController();
    convertRef.current = controller;

    setError(null);
    setConverting(true);
    setConvertProgress(null);
    setPlaying(false);
    try {
      // A fresh file may still be uploading; conversion works from the saved copy.
      const id = currentIdRef.current ?? (await saveRef.current?.promise) ?? null;
      if (controller.signal.aborted) return;
      if (!id) {
        throw new Error(
          "PEKKA couldn't save this recording to its history, so it can't convert it.",
        );
      }
      const entry = await convertEntry(id, fps, setConvertProgress, controller.signal);
      if (controller.signal.aborted) return;
      upsert(entry);
      setTime(0);
      setDuration(0);
      setDims(null);
      setConverted(true);
      swapSrc(videoUrl(entry, "converted"));
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Conversion failed.");
    } finally {
      if (convertRef.current === controller) {
        setConverting(false);
        setConvertProgress(null);
        convertRef.current = null;
      }
    }
  }, [fps, swapSrc, upsert]);

  const cancelConvert = useCallback(() => {
    convertRef.current?.abort();
    setError("Conversion cancelled. This file may not play until it's converted.");
  }, []);

  /* ---------- analysis (which cards were played) ---------- */

  const analysis = analysisState && analysisState.id === currentId ? analysisState.data : null;
  const analyzedAt = history.find((e) => e.id === currentId)?.analyzedAt ?? null;

  // Opening a recording that was analyzed before: load what we saved.
  useEffect(() => {
    if (!currentId || !analyzedAt) return;
    const shown = analysisRef.current;
    if (shown && shown.id === currentId && shown.at === analyzedAt) return;
    let alive = true;
    getAnalysis(currentId)
      .then((data) => {
        if (!alive || !data) return;
        analysisRef.current = { id: currentId, at: analyzedAt };
        setAnalysisState({ id: currentId, data });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [currentId, analyzedAt]);

  const runAnalysis = useCallback(async () => {
    analyzeRef.current?.abort();
    const controller = new AbortController();
    analyzeRef.current = controller;
    setAnalyzeError(null);
    setAnalyzeWarning(null);
    setAnalyzeProgress(0);
    try {
      // A fresh file may still be uploading; analysis works from the saved copy.
      const id = currentIdRef.current ?? (await saveRef.current?.promise) ?? null;
      if (controller.signal.aborted) return;
      if (!id) {
        throw new Error("This recording couldn't be saved to history, so it can't be analyzed.");
      }
      const result = await analyzeEntry(
        id,
        { onProgress: setAnalyzeProgress, onWarning: setAnalyzeWarning },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      upsert(result.entry);
      analysisRef.current = { id, at: result.entry.analyzedAt ?? "" };
      setAnalysisState({ id, data: result.analysis });
    } catch (err) {
      if (controller.signal.aborted) return;
      setAnalyzeError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      if (analyzeRef.current === controller) {
        setAnalyzeProgress(null);
        analyzeRef.current = null;
      }
    }
  }, [upsert]);

  /** Name an unrecognised card; the analysis on screen updates to match. */
  const nameUnknownCard = useCallback(async (unknown: string, name: string) => {
    const id = currentIdRef.current;
    if (!id) throw new Error("Open a saved recording first.");
    const data = await nameCard(id, unknown, name);
    setAnalysisState({ id, data });
  }, []);

  const cancelAnalysis = useCallback(() => {
    analyzeRef.current?.abort();
    analyzeRef.current = null;
    setAnalyzeProgress(null);
  }, []);

  const analysisStatus: AnalysisStatus = {
    progress: analyzeProgress,
    error: analyzeError,
    warning: analyzeWarning,
  };

  const removeEntry = useCallback(
    async (entry: LibraryEntry) => {
      if (!window.confirm(`Delete "${entry.name}" and its markers from disk?`)) return;
      if (pendingRef.current?.id === entry.id) pendingRef.current = null;
      try {
        await deleteEntry(entry.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete that recording.");
        return;
      }
      setHistory((prev) => prev.filter((e) => e.id !== entry.id));
      if (currentIdRef.current === entry.id) {
        resetPlayback();
        fileRef.current = null;
        setCurrent(null);
        swapSrc(null);
        setFileName("");
        setMarkers([]);
        setConverted(false);
      }
    },
    [resetPlayback, setCurrent, swapSrc],
  );

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

  /** Jump forward/back by a number of seconds, keeping play/pause state. */
  const skip = useCallback(
    (seconds: number) => {
      const v = videoRef.current;
      if (!v) return;
      seek(v.currentTime + seconds);
    },
    [seek],
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
      saveRef.current?.controller.abort();
      analyzeRef.current?.abort();
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

      if (!videoRef.current) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          skip(-5);
          break;
        case "ArrowRight":
          e.preventDefault();
          skip(5);
          break;
        case "j":
        case "J":
          e.preventDefault();
          skip(-10);
          break;
        case "l":
        case "L":
          e.preventDefault();
          skip(10);
          break;
        case "k":
        case "K":
          e.preventDefault();
          togglePlay();
          break;
        case ",":
          e.preventDefault();
          stepFrames(-1);
          break;
        case ".":
          e.preventDefault();
          stepFrames(1);
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
  }, [togglePlay, stepFrames, skip, addMarker]);

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
          {saveProgress !== null && !converting && (
            <span className="shrink-0 text-sm tabular-nums text-dim">
              Saving… {Math.round(saveProgress * 100)}%
            </span>
          )}
          {saveError && (
            <span
              className="shrink-0 text-sm text-dim"
              title={`${saveError} It won't appear in history.`}
            >
              Not saved
            </span>
          )}
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            aria-expanded={historyOpen}
            className="shrink-0 rounded border border-seam px-3 py-1.5 text-sm transition-colors hover:bg-seam"
          >
            History{history.length > 0 ? ` (${history.length})` : ""}
          </button>
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

      <main className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,3fr)_minmax(0,2fr)] lg:flex">
        <section
          className="stage-col flex min-h-0 min-w-0 flex-col overflow-hidden"
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
                  setDims({ w: v.videoWidth, h: v.videoHeight });
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
              <ProgressOverlay
                title={saveProgress !== null ? "Saving recording" : "Converting for playback"}
                detail={
                  saveProgress !== null
                    ? "Copying it into your history first, so you only convert once."
                    : `Re-encoding to H.264 at ${fps} fps. Long recordings can take a minute.`
                }
                ratio={saveProgress !== null ? saveProgress : convertProgress}
                onCancel={cancelConvert}
              />
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
            onSkip={skip}
            onRate={changeRate}
            onFps={setFps}
          />
        </section>

        <TimelinePanel
          markers={markers}
          time={time}
          hasVideo={!!src}
          entryId={currentId}
          analysis={analysis}
          status={analysisStatus}
          onSeek={seek}
          onAnalyze={() => void runAnalysis()}
          onCancelAnalyze={cancelAnalysis}
          onNameCard={nameUnknownCard}
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

      <HistoryPanel
        open={historyOpen}
        entries={history}
        currentId={currentId}
        onClose={() => setHistoryOpen(false)}
        onOpen={openEntry}
        onDelete={(e) => void removeEntry(e)}
      />
    </div>
  );
}
