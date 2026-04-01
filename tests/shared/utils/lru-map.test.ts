import { describe, it, expect } from 'vitest'
import { LruMap } from '../../../src/shared/utils/lru-map'

describe('LruMap', () => {
  it('stores and retrieves values', () => {
    const cache = new LruMap<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBe(2)
  })

  it('returns undefined for missing keys', () => {
    const cache = new LruMap<string, number>(3)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('evicts oldest entry when exceeding max size', () => {
    const cache = new LruMap<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3) // should evict 'a'
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(2)
  })

  it('get() promotes entry to most-recently-used', () => {
    const cache = new LruMap<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a') // promote 'a'
    cache.set('c', 3) // should evict 'b' (oldest), not 'a'
    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
  })

  it('set() on existing key updates value and promotes', () => {
    const cache = new LruMap<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 10) // update + promote
    cache.set('c', 3) // should evict 'b'
    expect(cache.get('a')).toBe(10)
    expect(cache.get('b')).toBeUndefined()
  })

  it('has() returns correct boolean', () => {
    const cache = new LruMap<string, number>(2)
    cache.set('a', 1)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
  })

  it('delete() removes entry', () => {
    const cache = new LruMap<string, number>(3)
    cache.set('a', 1)
    cache.delete('a')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('clear() removes all entries', () => {
    const cache = new LruMap<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })

  it('handles numeric keys', () => {
    const cache = new LruMap<number, string>(2)
    cache.set(1, 'one')
    cache.set(2, 'two')
    cache.set(3, 'three') // evicts 1
    expect(cache.get(1)).toBeUndefined()
    expect(cache.get(2)).toBe('two')
  })

  it('values() returns all values', () => {
    const cache = new LruMap<string, number>(5)
    cache.set('a', 1)
    cache.set('b', 2)
    expect([...cache.values()]).toEqual([1, 2])
  })

  it('keys() returns all keys in insertion order', () => {
    const cache = new LruMap<string, number>(5)
    cache.set('a', 1)
    cache.set('b', 2)
    expect([...cache.keys()]).toEqual(['a', 'b'])
  })

  it('get() promotes entries with falsy values (0, false, null, empty string)', () => {
    const cache = new LruMap<string, number | null | boolean | string>(2)

    // Test with 0
    cache.set('zero', 0)
    cache.set('other', 1)
    cache.get('zero') // promote 'zero'
    cache.set('new', 2) // should evict 'other', not 'zero'
    expect(cache.get('zero')).toBe(0)
    expect(cache.get('other')).toBeUndefined()

    // Test with null
    cache.clear()
    cache.set('null-val', null)
    cache.set('other', 1)
    cache.get('null-val') // promote
    cache.set('new', 2) // evicts 'other'
    expect(cache.get('null-val')).toBeNull()
    expect(cache.get('other')).toBeUndefined()
  })
})
