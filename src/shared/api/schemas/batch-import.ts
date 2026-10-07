import { z } from 'zod'

export const BatchImportInvokeBodySchemas = {
  extractZip: z.object({
    args: z.tuple([z.string().min(1), z.string().optional()])
  }),
  status: z.object({
    args: z.tuple([z.string().min(1).max(128)])
  }),
  inspectZip: z.object({
    args: z.tuple([z.string().min(1)])
  }),
  testZipPassword: z.object({
    args: z.tuple([z.string().min(1), z.string()])
  }),
  cleanupZipTemp: z.object({
    args: z.tuple([z.string().uuid()])
  })
} as const

export const BatchImportUnknownResponseSchema = z.unknown()
