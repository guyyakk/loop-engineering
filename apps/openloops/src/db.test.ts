import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { allLoops, openDb, saveLoop } from './db'
import { createLoop, emptyDraft, newStep, toggleStep } from './domain/loop'

describe('db', () => {
  it('keeps loops after the database is closed and opened again (reload)', async () => {
    const name = `test-${crypto.randomUUID()}`
    const first = openDb(name)
    const loop = createLoop({ ...emptyDraft('today'), title: 'รายงาน Q3', steps: [newStep('ดึงตัวเลข')] }, new Date())
    await saveLoop(loop, first)
    await saveLoop(toggleStep(loop, loop.steps[0].id, new Date()), first)
    first.close()

    const second = openDb(name)
    const stored = await allLoops(second)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ id: loop.id, title: 'รายงาน Q3', horizon: 'today', status: 'done' })
    expect(stored[0].steps[0].doneAt).not.toBeNull()
    second.close()
  })
})
