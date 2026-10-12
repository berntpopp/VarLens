/** SVG / PNG export of a rendered plot (lollipop, gene structure). */

export function svgMarkup(svg: SVGSVGElement | null): string {
  if (svg === null) return ''
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`
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
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
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
