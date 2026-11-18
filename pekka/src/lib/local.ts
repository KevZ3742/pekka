const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function json(error: string, status: number) {
  return Response.json({ error }, { status });
}

/** The API reads and writes files on this machine, so it only answers local requests. */
export function isLocalRequest(request: Request): boolean {
  if (process.env.PEKKA_ALLOW_REMOTE_CONVERT === "1") return true;
  const host = request.headers.get("host") ?? "";
  if (!LOCAL_HOSTS.has(host.replace(/:\d+$/, ""))) return false;
  // Browsers send Origin on cross-site POSTs; it must match this host.
  const origin = request.headers.get("origin");
  return !origin || new URL(origin).host === host;
}

/** Returns a 403 response to send back, or null when the request may proceed. */
export function guard(request: Request): Response | null {
  return isLocalRequest(request)
    ? null
    : json("History and conversion are only available when running PEKKA locally.", 403);
}
