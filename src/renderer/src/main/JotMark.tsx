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
      strokeWidth={10.8}
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
      {/*
        The circle, interrupted at the top right where the tick's arm exits.
        The dashes are the interruption: 185 of the 227 unit circumference drawn -
        the same 294 degrees as before - and the rest left open.

        Everything here is the original drawing scaled by 1.203 about (50, 52).
        At the old size the ring's ink spanned 69% of the box while Nib's mark and
        Tend's both span 83%, so in a row of the suite's headers Jot read as the
        small one. Scaled rather than re-drawn, and the icon generator is scaled by
        the same factor, so the window and the taskbar still show one mark.
      */}
      <circle cx="50" cy="52" r="36.1" strokeDasharray="185 42" />
      <path d="M30.8 54.4 L45.2 68.8 L83.7 18.3" />
    </svg>
  )
}
