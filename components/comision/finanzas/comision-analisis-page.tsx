"use client"

/**
 * Incentivos de Ventas › Análisis IA.
 * Réplica de la hoja ANÁLISIS: al abrir se pide al asistente el análisis
 * financiero del período con una pregunta FIJA. El servidor cachea por los datos
 * exactos del período, así que reabrir la pantalla no consume tokens; «Regenerar»
 * fuerza uno nuevo. Sin IA configurada cae al análisis por reglas.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DashPanel, InsightItem } from "@/components/dashboard-kit"
import { useAppStore } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { RefreshCcw, Copy, Printer, Loader2, AlertTriangle, Lightbulb, ShieldAlert, CheckCircle2 } from "lucide-react"
import {
  useBiData, useBiStore, callAssistant, AiAnswerCard, AskAiPanel, computeInsights,
  type AssistantResult, type BiSummary,
} from "@/components/bi-finance/bi-shared"
import { ANALISIS_SCOPE, ANALISIS_QUESTION } from "@/lib/bi-finance/analisis-prompt"
import { analysisToText } from "@/lib/bi-finance/finanzas-format"
import { FinanzasPageShell } from "./finanzas-shared"

const TONE_ICON: Record<string, React.ReactNode> = {
  success: <CheckCircle2 className="h-3.5 w-3.5" />,
  warning: <AlertTriangle className="h-3.5 w-3.5" />,
  info: <Lightbulb className="h-3.5 w-3.5" />,
}

function Cabecera({ result, loading, onRegenerate, onCopy, onPrint }: {
  result: AssistantResult | null; loading: boolean; onRegenerate: () => void; onCopy: () => void; onPrint: () => void
}) {
  return (
    <Card className="rounded-2xl border-[color:var(--brand-border)] shadow-sm"><CardContent className="flex flex-wrap items-center gap-2 p-3">
      <div className="mr-auto flex flex-wrap items-center gap-1.5 text-xs">
        {result?.model ? <Badge variant="outline">Modelo: {result.model}</Badge> : null}
        {result?.ok ? (
          result.cached
            ? <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">Cacheado · 0 tokens</Badge>
            : <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Nuevo · {result.tokens ?? "—"} tokens</Badge>
        ) : null}
      </div>
      <Button variant="outline" size="sm" className="h-8" disabled={loading} onClick={onRegenerate}>
        {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />}Regenerar
      </Button>
      <Button variant="outline" size="sm" className="h-8" disabled={!result?.answer} onClick={onCopy}><Copy className="mr-1.5 h-3.5 w-3.5" />Copiar</Button>
      <Button variant="outline" size="sm" className="h-8" disabled={!result?.answer} onClick={onPrint}><Printer className="mr-1.5 h-3.5 w-3.5" />Imprimir</Button>
    </CardContent></Card>
  )
}

function AnalisisPorReglas({ summary, motivo }: { summary: BiSummary; motivo: string }) {
  const insights = computeInsights(summary)
  return (
    <>
      <Card className="border-amber-200 bg-amber-50/40"><CardContent className="flex items-start gap-2 p-4 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div><div className="font-semibold">Análisis sin IA</div><div className="mt-0.5 text-amber-700">{motivo}</div></div>
      </CardContent></Card>
      <DashPanel title="Análisis automático (por reglas)">
        <div className="space-y-2">
          {insights.map((i, idx) => <InsightItem key={idx} tone={i.tone} title={i.title} detail={i.detail} icon={TONE_ICON[i.tone]} />)}
          {!insights.length ? <p className="text-sm text-muted-foreground">Sin observaciones para el período.</p> : null}
        </div>
      </DashPanel>
    </>
  )
}

export function ComisionAnalisisPage() {
  const { data, summary, loading, error, refresh } = useBiData()
  const { showToast } = useAppStore()
  const user = useSessionUser()
  const s = useBiStore()
  const canAi = canPerm(user, "bi_finance.ai_chat")
  const aiConfigured = Boolean((data as { aiConfigured?: boolean } | null)?.aiConfigured)
  const [result, setResult] = useState<AssistantResult | null>(null)
  const [running, setRunning] = useState(false)
  const ranFor = useRef("")

  const run = useCallback(async (force: boolean) => {
    if (!summary) return
    setRunning(true)
    try {
      const res = await callAssistant({
        question: ANALISIS_QUESTION, scope: ANALISIS_SCOPE, month: s.month, year: s.year,
        branch: s.branch || null, from: summary.period.from, to: summary.period.to, force,
      })
      setResult(res)
      if (!res.ok && res.error) showToast(res.error, "error")
    } finally { setRunning(false) }
  }, [summary, s.month, s.year, s.branch, showToast])

  // Se lanza solo al abrir y al cambiar el período/sucursal (una vez por clave).
  useEffect(() => {
    if (!summary || !aiConfigured || !canAi) return
    const key = `${summary.period.from}|${summary.period.to}|${s.branch}`
    if (ranFor.current === key) return
    ranFor.current = key
    void run(false)
  }, [summary, aiConfigured, canAi, s.branch, run])

  const onCopy = async () => {
    if (!result?.answer || !summary) return
    try {
      await navigator.clipboard.writeText(analysisToText(result.answer, { model: result.model, period: summary.period.label }))
      showToast("Análisis copiado", "success")
    } catch { showToast("No se pudo copiar", "error") }
  }
  const onPrint = () => {
    if (!result?.answer || !summary) return
    const text = analysisToText(result.answer, { model: result.model, period: summary.period.label })
    const w = window.open("", "_blank")
    if (!w) return
    w.document.write(`<pre style="font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;padding:24px">${text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c))}</pre>`)
    w.document.close(); w.print()
  }

  const motivo = !aiConfigured ? "El asistente IA no está configurado para este negocio."
    : !canAi ? "No tienes el permiso «Consultar al asistente IA»."
    : result && !result.ok ? (result.reason || result.error || "El asistente no pudo responder.") : ""

  return (
    <FinanzasPageShell
      title="Análisis IA"
      subtitle="Análisis financiero y recomendaciones sobre los datos reales del período"
      loading={loading} error={error} summary={summary} onRefresh={refresh}
    >
      {summary ? (
        <>
          <Cabecera result={result} loading={running} onRegenerate={() => run(true)} onCopy={onCopy} onPrint={onPrint} />
          {running && !result?.answer ? (
            <Card className="border-[color:var(--brand-border)]"><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Analizando los datos reales de {summary.period.label}…
            </CardContent></Card>
          ) : null}
          {result?.ok && result.answer ? <AiAnswerCard answer={result.answer} model={result.model} tokens={result.cached ? 0 : result.tokens} /> : null}
          {motivo ? <AnalisisPorReglas summary={summary} motivo={motivo} /> : null}
          {aiConfigured && canAi ? (
            <DashPanel title="Preguntar algo más sobre este período">
              <div className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />Las respuestas se calculan solo con los datos del período seleccionado.</div>
              <div className="mt-2"><AskAiPanel scope={ANALISIS_SCOPE} compact /></div>
            </DashPanel>
          ) : null}
        </>
      ) : null}
    </FinanzasPageShell>
  )
}
