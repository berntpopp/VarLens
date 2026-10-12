/** SVG / PNG export of a rendered plot (lollipop, gene structure). */

/**
 * The plot as a standalone SVG document. Theme colours are CSS variables
 * (`rgb(var(--v-theme-…))`) that an SVG file or the PNG canvas cannot
 * resolve, so each is replaced by its computed value first.
 */
export function svgMarkup(svg: SVGSVGElement | null): string {
  if (svg === null) return ''
  const style = getComputedStyle(svg)
  const markup = new XMLSerializer()
    .serializeToString(svg)
    .replace(/var\((--v-theme-[a-z0-9-]+)\)/gi, (whole, name: string) => {
      const value = style.getPropertyValue(name).trim()
      return value === '' ? whole : value
    })
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`
}

/** The SVG drawn on a white canvas at 2× for high-DPI screens. */
export function svgToPng(
  svg: SVGSVGElement | null,
  width: number,
  height: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (svg === null || ctx === null) {
      resolve(null)
      return
    }
    canvas.width = width * 2
    canvas.height = height * 2
    ctx.scale(2, 2)
    const blob = new Blob([svgMarkup(svg)], {
      type: 'image/svg+xml;charset=utf-8'
    })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      canvas.toBlob((png) => resolve(png), 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}
