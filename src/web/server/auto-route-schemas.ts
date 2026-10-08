/**
 * Argument schemas of the dispatcher's executor auto-routes (issue #514).
 *
 * An auto-route passes the request `args` to the storage executor as the task
 * `params`, so each schema is the tuple of that method's arguments, built from
 * the schemas the desktop IPC handlers validate with. The dispatcher parses
 * with it, answers 400 on a mismatch and does not serve an auto-route that has
 * no entry; tests/web-gate/auto-route-schemas.test.ts fails on a missing one.
 * Methods served by an override validate in their own route file.
 */
import { z } from 'zod'

import { VariantKeysSchema } from '../../shared/api/schemas/annotations'
import { CaseCommentInvokeBodySchemas } from '../../shared/api/schemas/case-comments'
import {
  CaseSetCohortsSchema,
  CohortNameSchema,
  CohortUpdateSchema,
  DataInfoUpsertSchema,
  ExternalIdUpsertSchema,
  HpoTermAssignSchema,
  MetadataUpsertSchema
} from '../../shared/api/schemas/case-metadata'
import { CaseMetricInvokeBodySchemas } from '../../shared/api/schemas/case-metrics'
import { TagsInvokeBodySchemas, VariantTagSetSchema } from '../../shared/api/schemas/tags'
import { VariantSearchQuerySchema } from '../../shared/api/schemas/variants'
import {
  AnalysisGroupUpdateSchema,
  FilterPresetCreateSchema,
  FilterPresetReorderSchema,
  FilterPresetUpdateSchema,
  GeneListCreateSchema,
  GetShortlistParamsSchema,
  LimitSchema,
  PanelActivateSchema,
  PanelDuplicateSchema,
  PanelGenesSchema,
  RegionFileCreateSchema,
  TypesPresentPayloadSchema
} from '../../shared/types/ipc-schemas'

// Every id schema of the desktop handlers (case, cohort, tag, panel, ...) is this one.
const id = z.number().int().positive()
const none = z.tuple([])
const oneId = z.tuple([id])
const twoIds = z.tuple([id, id])

// Web-only bound for id / key lists the desktop schemas leave open.
const MAX_LIST = 10_000

/** An optional trailing argument: absent, or `null` after JSON, means `fallback`. */
function orDefault<T extends z.ZodType>(schema: T, fallback: z.output<T>) {
  return schema.nullish().transform((value) => value ?? fallback)
}

export const AUTO_ROUTE_ARG_SCHEMAS: Readonly<Record<string, z.ZodType<unknown[]>>> = {
  'cases:availableBuilds': none,

  'case-metadata:get': oneId,
  'case-metadata:listCohorts': none,
  'case-metadata:getCohortByName': z.tuple([CohortNameSchema]),
  'case-metadata:getCaseCohorts': oneId,
  'case-metadata:getHpoTerms': oneId,
  'case-metadata:getDataInfo': oneId,
  'case-metadata:listExternalIds': oneId,
  'case-metadata:distinctHpoTerms': none,
  'case-metadata:distinctPlatforms': none,
  'case-metadata:distinctExternalIdTypes': none,
  'case-metadata:getFullMetadata': oneId,
  'case-metadata:upsert': z.tuple([id, MetadataUpsertSchema]),
  'case-metadata:updateCohort': z.tuple([id, CohortUpdateSchema]),
  'case-metadata:deleteCohort': oneId,
  'case-metadata:assignCohort': twoIds,
  'case-metadata:removeCohort': twoIds,
  'case-metadata:setCohorts': z.tuple([id, CaseSetCohortsSchema.shape.cohortIds.max(MAX_LIST)]),
  'case-metadata:assignHpoTerm': z.tuple([
    id,
    HpoTermAssignSchema.shape.hpoId,
    HpoTermAssignSchema.shape.hpoLabel
  ]),
  'case-metadata:removeHpoTerm': z.tuple([id, HpoTermAssignSchema.shape.hpoId]),
  'case-metadata:upsertDataInfo': z.tuple([id, DataInfoUpsertSchema]),
  'case-metadata:upsertExternalId': z.tuple([
    id,
    ExternalIdUpsertSchema.shape.idType,
    ExternalIdUpsertSchema.shape.idValue
  ]),
  'case-metadata:deleteExternalId': z.tuple([id, ExternalIdUpsertSchema.shape.idType]),

  'variants:typeCounts': oneId,
  'variants:typesPresent': z.tuple([TypesPresentPayloadSchema]),
  'variants:geneSymbols': z.tuple([id, VariantSearchQuerySchema, orDefault(LimitSchema, 50)]),
  'variants:shortlist': z.tuple([GetShortlistParamsSchema]),

  'tags:list': none,
  'tags:getUsageCount': TagsInvokeBodySchemas.tagId.shape.args,
  'tags:getVariantTags': TagsInvokeBodySchemas.caseVariant.shape.args,
  'tags:create': TagsInvokeBodySchemas.create.shape.args,
  'tags:update': TagsInvokeBodySchemas.update.shape.args,
  'tags:delete': TagsInvokeBodySchemas.tagId.shape.args,
  'tags:assignVariantTag': TagsInvokeBodySchemas.assign.shape.args,
  'tags:removeVariantTag': TagsInvokeBodySchemas.assign.shape.args,
  'tags:setVariantTags': z.tuple([id, id, VariantTagSetSchema.shape.tagIds.max(MAX_LIST)]),

  'annotations:getPerCase': twoIds,
  'annotations:deletePerCase': twoIds,
  'annotations:batchGet': z.tuple([id.nullable(), VariantKeysSchema.max(MAX_LIST)]),

  'case-comments:list': CaseCommentInvokeBodySchemas.list.shape.args,
  'case-comments:create': CaseCommentInvokeBodySchemas.create.shape.args,
  'case-comments:update': CaseCommentInvokeBodySchemas.update.shape.args,
  'case-comments:delete': CaseCommentInvokeBodySchemas.delete.shape.args,

  'case-metrics:listDefinitions': none,
  'case-metrics:listForCase': CaseMetricInvokeBodySchemas.listForCase.shape.args,
  'case-metrics:createDefinition': CaseMetricInvokeBodySchemas.createDefinition.shape.args,
  'case-metrics:upsert': CaseMetricInvokeBodySchemas.upsert.shape.args,
  'case-metrics:delete': CaseMetricInvokeBodySchemas.delete.shape.args,

  'panels:list': none,
  'panels:getGenes': oneId,
  'panels:activeForCase': oneId,
  'panels:delete': oneId,
  'panels:duplicate': z.tuple([id, PanelDuplicateSchema.shape.newName]),
  'panels:setGenes': z.tuple([id, PanelGenesSchema.shape.genes]),
  'panels:activate': z.tuple([
    id,
    id,
    orDefault(PanelActivateSchema.shape.paddingBp.unwrap(), 5000)
  ]),
  'panels:deactivate': twoIds,

  'gene-lists:list': none,
  'gene-lists:getGenes': oneId,
  'gene-lists:create': z.tuple([
    GeneListCreateSchema.shape.name,
    GeneListCreateSchema.shape.description
  ]),
  'gene-lists:delete': oneId,

  'region-files:list': none,
  'region-files:create': z.tuple([
    RegionFileCreateSchema.shape.name,
    RegionFileCreateSchema.shape.description.transform((value) => value ?? null)
  ]),
  'region-files:delete': oneId,

  'presets:list': none,
  'presets:create': z.tuple([FilterPresetCreateSchema]),
  'presets:update': z.tuple([id, FilterPresetUpdateSchema]),
  'presets:delete': oneId,
  'presets:reorder': z.tuple([FilterPresetReorderSchema.max(MAX_LIST)]),

  'analysis-groups:list': none,
  'analysis-groups:get': oneId,
  'analysis-groups:getForCase': oneId,
  'analysis-groups:update': z.tuple([id, AnalysisGroupUpdateSchema]),
  'analysis-groups:delete': oneId,
  'analysis-groups:removeMember': twoIds
}
