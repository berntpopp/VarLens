/**
 * Parser for PLINK PED format (6-column pedigree files).
 *
 * Format: Family_ID  Individual_ID  Paternal_ID  Maternal_ID  Sex  Phenotype
 * Sex: 1=male, 2=female, 0=unknown
 * Phenotype: 1=unaffected, 2=affected, 0/-9=unknown
 */

export interface PedEntry {
  familyId: string
  individualId: string
  paternalId: string | null
  maternalId: string | null
  sex: 'male' | 'female' | 'unknown'
  affectedStatus: 'affected' | 'unaffected' | 'unknown'
}

function parseSex(value: string): PedEntry['sex'] {
  switch (value) {
    case '1':
      return 'male'
    case '2':
      return 'female'
    default:
      return 'unknown'
  }
}

function parsePhenotype(value: string): PedEntry['affectedStatus'] {
  switch (value) {
    case '2':
      return 'affected'
    case '1':
      return 'unaffected'
    default:
      return 'unknown'
  }
}

export function parsePedFile(content: string): PedEntry[] {
  const entries: PedEntry[] = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const fields = trimmed.split(/\t/)
    if (fields.length < 6) continue

    entries.push({
      familyId: fields[0],
      individualId: fields[1],
      paternalId: fields[2] === '0' ? null : fields[2],
      maternalId: fields[3] === '0' ? null : fields[3],
      sex: parseSex(fields[4]),
      affectedStatus: parsePhenotype(fields[5])
    })
  }

  return entries
}
