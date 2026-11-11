// Regenerates COUNTIES_BY_STATE in src/data/counties.ts from the one county
// table on the server (GET /api/geo/counties). The website keeps this copy so
// pickers render instantly and still work offline; sign-up also reads the
// table live. Run after any change to the counties table:
//   node scripts/sync-counties.mjs [api_base]   (default https://api.groundgoat.com)
import { readFileSync, writeFileSync } from 'node:fs'

const api = process.argv[2] || 'https://api.groundgoat.com'
const file = new URL('../src/data/counties.ts', import.meta.url)
const src = readFileSync(file, 'utf8')

const abbrBlock = src.slice(src.indexOf('{', src.indexOf('STATE_ABBREVIATIONS')))
const abbr = Object.fromEntries([...abbrBlock.slice(0, abbrBlock.indexOf('}')).matchAll(/"([^"]+)":\s*"([A-Z]{2})"/g)].map(m => [m[2], m[1]]))

const res = await fetch(`${api}/api/geo/counties`)
if (!res.ok) throw new Error(`${api} answered ${res.status}`)
const { states } = await res.json()
const codes = Object.keys(states)
if (codes.length !== 50) throw new Error(`expected 50 states, got ${codes.length}`)

const lines = codes
  .map(st => [abbr[st] || (() => { throw new Error(`no name for ${st}`) })(), states[st]])
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, list]) => `  ${JSON.stringify(name)}: ${JSON.stringify(list).replace(/","/g, '", "')},`)

const start = src.indexOf('export const COUNTIES_BY_STATE')
const end = src.indexOf('\n}\n', start) + 3
const block = `export const COUNTIES_BY_STATE: Record<string, string[]> = {\n${lines.join('\n')}\n}\n`
writeFileSync(file, src.slice(0, start) + block + src.slice(end))
console.log(`wrote ${codes.length} states, ${codes.reduce((n, st) => n + states[st].length, 0)} counties from ${api}`)
