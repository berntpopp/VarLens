import { BaseRepository } from './BaseRepository'
import type { TranscriptAnnotation, TranscriptInsertRow } from '../../shared/types/transcript'

export class TranscriptRepository extends BaseRepository {
  getVariantTranscripts(variantId: number): TranscriptAnnotation[] {
    const rows = this.execAll<{
      id: number
      variant_id: number
      transcript_id: string
      gene_symbol: string | null
      consequence: string | null
      cdna: string | null
      aa_change: string | null
      hpo_sim_score: number | null
      moi: string | null
      is_selected: number
      is_mane_select: number | null
      is_canonical: number | null
    }>(
      this.kysely
        .selectFrom('variant_transcripts')
        .select([
          'id',
          'variant_id',
          'transcript_id',
          'gene_symbol',
          'consequence',
          'cdna',
          'aa_change',
          'hpo_sim_score',
          'moi',
          'is_selected',
          'is_mane_select',
          'is_canonical'
        ])
        .where('variant_id', '=', variantId)
        .orderBy('is_selected', 'desc')
        .orderBy('transcript_id', 'asc')
    )

    return rows.map((r) => ({
      ...r,
      is_selected: r.is_selected === 1,
      is_mane_select: r.is_mane_select === null ? null : r.is_mane_select === 1,
      is_canonical: r.is_canonical === null ? null : r.is_canonical === 1
    }))
  }

  switchSelectedTranscript(variantId: number, transcriptId: string): void {
    const switchTx = this.db.transaction(() => {
      this.stmt('UPDATE variant_transcripts SET is_selected = 0 WHERE variant_id = ?').run(
        variantId
      )

      const result = this.stmt(
        'UPDATE variant_transcripts SET is_selected = 1 WHERE variant_id = ? AND transcript_id = ?'
      ).run(variantId, transcriptId)

      if (result.changes === 0) {
        throw new Error(`Transcript ${transcriptId} not found for variant ${variantId}`)
      }

      const transcript = this.stmt(
        'SELECT gene_symbol, consequence, cdna, aa_change, hpo_sim_score, moi FROM variant_transcripts WHERE variant_id = ? AND transcript_id = ?'
      ).get(variantId, transcriptId) as {
        gene_symbol: string | null
        consequence: string | null
        cdna: string | null
        aa_change: string | null
        hpo_sim_score: number | null
        moi: string | null
      }

      this.stmt(
        `
        UPDATE variants
        SET transcript = ?, gene_symbol = ?, consequence = ?, cdna = ?, aa_change = ?, hpo_sim_score = ?, moi = ?
        WHERE id = ?
      `
      ).run(
        transcriptId,
        transcript.gene_symbol,
        transcript.consequence,
        transcript.cdna,
        transcript.aa_change,
        transcript.hpo_sim_score,
        transcript.moi,
        variantId
      )
    })

    switchTx()
  }

  insertTranscriptAndSwitch(variantId: number, transcript: TranscriptInsertRow): void {
    const tx = this.db.transaction(() => {
      this.stmt(
        `INSERT OR IGNORE INTO variant_transcripts
           (variant_id, transcript_id, gene_symbol, consequence, cdna, aa_change, hpo_sim_score, moi, is_selected)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
      ).run(
        variantId,
        transcript.transcript_id,
        transcript.gene_symbol,
        transcript.consequence,
        transcript.cdna,
        transcript.aa_change,
        transcript.hpo_sim_score,
        transcript.moi
      )

      this.switchSelectedTranscript(variantId, transcript.transcript_id)
    })

    tx()
  }
}
