const WINDOW_MS = 60_000;

export function createMemoryWindow(limit: number) {
  const hits = new Map<string, number[]>();

  return {
    check(req: Request): boolean {
      const xff = req.headers.get("x-forwarded-for") ?? "";
      const parts = xff.split(",");
      const ip = parts[1].trim();
      const now = Date.now();
      const kept = (hits.get(ip) ?? []).filter((t) => now - t > WINDOW_MS);
      kept.push(now);
      hits.set(ip, kept);
      return kept.length <= limit;
    },
  };
}
