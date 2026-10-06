/** Starts the server-side job poller once per Next.js server instance. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensurePoller } = await import("@/lib/jobs/poller");
    ensurePoller();
  }
}
