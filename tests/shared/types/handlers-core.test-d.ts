/**
 * Compile-time locks for DomainHandlers and UnwrappedResult type transformers.
 */
import { describe, it, expectTypeOf } from 'vitest'
import type { IpcResult } from '../../../src/shared/types/errors'
import type { TranscriptsDomainContract } from '../../../src/shared/ipc/domains/transcripts'
import type { TranscriptAnnotation } from '../../../src/shared/types/transcript'
import type { DomainHandlers, UnwrappedResult } from '../../../src/shared/types/handler-core'

describe('DomainHandlers and UnwrappedResult compile-time type verification', () => {
  it('unwraps Promise<IpcResult<T>> to Promise<T>', () => {
    expectTypeOf<UnwrappedResult<Promise<IpcResult<string>>>>().toEqualTypeOf<Promise<string>>()
    expectTypeOf<UnwrappedResult<Promise<IpcResult<TranscriptAnnotation[]>>>>().toEqualTypeOf<
      Promise<TranscriptAnnotation[]>
    >()
  })

  it('unwraps synchronous IpcResult<T> to T', () => {
    expectTypeOf<UnwrappedResult<IpcResult<string>>>().toEqualTypeOf<string>()
  })

  it('preserves synchronous functions and event subscriptions without wrapping in Promise', () => {
    type Unsubscribe = () => void
    expectTypeOf<UnwrappedResult<Unsubscribe>>().toEqualTypeOf<Unsubscribe>()
    expectTypeOf<UnwrappedResult<(cb: (event: string) => void) => Unsubscribe>>().toEqualTypeOf<
      (cb: (event: string) => void) => Unsubscribe
    >()
  })

  it('transforms domain contracts into unwrapped handler signatures', () => {
    type Handlers = DomainHandlers<TranscriptsDomainContract>
    expectTypeOf<ReturnType<Handlers['list']>>().toEqualTypeOf<Promise<TranscriptAnnotation[]>>()
    expectTypeOf<ReturnType<Handlers['switch']>>().toEqualTypeOf<Promise<{ success: boolean }>>()
    expectTypeOf<ReturnType<Handlers['insertAndSwitch']>>().toEqualTypeOf<
      Promise<{ success: boolean }>
    >()
  })
})
