"use client"

/**
 * BI FINANCIERO IA — Asistente IA (consulta estratégica + historial).
 * El asistente responde SOLO con datos reales del período (getBiFinanceSummary
 * en el backend). Nunca llama a OpenAI desde el cliente.
 */
import { useCallback, useEffect, useState } from "react"
import { apiJsonp } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DashPanel, EmptyChart } from "@/components/dashboard-kit"
import { BrainCircuit, History, ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import {
  useBiData, BiPeriodBar, BiHeader, AskAiPanel, AiAnswerCard, branchesFromSummary,
  fmtInt, type AiAnswer,
} from "./bi-shared"

interface HistoryRow {
  id: string; created_at: string; user_email?: string; scope?: string; branch?: string | null
  period_month?: number; period_year?: number; question: string; answer?: AiAnswer | null
  model?: string; tokens_total?: number | null; confidence?: string | null; ok: boolean; error?: string | null
}

export function BiAsistentePage() {
  const { summary, loading, refresh } = useBiData()
  const branches = branchesFromSummary(summary)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [tab, setTab] = useState<"chat" | "historial">("chat")

  const loadHistory = useCallback(async () => {
    setHistLoading(true)
    try { const res = await apiJsonp("", { action: "getBiFinanceHistory", limit: 50 }) as unknown as { rows: HistoryRow[] }; setHistory(res.rows || []) } finally { setHistLoading(false) }
  }, [])
  useEffect(() => { if (tab === "historial") void loadHistory() }, [tab, loadHistory])

  return (
    <div className="space-y-4">
      <BiHeader title="Asistente Financiero IA" subtitle="Análisis estratégico sobre datos reales · el asistente solo recomienda; decides tú." />
      <BiPeriodBar branches={branches} onRefresh={refresh} loading={loading} right={
        <div className="flex gap-1">
          <Button variant={tab === "chat" ? "default" : "outline"} size="sm" onClick={() => setTab("chat")}><BrainCircuit className="h-4 w-4" /><span className="ml-1 hidden sm:inline">Consultar</span></Button>
          <Button variant={tab === "historial" ? "default" : "outline"} size="sm" onClick={() => setTab("historial")}><History className="h-4 w-4" /><span className="ml-1 hidden sm:inline">Historial</span></Button>
        </div>
      } />

      {tab === "chat" ? (
        <AskAiPanel scope="asistente" suggestions={[
          "¿Cómo está la salud financiera del negocio?",
          "¿Qué sucursal es más rentable y cuál necesita atención?",
          "¿Dónde puedo reducir costos sin afectar la operación?",
          "¿Qué proyección tengo para el próximo trimestre?",
          "Dame un plan de acción para mejorar el margen neto.",
        ]} />
      ) : (
        <DashPanel title="Historial de consultas">
          {histLoading ? <EmptyChart text="Cargando…" /> : history.length ? (
            <ul className="space-y-2">
              {history.map((h) => (
                <li key={h.id} className="rounded-xl border border-[color:var(--brand-border)]">
                  <button onClick={() => setOpen(open === h.id ? null : h.id)} className="flex w-full items-start justify-between gap-2 p-3 text-left">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {open === h.id ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                        <span className="truncate text-sm font-medium">{h.question}</span>
                      </div>
                      <div className="ml-6 mt-0.5 text-[11px] text-muted-foreground">
                        {new Date(h.created_at).toLocaleString("es-DO")} · {h.scope || "—"}{h.branch ? ` · ${h.branch}` : ""} · {h.model || ""}
                        {h.confidence ? ` · confianza ${h.confidence}` : ""}{h.tokens_total ? ` · ${fmtInt(h.tokens_total)} tokens` : ""}
                        {!h.ok ? ` · ⚠ ${h.error || "error"}` : ""}
                      </div>
                    </div>
                  </button>
                  {open === h.id && h.answer ? <div className="border-t p-3"><AiAnswerCard answer={h.answer} model={h.model} tokens={h.tokens_total} /></div> : null}
                </li>
              ))}
            </ul>
          ) : <EmptyChart text="Aún no hay consultas registradas." />}
        </DashPanel>
      )}
    </div>
  )
}
