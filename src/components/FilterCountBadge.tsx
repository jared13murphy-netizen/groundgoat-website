// Filled brand-pink circle with dark text, top-right of a Filters button.
// The parent button must be position: relative (or absolute). Hidden at 0.
export default function FilterCountBadge({ count }: { count: number }) {
  if (!count || count < 1) return null
  return (
    <span
      aria-label={`${count} active filter${count === 1 ? '' : 's'}`}
      style={{
        position: 'absolute',
        top: -6,
        // Inside the button's right edge (owner 10/7: the badge was
        // hanging 6px past it and touching the next button).
        right: 2,
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        borderRadius: 9,
        backgroundColor: '#f58cde',
        color: '#111',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: '18px',
        textAlign: 'center',
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    >
      {count}
    </span>
  )
}
