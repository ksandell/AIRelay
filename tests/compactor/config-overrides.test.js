import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

describe('config override layer', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airelay-cfg-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('loadOverrides: empty when file missing', async () => {
    const { loadOverrides, _getOverrides } = await import('../../src/config.js')
    await loadOverrides(path.join(tmpDir, 'missing.json'))
    expect(_getOverrides()).toEqual({})
  })

  it('loadOverrides: reads persisted overrides', async () => {
    const file = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ compactorEnabled: true }))
    const { loadOverrides, _getOverrides } = await import('../../src/config.js')
    await loadOverrides(file)
    expect(_getOverrides().compactorEnabled).toBe(true)
  })

  it('applyOverrides: merges + writes', async () => {
    const file = path.join(tmpDir, 'settings.json')
    const { loadOverrides, applyOverrides, _getOverrides } = await import('../../src/config.js')
    await loadOverrides(file)
    await applyOverrides({ compactorEnabled: false }, file)
    expect(_getOverrides().compactorEnabled).toBe(false)
    const written = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(written.compactorEnabled).toBe(false)
  })

  it('applyOverrides: merges incrementally', async () => {
    const file = path.join(tmpDir, 'settings.json')
    const { loadOverrides, applyOverrides, _getOverrides } = await import('../../src/config.js')
    await loadOverrides(file)
    await applyOverrides({ compactorEnabled: true }, file)
    await applyOverrides({ guardrailsEnabled: true }, file)
    const state = _getOverrides()
    expect(state.compactorEnabled).toBe(true)
    expect(state.guardrailsEnabled).toBe(true)
  })

  it('config.compactorEnabled: override wins over env false', async () => {
    process.env.COMPACTOR_ENABLED = 'false'
    const file = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ compactorEnabled: true }))
    const { loadOverrides, config } = await import('../../src/config.js')
    await loadOverrides(file)
    expect(config.compactorEnabled).toBe(true)
    delete process.env.COMPACTOR_ENABLED
  })

  it('config.guardrailsEnabled: env wins when no override', async () => {
    process.env.GUARDRAILS_ENABLED = 'true'
    const file = path.join(tmpDir, 'missing.json')
    const { loadOverrides, config } = await import('../../src/config.js')
    await loadOverrides(file)
    expect(config.guardrailsEnabled).toBe(true)
    delete process.env.GUARDRAILS_ENABLED
  })

  it('config.compactor.ansiStrip: override wins', async () => {
    process.env.COMPACTOR_ANSI_STRIP_ENABLED = 'true'
    const file = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ compactorAnsiStripEnabled: false }))
    const { loadOverrides, config } = await import('../../src/config.js')
    await loadOverrides(file)
    expect(config.compactor.ansiStrip).toBe(false)
    delete process.env.COMPACTOR_ANSI_STRIP_ENABLED
  })

  it('config.guardrailsSecretsMode: override wins', async () => {
    process.env.GUARDRAILS_SECRETS_MODE = 'off'
    const file = path.join(tmpDir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ guardrailsSecretsMode: 'alert' }))
    const { loadOverrides, config } = await import('../../src/config.js')
    await loadOverrides(file)
    expect(config.guardrailsSecretsMode).toBe('alert')
    delete process.env.GUARDRAILS_SECRETS_MODE
  })

  it('applyOverrides: write failure — in-memory still applied, no throw', async () => {
    const unwriteable = path.join(tmpDir, 'no', 'such', 'dir', 'settings.json')
    const { loadOverrides, applyOverrides, _getOverrides } = await import('../../src/config.js')
    await loadOverrides(path.join(tmpDir, 'missing.json'))
    // Should not throw even though the path is invalid
    await expect(applyOverrides({ compactorEnabled: true }, unwriteable)).resolves.toBeUndefined()
    // In-memory override should still be applied
    expect(_getOverrides().compactorEnabled).toBe(true)
  })
})
