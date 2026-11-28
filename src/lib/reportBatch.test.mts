/** Run with: node src/lib/reportBatch.test.mts */
import assert from 'node:assert/strict'
import { buildBatchJobs, needsGround, runBatch, isBusyError, countLabel } from './reportBatch.ts'

const KINDS = ['ground_goat', 'soil_map', 'aerial', 'elevation_3d']
const GROUNDS = [{ id: 'a', name: 'North 80' }, { id: 'b', name: 'Home' }, { id: 'c', name: 'Creek' }]
const S = (...x: string[]) => new Set(x)
let passed = 0
async function test(name: string, fn: () => void | Promise<void>) { await fn(); passed++; console.log('PASS ', name) }

await test('project: every ticked report for every ticked ground, aerial once', () => {
  const jobs = buildBatchJobs({ isProject: true, kindsInOrder: KINDS, pickedKinds: S(...KINDS), grounds: GROUNDS, pickedGroundIds: S('a', 'c') })
  assert.deepEqual(jobs.map((j) => `${j.kind}:${j.groundId}`), [
    'ground_goat:a', 'ground_goat:c', 'soil_map:a', 'soil_map:c', 'aerial:null', 'elevation_3d:a', 'elevation_3d:c'])
  assert.equal(jobs[0].groundName, 'North 80')
})
await test('project: aerial alone needs no ground and is one job', () => {
  assert.equal(needsGround(true, S('aerial')), false)
  assert.equal(buildBatchJobs({ isProject: true, kindsInOrder: KINDS, pickedKinds: S('aerial'), grounds: GROUNDS, pickedGroundIds: S() }).length, 1)
})
await test('project: ground reports with no ground ticked make no jobs and need ground', () => {
  assert.equal(needsGround(true, S('soil_map', 'aerial')), true)
  assert.deepEqual(buildBatchJobs({ isProject: true, kindsInOrder: KINDS, pickedKinds: S('soil_map'), grounds: GROUNDS, pickedGroundIds: S() }), [])
})
await test('parcel / tract / one farm: one job per ticked report', () => {
  const jobs = buildBatchJobs({ isProject: false, kindsInOrder: ['tract', ...KINDS], pickedKinds: S('tract', 'soil_map'), grounds: [], pickedGroundIds: S() })
  assert.deepEqual(jobs.map((j) => j.kind), ['tract', 'soil_map'])
  assert.equal(needsGround(false, S('soil_map')), false)
})
await test('nothing ticked = nothing to send', () => {
  assert.deepEqual(buildBatchJobs({ isProject: true, kindsInOrder: KINDS, pickedKinds: S(), grounds: GROUNDS, pickedGroundIds: S('a') }), [])
})
await test('runBatch: never more than the limit at once, all finish, progress counts up', async () => {
  const jobs = buildBatchJobs({ isProject: true, kindsInOrder: KINDS, pickedKinds: S(...KINDS), grounds: GROUNDS, pickedGroundIds: S('a', 'b', 'c') })
  assert.equal(jobs.length, 10)
  let live = 0, peak = 0; const seen: number[] = []
  const r = await runBatch(jobs, async () => { live++; peak = Math.max(peak, live); await new Promise((x) => setTimeout(x, 5)); live-- },
    { concurrency: 3, onProgress: (f) => seen.push(f) })
  assert.equal(peak, 3); assert.equal(r.done, 10); assert.equal(r.failed.length, 0)
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})
await test('runBatch: "too many building" waits and tries again; a real error is recorded and the rest go on', async () => {
  const jobs = [{ kind: 'soil_map', groundId: 'a', groundName: 'A' }, { kind: 'soil_map', groundId: 'b', groundName: 'B' }, { kind: 'soil_map', groundId: 'c', groundName: 'C' }]
  const tries: Record<string, number> = {}; let slept = 0
  const r = await runBatch(jobs, async (j) => {
    tries[j.groundId!] = (tries[j.groundId!] || 0) + 1
    if (j.groundId === 'a' && tries.a < 3) throw new Error('You already have 4 reports building. Wait for one to finish before starting another.')
    if (j.groundId === 'b') throw new Error('The report failed to build.')
  }, { concurrency: 1, waitMs: 1, sleep: async () => { slept++ } })
  assert.equal(tries.a, 3); assert.equal(slept, 2)
  assert.equal(r.done, 2); assert.equal(r.failed.length, 1); assert.equal(r.failed[0].job.groundId, 'b')
})
await test('runBatch: gives up waiting after maxWaits', async () => {
  const r = await runBatch([{ kind: 'x', groundId: null, groundName: null }], async () => { throw Object.assign(new Error('busy'), { status: 429 }) },
    { maxWaits: 2, sleep: async () => {} })
  assert.equal(r.done, 0); assert.equal(r.failed.length, 1)
})
await test('isBusyError + countLabel', () => {
  assert.equal(isBusyError(new Error('Too many reports in progress — wait for one to finish')), true)
  assert.equal(isBusyError(new Error('That report went missing.')), false)
  assert.equal(countLabel(1), '1 report'); assert.equal(countLabel(12), '12 reports')
})
console.log(`\n${passed} passed`)
