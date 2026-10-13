/**
 * Audit-log key of a global annotation. Since global annotations are keyed by
 * genome build (#577) the key carries it (`chr:pos:ref:alt@GRCh38`); entries
 * written before have the build-less key and applied to every build.
 */
export function globalAnnotationEntityKey(
  coords: { chr: string; pos: number; ref: string; alt: string },
  build?: string | null
): string {
  const locus = `${coords.chr}:${coords.pos}:${coords.ref}:${coords.alt}`
  return build === undefined || build === null ? locus : `${locus}@${build}`
}
