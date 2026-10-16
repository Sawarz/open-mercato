/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'

const mockSearchParams = { get: jest.fn() }
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

import { useListSearchState } from '../useListSearchState'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('useListSearchState', () => {
  it('hydrates from the ?search= query param on first render', () => {
    mockSearchParams.get.mockImplementation((key: string) => (key === 'search' ? 'acme' : null))

    const { result } = renderHook(() => useListSearchState())

    expect(result.current[0]).toBe('acme')
    expect(mockSearchParams.get).toHaveBeenCalledWith('search')
  })

  it('trims the hydrated value', () => {
    mockSearchParams.get.mockReturnValue('  acme  ')

    const { result } = renderHook(() => useListSearchState())

    expect(result.current[0]).toBe('acme')
  })

  it('defaults to an empty string when the param is absent', () => {
    mockSearchParams.get.mockReturnValue(null)

    const { result } = renderHook(() => useListSearchState())

    expect(result.current[0]).toBe('')
  })

  it('defaults to an empty string when useSearchParams itself returns null', () => {
    const navigation = jest.requireMock('next/navigation') as { useSearchParams: () => unknown }
    const original = navigation.useSearchParams
    navigation.useSearchParams = () => null

    const { result } = renderHook(() => useListSearchState())

    expect(result.current[0]).toBe('')
    navigation.useSearchParams = original
  })

  it('reads a custom param name when given one', () => {
    mockSearchParams.get.mockImplementation((key: string) => (key === 'q' ? 'widgets' : null))

    const { result } = renderHook(() => useListSearchState('q'))

    expect(result.current[0]).toBe('widgets')
  })

  it('returns a setter that updates state like a normal useState, without re-reading the URL', () => {
    mockSearchParams.get.mockReturnValue('initial')

    const { result } = renderHook(() => useListSearchState())
    expect(result.current[0]).toBe('initial')

    act(() => {
      result.current[1]('typed')
    })

    expect(result.current[0]).toBe('typed')
    // Hydration only happens once, at mount — typing never re-reads the param.
    expect(mockSearchParams.get).toHaveBeenCalledTimes(1)
  })
})
