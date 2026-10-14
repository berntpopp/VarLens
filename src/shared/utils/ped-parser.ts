/**
 * Parser for 6-column PED (pedigree) files:
 *   family  individual  father  mother  sex  phenotype
 * Columns are whitespace separated (tabs or spaces). Lines starting with `#` and blank
 * lines are ignored; columns after the sixth (linkage genotypes) are ignored.
 * Missing parents are `0`; sex is 1=male, 2=female, 0=unknown; phenotype is
 * 1=unaffected, 2=affected, 0 or -9=unknown.
 */

export type PedSex = 'male' | 'female' | 'unknown'
export type PedPhenotype = 'affected' | 'unaffected' | 'unknown'
export type PedRole = 'proband' | 'father' | 'mother' | 'sibling' | 'other'

export interface PedIndividual {
  familyId: string
  individualId: string
  fatherId: string | null
  motherId: string | null
  sex: PedSex
  phenotype: PedPhenotype
  line: number
}

export interface PedError {
  line: number
  message: string
}

export interface PedParseResult {
  individuals: PedIndividual[]
  errors: PedError[]
}

const SEX_CODES: Record<string, PedSex> = { '0': 'unknown', '1': 'male', '2': 'female' }
const PHENOTYPE_CODES: Record<string, PedPhenotype> = {
  '0': 'unknown',
  '-9': 'unknown',
  '1': 'unaffected',
  '2': 'affected'
}

const parentId = (value: string): string | null => (value === '0' ? null : value)

export function parsePed(text: string): PedParseResult {
  const individuals: PedIndividual[] = []
  const errors: PedError[] = []

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return
    const cols = trimmed.split(/\s+/)
    if (cols.length < 6) {
      errors.push({ line, message: `expected 6 columns, found ${cols.length}` })
      return
    }
    const [familyId, individualId, father, mother, sexCode, phenoCode] = cols
    const sex = SEX_CODES[sexCode]
    const phenotype = PHENOTYPE_CODES[phenoCode]
    if (individualId === '0') errors.push({ line, message: 'individual ID must not be 0' })
    if (!sex) errors.push({ line, message: `invalid sex "${sexCode}" (use 0, 1 or 2)` })
    if (!phenotype) {
      errors.push({ line, message: `invalid phenotype "${phenoCode}" (use 0, -9, 1 or 2)` })
    }
    if (father === individualId || mother === individualId) {
      errors.push({ line, message: `${individualId} is listed as its own parent` })
    }
    if (individualId === '0' || !sex || !phenotype) return
    const duplicate = individuals.find(
      (i) => i.familyId === familyId && i.individualId === individualId
    )
    if (duplicate) {
      errors.push({
        line,
        message: `duplicate individual ${individualId} in family ${familyId} (first on line ${duplicate.line})`
      })
      return
    }
    individuals.push({
      familyId,
      individualId,
      fatherId: parentId(father),
      motherId: parentId(mother),
      sex,
      phenotype,
      line
    })
  })

  for (const child of individuals) {
    const check = (id: string | null, expected: PedSex, label: string): void => {
      const parent =
        id === null
          ? undefined
          : individuals.find((i) => i.familyId === child.familyId && i.individualId === id)
      if (parent && parent.sex !== 'unknown' && parent.sex !== expected) {
        errors.push({
          line: child.line,
          message: `${label} ${id} of ${child.individualId} has sex ${parent.sex}`
        })
      }
    }
    check(child.fatherId, 'male', 'father')
    check(child.motherId, 'female', 'mother')
  }

  errors.sort((a, b) => a.line - b.line)
  return { individuals, errors }
}

/** Distinct family IDs in file order. */
export function pedFamilies(individuals: PedIndividual[]): string[] {
  return [...new Set(individuals.map((i) => i.familyId))]
}

/**
 * Assign analysis-group roles within one family. The proband is the first affected
 * individual with a parent in the family (else the first affected, else the first
 * child, else the first listed); its parents become father/mother, individuals sharing
 * a parent with it become siblings, everyone else is `other`.
 */
export function derivePedRoles(family: PedIndividual[]): Map<string, PedRole> {
  const ids = new Set(family.map((i) => i.individualId))
  const hasParent = (i: PedIndividual): boolean =>
    (i.fatherId !== null && ids.has(i.fatherId)) || (i.motherId !== null && ids.has(i.motherId))
  const affected = family.filter((i) => i.phenotype === 'affected')
  const proband = affected.find(hasParent) ?? affected[0] ?? family.find(hasParent) ?? family[0]

  const roles = new Map<string, PedRole>()
  for (const ind of family) {
    let role: PedRole = 'other'
    if (ind === proband) role = 'proband'
    else if (ind.individualId === proband.fatherId) role = 'father'
    else if (ind.individualId === proband.motherId) role = 'mother'
    else if (
      (ind.fatherId !== null && ind.fatherId === proband.fatherId) ||
      (ind.motherId !== null && ind.motherId === proband.motherId)
    ) {
      role = 'sibling'
    }
    roles.set(ind.individualId, role)
  }
  return roles
}
