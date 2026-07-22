export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`animate-spin-fast rounded-full border-2 ${className}`}
    />
  );
}
