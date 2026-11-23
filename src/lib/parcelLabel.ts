// The map parcel label (owner 11/20, "one number everywhere"): owner, then
// the acres / $ per acre (or total price) / sale date lines — every figure
// line is a tile property the BACKEND wrote from the one parcel record
// (gg_label_acres, gg_label_ppa, gg_label_price, gg_label_date,
// gg_price_mode). The client prints those strings and nothing else: no
// division, no tile `saleprice` / `ll_gisacre`, and a line whose property is
// absent or empty is simply not drawn (no "$/Acre" row without a price).
//
// Shared by the Explore map (ExploreMap.tsx) and the Regrid layer helper
// (regridLayer.ts) so the two labels cannot drift. Zero imports: runnable
// with `node src/lib/parcelLabel.test.ts`.

type Expr = any

/** `get` of a tile string that is present and not empty / "—". */
function hasText(prop: string): Expr {
  return ['all', ['has', prop], ['!=', ['to-string', ['get', prop]], ''], ['!=', ['to-string', ['get', prop]], '—']]
}

/** "$"-prefixed value: the server's price strings already start with "$". */
function dollar(prop: string): Expr {
  return ['case', ['==', ['slice', ['to-string', ['get', prop]], 0, 1], '$'],
    ['get', prop],
    ['concat', '$', ['get', prop]]]
}

/** The four figure segments of the label after the owner. `dateLead` is
 *  "Sold: " (Regrid layer) or "Sale Date: " (Explore map). */
export function parcelLabelSegments(dateLead: string): any[] {
  const opts = { 'font-scale': 1.0 }
  return [
    // acres
    ['case', hasText('gg_label_acres'),
      ['concat', '\n',
        ['case', ['in', ' ac', ['to-string', ['get', 'gg_label_acres']]],
          ['get', 'gg_label_acres'],
          ['concat', ['get', 'gg_label_acres'], ' ac']]],
      ''],
    opts,
    // $/acre — the server leaves gg_label_ppa empty when price_mode is total
    ['case', hasText('gg_label_ppa'),
      ['concat', '\n$/Acre: ', dollar('gg_label_ppa')],
      ''],
    opts,
    // total price — price_mode "total" (< 10 ac or no ag land type, owner 11/4)
    ['case', ['all', ['==', ['to-string', ['get', 'gg_price_mode']], 'total'], hasText('gg_label_price')],
      ['concat', '\nSale Price: ', dollar('gg_label_price')],
      ''],
    opts,
    // sale date, as formatted by the server
    ['case', hasText('gg_label_date'),
      ['concat', '\n' + dateLead, ['get', 'gg_label_date']],
      ''],
    opts,
  ]
}
