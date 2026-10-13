/**
 * PG 0035 normalises stored builds with an alias list written into its SQL;
 * SQLite v52 reads the same data from genome-builds.config.ts. They must agree.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  GENOME_BUILDS,
  canonicalGenomeBuildId,
  genomeBuildAliasPairs
} from '../../../src/shared/config/genome-builds.config'

const SQL = readFileSync(
  resolve(
    __dirname,
    '../../../src/main/storage/postgres/migrations/sql/0035_annotation_genome_build.sql'
  ),
  'utf8'
)

describe('stored genome build normalisation (#577)', () => {
  it('0035 maps exactly the aliases of the config', () => {
    const values = SQL.slice(
      SQL.indexOf('WITH aliases(alias, id) AS (VALUES'),
      SQL.indexOf('renamed AS (')
    )
    const pairs = [...values.matchAll(/\('([^']+)', '([^']+)'\)/g)].map((m) => [m[1], m[2]])
    expect(pairs).toEqual(genomeBuildAliasPairs())
  })

  it('0035 flags exactly the values that are no build id', () => {
    const ids = /NOT IN \(('[^)]*)\)/
      .exec(SQL)?.[1]
      .split(', ')
      .map((id) => id.slice(1, -1))
    expect(ids?.sort()).toEqual(GENOME_BUILDS.map((b) => b.id).sort())
  })

  it('no alias names two builds', () => {
    for (const build of GENOME_BUILDS) {
      for (const alias of [build.id.toLowerCase(), ...build.aliases]) {
        expect(canonicalGenomeBuildId(alias)).toBe(build.id)
      }
    }
  })

  it('resolves case, whitespace and patch suffixes; unknown stays null', () => {
    expect(canonicalGenomeBuildId('hg19')).toBe('GRCh37')
    expect(canonicalGenomeBuildId(' GRCh37.p13 ')).toBe('GRCh37')
    expect(canonicalGenomeBuildId('HG38')).toBe('GRCh38')
    expect(canonicalGenomeBuildId('my-build')).toBeNull()
  })
})
