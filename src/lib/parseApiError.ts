/**
 * Parse API error responses from FastAPI.
 * FastAPI validation errors return detail as an array of objects: [{msg, type, loc}, ...]
 * Normal errors return detail as a string.
 * This function handles both formats safely.
 */
export function parseApiError(data: any, fallback: string = 'Something went wrong. Please try again.'): string {
  const detail = data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((e: any) => e.msg || e.message || String(e)).join(', ')
  }
  return fallback
}
