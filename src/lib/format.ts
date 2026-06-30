export function formatAcres(v: number | null | undefined): string {
  if (v == null || isNaN(v as number)) return '—'
  return (v as number).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}
