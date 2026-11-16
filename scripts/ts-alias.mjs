// Lets `node` run a src/lib test whose imports use the Next.js "@/…" alias:
//   node --import ./scripts/ts-alias.mjs src/lib/giveWay.test.ts
import { register } from 'node:module'
register('data:text/javascript,' + encodeURIComponent(`
import { existsSync } from 'node:fs'
const SRC = ${JSON.stringify(new URL('../src/', import.meta.url).href)}
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) {
    for (const ext of ['.ts', '.tsx']) {
      const url = SRC + spec.slice(2) + ext
      if (existsSync(new URL(url))) return next(url, ctx)
    }
  }
  return next(spec, ctx)
}`))
