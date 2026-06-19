export function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m} : ${String(s).padStart(2, "0")}`;
}
