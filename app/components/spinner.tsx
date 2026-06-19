export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span className={`animate-spin-fast rounded-full border-2 ${className}`} />
  );
}
