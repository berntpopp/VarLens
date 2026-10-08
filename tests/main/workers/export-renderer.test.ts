import { describe, it, expect } from 'vitest'
import { formatCellValue, csvEscape } from '../../../src/main/workers/export-renderer'

describe('formatCellValue', () => {
  it('formats gnomAD AF in exponential notation', () => {
    expect(formatCellValue('gnomad_af', 0.001)).toBe('1.00e-3')
  })
  it('formats CADD as fixed 2-decimal', () => {
    expect(formatCellValue('cadd', 25.123)).toBe('25.12')
  })
  it('formats hpo_sim_score as fixed 4-decimal', () => {
    expect(formatCellValue('hpo_sim_score', 0.87654)).toBe('0.8765')
  })
  it('returns string for other columns', () => {
    expect(formatCellValue('gene_symbol', 'BRCA1')).toBe('BRCA1')
  })
  it('returns empty string for null', () => {
    expect(formatCellValue('gene_symbol', null)).toBe('')
  })
  it('returns empty string for undefined', () => {
    expect(formatCellValue('gene_symbol', undefined)).toBe('')
  })
  it('passes through number for non-special columns', () => {
    expect(formatCellValue('qual', 42)).toBe(42)
  })
})

describe('csvEscape', () => {
  it('wraps values containing commas in quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
  })
  it('escapes double quotes by doubling them', () => {
    expect(csvEscape('a"b')).toBe('"a""b"')
  })
  it('passes through simple values unchanged', () => {
    expect(csvEscape('BRCA1')).toBe('BRCA1')
  })
  it('wraps values containing newlines', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"')
  })
  it('wraps values containing carriage returns', () => {
    expect(csvEscape('a\rb')).toBe('"a\rb"')
  })
  it('returns empty string for null', () => {
    expect(csvEscape(null)).toBe('')
  })
  it('converts numbers to strings', () => {
    expect(csvEscape(42)).toBe('42')
  })
  it.each([
    ['=HYPERLINK("http://x","y")', '"\'=HYPERLINK(""http://x"",""y"")"'],
    ['@SUM(1+1)', "'@SUM(1+1)"],
    ['+cmd', "'+cmd"],
    ["-2+3+cmd|' /C calc'!A0", "'-2+3+cmd|' /C calc'!A0"],
    ['\t=1+1', "'\t=1+1"],
    ['\r=1+1', '"\'\r=1+1"']
  ])('neutralises the spreadsheet formula %j (#487)', (input, expected) => {
    expect(csvEscape(input)).toBe(expected)
  })
  it.each(['-', '+', '-1.50', '+3', '-1.23e-4', 'c.-5C>T', '0/1', '<DEL>'])(
    'leaves the inert value %j unchanged',
    (value) => {
      expect(csvEscape(value)).toBe(value)
    }
  )
  it('leaves negative numbers unchanged', () => {
    expect(csvEscape(-3.5)).toBe('-3.5')
  })
})
