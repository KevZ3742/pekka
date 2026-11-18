import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";

/**
 * Local helper: re-encodes a recording to H.264 8-bit mp4 at a constant frame
 * rate so every browser can play it and frame stepping is reliable.
 * Needs `ffmpeg` on your PATH. Only meant to run on your own machine.
 */

const ALLOWED_FPS = new Set([24, 30, 60]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function json(error: string, status: number) {
  return Response.json({ error }, { status });
}

function isLocalRequest(request: Request): boolean {
  if (process.env.PEKKA_ALLOW_REMOTE_CONVERT === "1") return true;
  const host = request.headers.get("host") ?? "";
  if (!LOCAL_HOSTS.has(host.replace(/:\d+$/, ""))) return false;
  // Browsers send Origin on cross-site POSTs; it must match this host.
  const origin = request.headers.get("origin");
  return !origin || new URL(origin).host === host;
}

function runFfmpeg(args: string[]): Promise<{ ok: boolean; log: string; missing?: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    child.stderr.on("data", (d) => {
      log = (log + d).slice(-4000);
    });
    child.on("error", (err: NodeJS.ErrnoException) =>
      resolve({ ok: false, log: err.message, missing: err.code === "ENOENT" }),
    );
    child.on("close", (code) => resolve({ ok: code === 0, log }));
  });
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) {
    return json("Conversion is only available when running PEKKA locally.", 403);
  }
  if (!request.body) return json("No file was sent.", 400);

  const fps = Number(new URL(request.url).searchParams.get("fps") ?? 60);
  if (!ALLOWED_FPS.has(fps)) return json("Unsupported frame rate.", 400);

  const dir = await mkdtemp(join(tmpdir(), "pekka-"));
  const input = join(dir, "input");
  const output = join(dir, "output.mp4");
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});

  try {
    // Stream the upload to disk so big recordings never sit in memory.
    await pipeline(
      Readable.fromWeb(request.body as unknown as NodeWebStream),
      createWriteStream(input),
    );

    const result = await runFfmpeg([
      "-hide_banner",
      "-loglevel", "error",
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
      output,
    ]);

    if (result.missing) {
      await cleanup();
      return json(
        "ffmpeg isn't installed or isn't on your PATH. Install it, then restart `npm run dev` from a new terminal.",
        501,
      );
    }
    if (!result.ok) {
      await cleanup();
      return json(`ffmpeg couldn't convert that file. ${result.log.trim()}`, 422);
    }

    const { size } = await stat(output);
    const file = createReadStream(output);
    file.on("close", cleanup); // also fires if the client disconnects
    return new Response(Readable.toWeb(file) as unknown as ReadableStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(size),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    await cleanup();
    return json(err instanceof Error ? err.message : "Conversion failed.", 500);
  }
}
