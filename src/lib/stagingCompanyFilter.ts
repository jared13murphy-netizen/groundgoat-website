// Auction Staging company filter (owner 11/25: "when I filter by company it
// should show all of their auctions on one page"). Pure helpers; no I/O.

export const STAGING_PAGE_SIZE = 20
// One company's whole list on one page (pager only if a company ever has more).
export const COMPANY_PAGE_SIZE = 200

export type StagingCompany = { id: string; name: string; count: number }

export function stagingPageSize(companyId: string | null): number {
  return companyId ? COMPANY_PAGE_SIZE : STAGING_PAGE_SIZE
}

/** Query string for GET /api/admin/staging (pending auctions). */
export function stagingListQuery(page: number, companyId: string | null): string {
  const size = stagingPageSize(companyId)
  const q = `status=pending&listing_type=auction&limit=${size}&offset=${Math.max(0, page) * size}`
  return companyId ? `${q}&company_id=${encodeURIComponent(companyId)}` : q
}

/** The companies endpoint's answer, or null when it is not the expected shape
 *  (old backend / error) — the page then keeps today's one-page filter. */
export function parseStagingCompanies(data: unknown): StagingCompany[] | null {
  if (!Array.isArray(data)) return null
  const out: StagingCompany[] = []
  for (const c of data) {
    if (!c || typeof c !== 'object') return null
    const { id, name, count } = c as Record<string, unknown>
    if (typeof id !== 'string' || !id || typeof count !== 'number') return null
    out.push({ id, name: typeof name === 'string' && name ? name : '(unnamed company)', count })
  }
  return out
}

/** Dropdown options; a selected company that no longer has pending rows stays
 *  listed (count 0) so the selection is kept across refreshes. */
export function companyOptions(companies: StagingCompany[], selectedId: string | null,
                               selectedName?: string): StagingCompany[] {
  if (!selectedId || companies.some((c) => c.id === selectedId)) return companies
  return [...companies, { id: selectedId, name: selectedName || selectedId, count: 0 }]
}

export function allCompaniesCount(companies: StagingCompany[]): number {
  return companies.reduce((n, c) => n + c.count, 0)
}
