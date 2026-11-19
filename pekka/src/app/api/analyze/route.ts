import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ANALYSIS_FILE,
  CARDS_DIR,
  CONVERTED_FILE,
  entryPath,
  readEntry,
  updateEntry,
} from "@/lib/library";
import { guard, json } from "@/lib/local";

/**
 * Runs the Python recognition worker (analysis/analyze.py) on a saved recording.
 *
 * POST /api/analyze?id=<library id>
 * Replies with newline-delimited JSON events, like /api/convert:
 *   {type:"progress", pct: 0..1}   {type:"warning", message}
 *   {type:"done", entry, analysis} or {type:"error", error}
 */

const ANALYSIS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "analysis");
const SETUP_HINT = "Run `python3 analysis/setup.py` once, then try again.";

function pythonCommand(): string {
  if (process.env.PEKKA_PYTHON) return process.env.PEKKA_PYTHON;
  const venv =
    process.platform === "win32"
      ? path.join(ANALYSIS_DIR, ".venv", "Scripts", "python.exe")
      : path.join(ANALYSIS_DIR, ".venv", "bin", "python");
  if (existsSync(venv)) return venv;
  return process.platform === "win32" ? "python" : "python3";
}

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  const entry = await readEntry(id);
  if (!entry) return json("That recording isn't in your history anymore.", 404);

  // Prefer the converted copy: constant frame rate, and quicker to decode.
  const video = entryPath(id, entry.converted ? CONVERTED_FILE : entry.originalFile);
  const out = entryPath(id, ANALYSIS_FILE);

  const encoder = new TextEncoder();
  let child: ChildProcess | null = null;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    child?.kill("SIGKILL");
  };
  request.signal.addEventListener("abort", cancel, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: object) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* client went away */
        }
      };
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const proc = spawn(
        pythonCommand(),
        [
          path.join(ANALYSIS_DIR, "analyze.py"),
          video,
          out,
          "--cards",
          CARDS_DIR,
        ],
        { cwd: ANALYSIS_DIR, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } },
      );
      child = proc;

      let buf = "";
      let sawDone = false;
      let workerError: string | null = null;
      let stderr = "";

      const handleLine = (line: string) => {
        if (!line.trim()) return;
        let ev: { type?: string; error?: string };
        try {
          ev = JSON.parse(line);
        } catch {
          return; // stray print from a library; ignore
        }
        if (ev.type === "done") sawDone = true;
        else if (ev.type === "error") {
          workerError = ev.error ?? "Analysis failed.";
          send(ev);
        } else send(ev);
      };

      proc.stdout.on("data", (d) => {
        buf += d;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        lines.forEach(handleLine);
      });
      proc.stderr.on("data", (d) => {
        stderr = (stderr + d).slice(-3000);
      });

      proc.on("error", (err: NodeJS.ErrnoException) => {
        send({
          type: "error",
          error:
            err.code === "ENOENT"
              ? `Python wasn't found. ${SETUP_HINT}`
              : `Couldn't start Python: ${err.message}`,
        });
        close();
      });

      proc.on("close", async (code) => {
        if (cancelled) return close();
        handleLine(buf);
        try {
          if (code === 0 && sawDone) {
            const analysis = JSON.parse(await readFile(out, "utf8"));
            const updated = await updateEntry(id, (e) => ({
              ...e,
              analyzedAt: analysis.created ?? new Date().toISOString(),
            }));
            send({ type: "done", entry: updated, analysis });
          } else if (!workerError) {
            const missing = /No module named|ModuleNotFoundError/.test(stderr);
            const tail = stderr.trim().split("\n").slice(-2).join(" ");
            send({
              type: "error",
              error: missing
                ? `Python is missing its packages. ${SETUP_HINT}`
                : `The analysis stopped unexpectedly. ${tail}`.trim(),
            });
          }
        } catch (err) {
          send({ type: "error", error: err instanceof Error ? err.message : "Analysis failed." });
        }
        close();
      });
    },
    cancel,
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
