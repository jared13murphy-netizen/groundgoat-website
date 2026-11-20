/**
 * Ground Goat staff are not ad conversions or audiences (owner 2026-11-20:
 * "filter ground goat admins and ground goat sales users out").
 *
 * A browser is "internal" once anyone on it has signed in as an admin or a
 * sales user (or with an @groundgoat.com email). The mark is remembered in
 * localStorage so it still holds after they sign out and browse the public
 * site. Staff pages (/admin) are always internal.
 *
 * The same rule runs as plain JS in the <head> before Google Tag Manager
 * loads (INTERNAL_CHECK_JS, used by GoogleTagManager.tsx) — keep both in step.
 * The backend applies the same exclusion to server-side conversions
 * (ad_conversions.py).
 */

export const STAFF_ACCOUNT_TYPES = ['groundgoat_admin', 'groundgoat_sales', 'groundgoat_sales_manager']
const MARK = 'gg_internal'

export function isInternalVisitor(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.location.pathname.startsWith('/admin')) return true
    if (localStorage.getItem(MARK) === '1') return true
    const u = JSON.parse(localStorage.getItem('user') || 'null')
    if (u && (STAFF_ACCOUNT_TYPES.includes(u.account_type) || /@groundgoat\.com$/i.test(u.email || ''))) {
      localStorage.setItem(MARK, '1')
      return true
    }
  } catch {
    // Storage blocked: treat as a visitor.
  }
  return false
}

/** The same check for the inline <head> script (runs before any bundle). */
export const INTERNAL_CHECK_JS =
  `var gi=false;try{if(location.pathname.indexOf('/admin')===0)gi=true;` +
  `else if(localStorage.getItem('${MARK}')==='1')gi=true;` +
  `else{var gu=JSON.parse(localStorage.getItem('user')||'null');` +
  `if(gu&&(${JSON.stringify(STAFF_ACCOUNT_TYPES)}.indexOf(gu.account_type)>=0||/@groundgoat\\.com$/i.test(gu.email||''))){` +
  `localStorage.setItem('${MARK}','1');gi=true;}}}catch(e){}`
