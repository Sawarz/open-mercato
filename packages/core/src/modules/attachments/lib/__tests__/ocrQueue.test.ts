import type { EntityManager } from '@mikro-orm/postgresql'
import {
  getOcrConcurrencyStateForTests,
  requestOcrProcessing,
  resetOcrConcurrencyStateForTests,
  withOcrConcurrencySlot,
} from '../ocrQueue'
import type { Attachment } from '../../data/entities'
import type { StorageDriver } from '../drivers/types'

const makeAttachment = (): Attachment =>
  ({
    id: 'attachment-1',
    mimeType: 'application/pdf',
    partitionCode: 'docs',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
  }) as unknown as Attachment

const driver = {} as StorageDriver

describe('requestOcrProcessing EntityManager isolation', () => {
  let setImmediateSpy: jest.SpyInstance

  beforeEach(() => {
    resetOcrConcurrencyStateForTests()
    setImmediateSpy = jest.spyOn(global, 'setImmediate').mockImplementation((() => undefined) as never)
  })

  afterEach(() => {
    setImmediateSpy.mockRestore()
    resetOcrConcurrencyStateForTests()
  })

  it('forks the EntityManager for the background worker instead of reusing the request EM', async () => {
    const forkedEm = { id: 'forked' } as unknown as EntityManager
    const fork = jest.fn(() => forkedEm)
    const requestEm = { fork } as unknown as EntityManager

    await requestOcrProcessing(requestEm, makeAttachment(), driver, 'docs/attachment-1.pdf')

    expect(fork).toHaveBeenCalledTimes(1)
    expect(setImmediateSpy).toHaveBeenCalledTimes(1)
  })

  it('throws loudly when the EntityManager cannot fork instead of silently reusing it', async () => {
    const requestEm = {} as unknown as EntityManager

    await expect(
      requestOcrProcessing(requestEm, makeAttachment(), driver, 'docs/attachment-1.pdf'),
    ).rejects.toThrow(/requires an EntityManager that exposes fork/)

    expect(setImmediateSpy).not.toHaveBeenCalled()
  })
})

describe('withOcrConcurrencySlot', () => {
  const previousConcurrency = process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY

  beforeEach(() => {
    resetOcrConcurrencyStateForTests()
    process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY = '1'
  })

  afterEach(() => {
    if (previousConcurrency === undefined) delete process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY
    else process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY = previousConcurrency
    resetOcrConcurrencyStateForTests()
  })

  it('holds excess work until an active slot frees', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withOcrConcurrencySlot(async () => {
      await firstGate
      return 'first'
    })

    // Let the first slot become active before queuing the second.
    await Promise.resolve()
    expect(getOcrConcurrencyStateForTests()).toEqual({ active: 1, waiting: 0 })

    let secondStarted = false
    const second = withOcrConcurrencySlot(async () => {
      secondStarted = true
      return 'second'
    })

    await Promise.resolve()
    expect(secondStarted).toBe(false)
    expect(getOcrConcurrencyStateForTests()).toEqual({ active: 1, waiting: 1 })

    releaseFirst()
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
    expect(secondStarted).toBe(true)
    expect(getOcrConcurrencyStateForTests()).toEqual({ active: 0, waiting: 0 })
  })

  it('never exceeds the concurrency cap with 3 simultaneous jobs (cap=1)', async () => {
    const maxObservedActive: number[] = []
    let releaseA!: () => void
    let releaseB!: () => void
    let releaseC!: () => void
    const gateA = new Promise<void>((r) => { releaseA = r })
    const gateB = new Promise<void>((r) => { releaseB = r })
    const gateC = new Promise<void>((r) => { releaseC = r })

    const track = () => maxObservedActive.push(getOcrConcurrencyStateForTests().active)

    const jobA = withOcrConcurrencySlot(async () => { track(); await gateA; return 'a' })
    const jobB = withOcrConcurrencySlot(async () => { track(); await gateB; return 'b' })
    const jobC = withOcrConcurrencySlot(async () => { track(); await gateC; return 'c' })

    // Drain microtask queue so all three have attempted entry.
    for (let i = 0; i < 5; i++) await Promise.resolve()

    releaseA()
    await jobA
    releaseB()
    await jobB
    releaseC()
    await jobC

    expect(maxObservedActive.every((n) => n <= 1)).toBe(true)
    expect(getOcrConcurrencyStateForTests()).toEqual({ active: 0, waiting: 0 })
  })
})
