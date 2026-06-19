export function basename(path: string): string {
  return path.split("/").pop() || path;
}

export function dirname(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}
