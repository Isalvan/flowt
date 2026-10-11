/**
 * Fixed-window rate limiter kept in the Worker isolate's memory. Same as the Zenith worker.
 *
 * Best effort: each Cloudflare isolate keeps its own counters, so the effective limit can
 * be higher under heavy load across many isolates. It still stops a single client from
 * hammering the endpoint (and the Firestore reads behind it) without any paid service.
 */
export function createRateLimiter({ limit, windowMs, maxKeys = 10000, now = () => Date.now() }) {
  const windows = new Map();

  const prune = (time) => {
    for (const [key, window] of windows) {
      if (time >= window.resetAt) windows.delete(key);
    }
    while (windows.size > maxKeys) windows.delete(windows.keys().next().value);
  };

  return {
    check(key) {
      const time = now();
      let window = windows.get(key);
      if (!window || time >= window.resetAt) {
        window = { count: 0, resetAt: time + windowMs };
        windows.delete(key);
        windows.set(key, window);
      }
      window.count += 1;
      if (windows.size > maxKeys) prune(time);
      return { allowed: window.count <= limit, retryAfterSec: Math.max(1, Math.ceil((window.resetAt - time) / 1000)) };
    },
  };
}
