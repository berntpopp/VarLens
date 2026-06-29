/**
 * Parse a VCF INFO column into key/value pairs.
 *
 * Flag fields are represented with an empty string value.
 */
export function parseVcfInfo(info: string): Map<string, string> {
  const parsed = new Map<string, string>()
  if (info === '.' || info === '') return parsed

  for (const token of info.split(';')) {
    if (token === '' || token === '.') continue

    const equalsIndex = token.indexOf('=')
    if (equalsIndex === -1) {
      parsed.set(token, '')
    } else {
      parsed.set(token.substring(0, equalsIndex), token.substring(equalsIndex + 1))
    }
  }

  return parsed
}
