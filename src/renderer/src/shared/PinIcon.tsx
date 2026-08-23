/**
 * Pushpin glyph for the "pin to desktop" controls. Monochrome and drawn in
 * currentColor (never an emoji) so it inherits the muted control colour the way
 * FolderIcon does; `filled` is what distinguishes a pinned todo from an
 * unpinned one, so the state reads without relying on colour alone.
 */
export function PinIcon({ filled = false }: { filled?: boolean }): JSX.Element {
  return (
    <svg
      className="pin-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6.25 2.5v2.7c0 .9-.6 1.5-1.1 2.1-.4.5-.65 1-.65 1.7h7c0-.7-.25-1.2-.65-1.7-.5-.6-1.1-1.2-1.1-2.1V2.5"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 2.5h5M8 9v4.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}
