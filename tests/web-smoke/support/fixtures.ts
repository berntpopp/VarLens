export type ImportBuffer = ReturnType<(typeof Cypress.Buffer)['from']>
export type ImportSelectFile =
  string | { contents: ImportBuffer; fileName: string; mimeType?: string }

const SAMPLE_VCF_GZ_BASE64 =
  'H4sIAAAAAAAAE3XOUWuDMBDA8efzU5T6Wmxix8ZgKQSrTtBqTdbX4lxaAjVxiS0I+fDDlsEY29' +
  'txcP/f+f5RnsVRm64ZyD5Krg9B6Pl+tk1K8pJtSMR2i+2lexeGBAs+9oKwwUh1WmyEbY3sB6kV' +
  'mUdaWfF5EaoVs0YpPTTT3s6ORnezfVzN157vJ2VdUH6rpvw7iv+PpkLpYezFdBy91mUBVckg20' +
  'AdJ0BzDrs3mkOS5TyuYXoY7gIwWlR57GHACEEAFNLbVFHGIGI70klrhbLicG2MbNTgnOMx425b' +
  'HBDCAXa90YOQ6tDqD6lOzrk2wAjRder6IB/takXNCVIOaIm9EMKbEgGH5x+IHZVWY6cv9hcT3p' +
  '3wbydEKFpz1wf03Dw+kUnBS+x9AUNXnnunAQAA'

const JSON_GZ_BASE64 =
  'H4sIAAAAAAAAExXK0QqCMBiA0Xf5roeoFcV/FyVBUEJ5VYSsOSvQrZwFIb57dK7PwEd3D+36gJ' +
  'wHzL1DSFA8fUBm00maKDpbI6xQ6KZHKFDcrLNl+LZX3yBsTttjvkdhvAv29bbOWIRdvs4OyyL7' +
  'f+dbXZW6RuIojlOF0VWFJItoPl7GH337eGSIAAAA'

export const sampleVcfPath = 'tests/web-smoke/fixtures/varlens/sample.vcf'
export const bedRegionPath = 'tests/web-smoke/fixtures/varlens/regions.bed'

export function uniqueSmokeName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Cypress._.random(1000, 9999)}`
}

export function jsonImportFile(fileName: string, geneSymbol: string): ImportSelectFile {
  return {
    fileName,
    mimeType: 'application/json',
    contents: Cypress.Buffer.from(
      JSON.stringify({
        variants: [
          {
            chr: '1',
            pos: 12345,
            ref: 'A',
            alt: 'G',
            gene_symbol: geneSymbol,
            consequence: 'HIGH',
            gnomad_af: 0.001,
            cadd: 25.3
          }
        ]
      })
    )
  }
}

export function gzipJsonImportFile(fileName: string): ImportSelectFile {
  return {
    fileName,
    mimeType: 'application/gzip',
    contents: Cypress.Buffer.from(JSON_GZ_BASE64, 'base64')
  }
}

export function gzipSampleVcfImportFile(fileName: string): ImportSelectFile {
  return {
    fileName,
    mimeType: 'application/gzip',
    contents: Cypress.Buffer.from(SAMPLE_VCF_GZ_BASE64, 'base64')
  }
}

export function zipImportFile(caseName: string): ImportSelectFile {
  return {
    fileName: `${caseName}.zip`,
    mimeType: 'application/zip',
    contents: storedZipFile(
      `${caseName}.json`,
      JSON.stringify({
        variants: [
          {
            chr: '3',
            pos: 333,
            ref: 'C',
            alt: 'T',
            gene_symbol: 'ZIPGENE',
            consequence: 'MODERATE'
          }
        ]
      })
    )
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZipFile(fileName: string, contents: string): ImportBuffer {
  const nameBytes = Cypress.Buffer.from(fileName)
  const fileBytes = Cypress.Buffer.from(contents)
  const checksum = crc32(fileBytes)
  const localHeader = Cypress.Buffer.alloc(30 + nameBytes.length)
  const centralHeader = Cypress.Buffer.alloc(46 + nameBytes.length)
  const endRecord = Cypress.Buffer.alloc(22)

  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt32LE(checksum, 14)
  localHeader.writeUInt32LE(fileBytes.length, 18)
  localHeader.writeUInt32LE(fileBytes.length, 22)
  localHeader.writeUInt16LE(nameBytes.length, 26)
  nameBytes.copy(localHeader, 30)

  const centralOffset = localHeader.length + fileBytes.length
  centralHeader.writeUInt32LE(0x02014b50, 0)
  centralHeader.writeUInt16LE(20, 4)
  centralHeader.writeUInt16LE(20, 6)
  centralHeader.writeUInt32LE(checksum, 16)
  centralHeader.writeUInt32LE(fileBytes.length, 20)
  centralHeader.writeUInt32LE(fileBytes.length, 24)
  centralHeader.writeUInt16LE(nameBytes.length, 28)
  nameBytes.copy(centralHeader, 46)

  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(1, 8)
  endRecord.writeUInt16LE(1, 10)
  endRecord.writeUInt32LE(centralHeader.length, 12)
  endRecord.writeUInt32LE(centralOffset, 16)

  return Cypress.Buffer.concat([localHeader, fileBytes, centralHeader, endRecord])
}
