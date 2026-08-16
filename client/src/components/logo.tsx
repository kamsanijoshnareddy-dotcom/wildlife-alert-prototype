export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-label="Verified Wildlife Alert logo"
      role="img"
    >
      {/* Road: two converging lanes */}
      <path d="M9 27 L14 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M23 27 L18 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Lane dash */}
      <path
        d="M16 22 L16 17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* Radar / pulse arcs sweeping up from the vanishing point */}
      <circle cx="16" cy="9" r="2.1" fill="currentColor" className="text-status-medium" />
      <path
        d="M11.5 9a4.5 4.5 0 0 1 9 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.85"
        className="text-status-medium"
      />
      <path
        d="M8.5 9a7.5 7.5 0 0 1 15 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.5"
        className="text-status-medium"
      />
    </svg>
  );
}
