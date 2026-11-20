import { describe, expect, it, vi } from 'vitest'
import { FeatureRegistry } from '../src/main/features/registry'

describe('FeatureRegistry', () => {
  it('starts empty', () => {
    const r = new FeatureRegistry()
    expect(r.names()).toEqual([])
    expect(r.migrations()).toEqual([])
  })

  it('collects feature migrations and IPC handlers', () => {
    const r = new FeatureRegistry()
    const registerIpc = vi.fn((ipc) => ipc('demo:ping', () => 'pong'))
    r.register({ name: 'demo', migrations: [{ version: 100, name: 'demo', sql: '' }], registerIpc })

    const ipc = vi.fn()
    r.registerIpc(ipc, { db: {} as never })
    expect(r.names()).toEqual(['demo'])
    expect(r.migrations().map((m) => m.version)).toEqual([100])
    expect(ipc).toHaveBeenCalledWith('demo:ping', expect.any(Function))
  })

  it('rejects feature migrations in the core version range', () => {
    const r = new FeatureRegistry()
    expect(() => r.register({ name: 'bad', migrations: [{ version: 5, name: 'x', sql: '' }] })).toThrow(/above 99/)
  })

  it('rejects duplicate feature names', () => {
    const r = new FeatureRegistry()
    r.register({ name: 'demo' })
    expect(() => r.register({ name: 'demo' })).toThrow(/already registered/)
  })
})
