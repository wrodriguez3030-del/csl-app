/**
 * Contrato del payload que el navegador manda a `commitExpenseImport`
 * (compartido cliente/servidor; el servidor lo valida con `safeParse`).
 */
import { z } from "zod"

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)")

export const expenseImportSchema = z.object({
  import: z.object({
    filename: z.string().max(300),
    fileHash: z.string().length(64),
    year: z.number().int().min(2015).max(2100),
    rowsCount: z.number().int().min(0),
    grossTotal: z.number(),
    detectedPeriodStart: z.string().max(10),
    detectedPeriodEnd: z.string().max(10),
    periods: z.array(z.string().regex(/^\d{4}-\d{2}$/)).max(24),
    includeHistory: z.boolean(),
  }),
  expenses: z.array(z.object({
    date: isoDate,
    branch: z.string().min(1).max(100),
    concept: z.string().min(1).max(500),
    amount: z.number().positive(),
    account: z.string().max(60).nullable(),
    category: z.string().max(80),
    notes: z.string().max(300),
    rowHash: z.string().length(16),
  })).max(6000),
  investments: z.array(z.object({
    year: z.number().int(), month: z.number().int().min(1).max(12),
    branch: z.string().max(100).nullable(),
    amount: z.number().positive(),
    nombre: z.string().max(200),
    fechaInicio: isoDate,
    rowHash: z.string().length(16),
  })).max(60),
  withdrawals: z.array(z.object({
    year: z.number().int(), month: z.number().int().min(1).max(12),
    kind: z.enum(["dividendo", "cuenta"]),
    amount: z.number().positive(),
    date: isoDate,
    rowHash: z.string().length(16),
  })).max(60),
  history: z.array(z.object({
    year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12),
    efectivo: z.number(), tarjeta: z.number(), total: z.number(),
  })).max(240),
  rawSummary: z.unknown(),
})

export type ExpenseImportPayload = z.infer<typeof expenseImportSchema>
