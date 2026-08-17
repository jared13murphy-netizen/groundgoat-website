/** Who may use report actions ("+ Report", Download/Email Parcel).
 *
 * Owner ruling 2026-08-17: "allow for premium_state and hide for
 * basic_state" — and, on follow-up, "+ Report" is gated too, on BOTH the
 * parcel panel and the tract panel, so a basic_state user cannot build a
 * report from either surface.
 *
 * The four account_types are the ones the backend's _require_report_access
 * has always allowed; they're matched by role here so staff/firm never lose
 * the buttons even before the backend ships `can_use_reports`. premium_state
 * subscribers arrive via that flag once the backend deploys.
 */
export const REPORT_ALLOWED_ROLES = ['groundgoat_admin', 'groundgoat_sales', 'firm_admin', 'firm_user']

export function canUseReportsFor(me: any): boolean {
  if (!me) return false
  return REPORT_ALLOWED_ROLES.includes(me?.account_type) || Boolean(me?.can_use_reports)
}
