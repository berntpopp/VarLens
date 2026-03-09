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
    this.runTransaction(() => {
      this.execRun(
        this.kysely
          .updateTable('variant_transcripts')
          .set({ is_selected: 0 })
          .where('variant_id', '=', variantId)
      )

      const result = this.execRun(
        this.kysely
          .updateTable('variant_transcripts')
          .set({ is_selected: 1 })
          .where('variant_id', '=', variantId)
          .where('transcript_id', '=', transcriptId)
      )

      if (result.changes === 0) {
        throw new Error(`Transcript ${transcriptId} not found for variant ${variantId}`)
      }

      const transcript = this.execFirst<{
        gene_symbol: string | null
        consequence: string | null
        cdna: string | null
        aa_change: string | null
        hpo_sim_score: number | null
        moi: string | null
      }>(
        this.kysely
          .selectFrom('variant_transcripts')
          .select(['gene_symbol', 'consequence', 'cdna', 'aa_change', 'hpo_sim_score', 'moi'])
          .where('variant_id', '=', variantId)
          .where('transcript_id', '=', transcriptId)
      )!

      this.execRun(
        this.kysely
          .updateTable('variants')
          .set({
            transcript: transcriptId,
            gene_symbol: transcript.gene_symbol,
            consequence: transcript.consequence,
            cdna: transcript.cdna,
            aa_change: transcript.aa_change,
            hpo_sim_score: transcript.hpo_sim_score,
            moi: transcript.moi
          })
          .where('id', '=', variantId)
      )
    })
  }

  insertTranscriptAndSwitch(variantId: number, transcript: TranscriptInsertRow): void {
    this.runTransaction(() => {
      this.execRun(
        this.kysely
          .insertInto('variant_transcripts')
          .values({
            variant_id: variantId,
            transcript_id: transcript.transcript_id,
            gene_symbol: transcript.gene_symbol,
            consequence: transcript.consequence,
            cdna: transcript.cdna,
            aa_change: transcript.aa_change,
            hpo_sim_score: transcript.hpo_sim_score,
            moi: transcript.moi,
            is_selected: 0
          })
          .onConflict((oc) => oc.doNothing())
      )

      this.switchSelectedTranscript(variantId, transcript.transcript_id)
    })
  }
}
