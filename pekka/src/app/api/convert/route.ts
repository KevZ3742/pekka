import { spawn, type ChildProcess } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import { CONVERTED_FILE, entryPath, readEntry, updateEntry } from "@/lib/library";
import { guard, json } from "@/lib/local";

/**
 * Local helper: re-encodes a saved recording to H.264 8-bit mp4 at a constant
 * frame rate so every browser can play it and frame stepping is reliable.
 * Needs `ffmpeg` (and ffprobe) on your PATH. Only meant to run on your own machine.
 *
 * POST /api/convert?id=<library id>&fps=<24|30|60>
 * Replies with newline-delimited JSON events:
 *   {type:"progress", pct: 0..1 | null}   (null = duration unknown)
 *   {type:"done", entry}  or  {type:"error", error}
 */

const ALLOWED_FPS = new Set([24, 30, 60]);

type FfmpegResult = { ok: boolean; log: string; missing?: boolean };

function runFfmpeg(
  args: string[],
  onSpawn: (child: ChildProcess) => void,
  onSeconds: (seconds: number) => void,
): Promise<FfmpegResult> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    onSpawn(child);
    let log = "";
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m) onSeconds(Number(m[1]) / 1e6);
      }
    });
    child.stderr.on("data", (d) => {
      log = (log + d).slice(-4000);
    });
    child.on("error", (err: NodeJS.ErrnoException) =>
      resolve({ ok: false, log: err.message, missing: err.code === "ENOENT" }),
    );
    child.on("close", (code) => resolve({ ok: code === 0, log }));
  });
}

/** Total length in seconds, used to turn ffmpeg's clock into a percentage. */
function probeDuration(input: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        "-protocol_whitelist", "file",
        input,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const n = parseFloat(out);
      resolve(Number.isFinite(n) && n > 0 ? n : null);
    });
  });
}

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const fps = Number(params.get("fps") ?? 60);
  if (!ALLOWED_FPS.has(fps)) return json("Unsupported frame rate.", 400);

  const id = params.get("id") ?? "";
  const entry = await readEntry(id);
  if (!entry) return json("That recording isn't in your history anymore.", 404);

  const input = entryPath(id, entry.originalFile);
  const partial = entryPath(id, "video.partial");

  const encoder = new TextEncoder();
  let child: ChildProcess | null = null;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    child?.kill("SIGKILL");
  };
  request.signal.addEventListener("abort", cancel, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* client went away */
        }
      };
      const fail = async (message: string) => {
        await rm(partial, { force: true }).catch(() => {});
        send({ type: "error", error: message });
      };

      try {
        const duration = await probeDuration(input);
        send({ type: "progress", pct: duration ? 0 : null });

        const result = await runFfmpeg(
          [
            "-hide_banner",
            "-loglevel", "error",
            "-nostats",
            "-progress", "pipe:1",
            "-y",
            "-protocol_whitelist", "file",
            "-i", input,
            "-vf", `fps=${fps}`,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-crf", "18",
            "-preset", "veryfast",
            "-c:a", "aac",
            "-movflags", "+faststart",
            "-f", "mp4",
            partial,
          ],
          (c) => {
            child = c;
            if (cancelled) c.kill("SIGKILL");
          },
          (seconds) => {
            if (duration) send({ type: "progress", pct: Math.min(seconds / duration, 0.99) });
          },
        );

        if (cancelled) {
          await rm(partial, { force: true }).catch(() => {});
        } else if (result.missing) {
          await fail(
            "ffmpeg isn't installed or isn't on your PATH. Install it, then restart `npm run dev` from a new terminal.",
          );
        } else if (!result.ok) {
          await fail(`ffmpeg couldn't convert that file. ${result.log.trim()}`);
        } else {
          await rename(partial, entryPath(id, CONVERTED_FILE));
          const updated = await updateEntry(id, (e) => ({
            ...e,
            converted: true,
            convertedAt: new Date().toISOString(),
            convertedFps: fps,
            fps,
          }));
          if (updated) send({ type: "done", entry: updated });
          else send({ type: "error", error: "That recording was deleted during conversion." });
        }
      } catch (err) {
        await fail(err instanceof Error ? err.message : "Conversion failed.");
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}
