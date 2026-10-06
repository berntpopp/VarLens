/**
 * Black or white, whichever has the higher WCAG contrast on a `#rrggbb`
 * fill. Used for chips filled with a data colour (consequence / ClinVar
 * palettes), where a fixed white label fails contrast on light fills.
 */
export function readableTextOn(hex: string): '#fff' | '#000' {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (match === null) return '#fff'
  const channel = (offset: number): number => {
    const c = parseInt(match[1].slice(offset, offset + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
  // Contrast with white is 1.05 / (L + 0.05); with black (L + 0.05) / 0.05.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#fff' : '#000'
}
