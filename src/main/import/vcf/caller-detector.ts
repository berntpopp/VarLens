import type { VariantType, ImportFilters } from './import-filters'

export interface CallerInfo {
  name: string
  version: string | null
  defaultVariantType: VariantType
  defaultFilters: Partial<ImportFilters>
}

interface CallerPattern {
  pattern: RegExp
  name: string
  defaultVariantType: VariantType
  defaultFilters: Partial<ImportFilters>
}

const CALLER_PATTERNS: CallerPattern[] = [
  {
    pattern: /[Ss]niffles2?[_ ]?([\d.]+)?/,
    name: 'Sniffles2',
    defaultVariantType: 'sv',
    defaultFilters: { passOnly: true }
  },
  {
    pattern: /Spectre/i,
    name: 'Spectre',
    defaultVariantType: 'cnv',
    defaultFilters: { passOnly: false }
  },
  {
    pattern: /strglr[_ ]?([\d.]+)?/i,
    name: 'Straglr',
    defaultVariantType: 'str',
    defaultFilters: { passOnly: true }
  },
  {
    pattern: /Clair3[_ ]?([\d.]+)?/i,
    name: 'Clair3',
    defaultVariantType: 'snv',
    defaultFilters: { passOnly: true, minQual: 2 }
  },
  {
    pattern: /DeepVariant[_ ]?([\d.]+)?/i,
    name: 'DeepVariant',
    defaultVariantType: 'snv',
    defaultFilters: { passOnly: true }
  },
  {
    pattern: /DRAGEN[_ ]?([\d.]+)?/i,
    name: 'DRAGEN',
    defaultVariantType: 'snv',
    defaultFilters: { passOnly: true }
  },
  {
    pattern: /Manta[_ ]?([\d.]+)?/i,
    name: 'Manta',
    defaultVariantType: 'sv',
    defaultFilters: { passOnly: true }
  },
  {
    pattern: /ExpansionHunter[_ ]?([\d.]+)?/i,
    name: 'ExpansionHunter',
    defaultVariantType: 'str',
    defaultFilters: { passOnly: false }
  }
]

const UNKNOWN_CALLER: CallerInfo = {
  name: 'unknown',
  version: null,
  defaultVariantType: 'snv',
  defaultFilters: { passOnly: false }
}

/**
 * Detect variant caller from VCF header lines.
 * Checks ##source= first, then ##command= as fallback.
 */
export function detectCaller(headerLines: string[]): CallerInfo {
  for (const line of headerLines) {
    if (line.startsWith('##source=') || line.startsWith('##command=')) {
      const value = line.split('=', 2)[1]
      for (const cp of CALLER_PATTERNS) {
        const match = value.match(cp.pattern)
        if (match) {
          return {
            name: cp.name,
            version: match[1] ?? null,
            defaultVariantType: cp.defaultVariantType,
            defaultFilters: cp.defaultFilters
          }
        }
      }
    }
  }

  return UNKNOWN_CALLER
}
