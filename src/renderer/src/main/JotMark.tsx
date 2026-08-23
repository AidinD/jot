/**
 * Jot's mark, in the header beside the wordmark.
 *
 * The same drawing as `resources/icon.png` - a circle with a tick whose long arm
 * leaves through a gap in it - redrawn as inline SVG so it is sharp at 20px next
 * to 20px text, where a downscaled 256px bitmap is soft. Added alongside the
 * same change in Nib, so the two apps introduce themselves the same way.
 */
export function JotMark({ size = 20 }: { size?: number }): JSX.Element {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="url(#jot-flame)"
      strokeWidth={9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="jot-flame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9a3c" />
          <stop offset="1" stopColor="#ff6b6b" />
        </linearGradient>
      </defs>
      {/* The circle, interrupted at the top right where the tick's arm exits.
          The dashes are the interruption: 154 of the 188 unit circumference
          drawn, the rest left open. */}
      <circle cx="50" cy="52" r="30" strokeDasharray="154 34" />
      <path d="M34 54 L46 66 L78 24" />
    </svg>
  )
}
