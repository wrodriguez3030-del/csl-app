"use client"

/**
 * BI FINANCIERO IA — utilidades compartidas por las pantallas del módulo.
 *
 * Contiene el store de período (mes/año/sucursal, persistente entre pantallas),
 * el hook de datos agregados (getBiFinanceData), el cliente seguro del asistente
 * IA (fetch con token a la ruta backend-only), formateadores y UI compartida
 * (barra de período, KPIs, panel "Preguntar a IA" y tarjeta de respuesta
 * estructurada). Nunca llama a OpenAI desde el cliente: solo a nuestra ruta.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { apiJsonp } from "@/lib/store"
import { useAppStore } from "@/lib/store"
import { businessIdForSlug } from "@/lib/business"
import { supabaseBrowser } from "@/lib/supabase-client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { KpiCard } from "@/components/kpi-card"
import { DashHeader } from "@/components/dashboard-kit"
import {
  BrainCircuit, Sparkles, RefreshCcw, Loader2, AlertTriangle, CheckCircle2,
  Lightbulb, ShieldAlert, ListChecks, ClipboardList, Info, type LucideIcon,
} from "lucide-react"

// ── Formateadores ────────────────────────────────────────────────────────────
export const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmtRD0 = (n: number) => "RD$" + Math.round(Number(n) || 0).toLocaleString("en-US")
export const fmtInt = (n: number) => (Number(n) || 0).toLocaleString("en-US")
export const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${(Number(n) || 0).toFixed(1)}%`)
export const fmtCompact = (n: number) => {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1e6) return `RD$${(v / 1e6).toFixed(2)}M`
  if (Math.abs(v) >= 1e3) return `RD$${Math.round(v / 1e3)}K`
  return `RD$${Math.round(v)}`
}
export const CHART_COLORS = ["#0D9488", "#D97706", "#7C3AED", "#DB2777", "#0EA5E9", "#65A30D"]

// ── Tipos del resumen (espejo de lib/server/bi-finance.ts) ──────────────────
export interface BranchProfit {
  branch: string; ingresos: number; gastos: number; utilidadNeta: number; margenNeto: number
  desglose: { facturas: number; gastosGenerales: number; gastosMenores: number; recurrentes: number; overheadAsignado: number; materiales: number }
  categorias: { producto: number; servicio: number; laser: number }
}
export interface BiSummary {
  business: { slug: string; name: string }
  period: { month: number; year: number; label: string; from: string; to: string }
  branchFilter: string | null
  allocateOverhead: boolean
  resumen: { ingresos: number; gastos: number; utilidadNeta: number; margenNeto: number; ticketPromedio: number; transacciones: number; pacientes: number; ingresosDeltaPct: number | null }
  ingresos: { total: number; porCategoria: { producto: number; servicio: number; laser: number }; byBranch: Record<string, number> }
  gastos: { total: number; facturas: number; gastosGenerales: number; gastosMenores: number; recurrentes: number; nomina: number; materiales: number; overhead: { total: number; nomina: number; sinSucursal: number; prorrateado: boolean }; byBranch: Record<string, Record<string, number>> }
  rentabilidad: BranchProfit[]
  trend: { key: string; label: string; ingresos: number; gastos: number; utilidad: number }[]
  fuentes: Record<string, string>
}

// ── Store de período (persistente entre pantallas del módulo) ───────────────
interface BiState {
  month: number; year: number; branch: string
  setPeriod: (month: number, year: number) => void
  setBranch: (branch: string) => void
}
const nowRef = new Date()
export const useBiStore = create<BiState>()(persist(
  (set) => ({
    month: nowRef.getUTCMonth() + 1,
    year: nowRef.getUTCFullYear(),
    branch: "",
    setPeriod: (month, year) => set({ month, year }),
    setBranch: (branch) => set({ branch }),
  }),
  { name: "bi-finance-period" },
))

// ── Cliente seguro del asistente IA ─────────────────────────────────────────
export interface AiAnswer {
  resumen_ejecutivo: string
  datos_utilizados: string[]
  hallazgos: string[]
  riesgos: string[]
  recomendaciones: string[]
  acciones: string[]
  nivel_confianza: "alto" | "medio" | "bajo"
  datos_faltantes: string[]
}
export interface AssistantResult {
  ok: boolean; error?: string; reason?: string; model?: string
  answer?: AiAnswer; tokens?: number | null; latencyMs?: number; queryId?: string | null
}

export async function callAssistant(payload: {
  question?: string; scope?: string; month?: number; year?: number; branch?: string | null; mode?: "chat" | "test"
}): Promise<AssistantResult> {
  const activeBusinessId = businessIdForSlug(useAppStore.getState().activeBusinessSlug) || undefined
  const session = (await supabaseBrowser.auth.getSession()).data.session
  const token = session?.access_token
  if (!token) return { ok: false, error: "Inicia sesión nuevamente." }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 55000)
  try {
    const resp = await fetch("/api/bi-finance/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...payload, activeBusinessId }),
      signal: controller.signal,
    })
    const jr = (await resp.json().catch(() => ({}))) as AssistantResult
    return jr
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return { ok: false, error: "El asistente tardó demasiado. Intenta de nuevo." }
    return { ok: false, error: e instanceof Error ? e.message : "Error de conexión con el asistente." }
  } finally {
    clearTimeout(timeout)
  }
}

/** Cliente seguro de la ruta de credenciales OpenAI (guardar/eliminar/estado). */
export async function callKeyRoute(payload: { action: "save" | "delete" | "status"; apiKey?: string }): Promise<{ ok: boolean; error?: string; configured?: boolean; last4?: string | null; source?: string | null }> {
  const activeBusinessId = businessIdForSlug(useAppStore.getState().activeBusinessSlug) || undefined
  const token = (await supabaseBrowser.auth.getSession()).data.session?.access_token
  if (!token) return { ok: false, error: "Inicia sesión nuevamente." }
  try {
    const resp = await fetch("/api/bi-finance/openai-key", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...payload, activeBusinessId }),
    })
    return (await resp.json().catch(() => ({ ok: false, error: "Respuesta inválida" }))) as { ok: boolean }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de conexión" }
  }
}

// ── Hook de datos agregados ─────────────────────────────────────────────────
export function useBiData() {
  const { month, year, branch } = useBiStore()
  const [data, setData] = useState<{ summary: BiSummary; openAlerts: number; aiConfigured: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiJsonp("", { action: "getBiFinanceData", month, year, ...(branch ? { branch } : {}) }) as unknown as { summary: BiSummary; openAlerts: number; aiConfigured: boolean }
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los datos financieros.")
    } finally {
      setLoading(false)
    }
  }, [month, year, branch])

  useEffect(() => { void refresh() }, [refresh])
  return { data, summary: data?.summary || null, loading, error, refresh }
}

// ── Barra de período ────────────────────────────────────────────────────────
const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
export function BiPeriodBar({ branches, onRefresh, loading, right }: {
  branches?: string[]; onRefresh?: () => void; loading?: boolean; right?: ReactNode
}) {
  const { month, year, branch, setPeriod, setBranch } = useBiStore()
  const options: { value: string; label: string }[] = []
  const d = new Date()
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1
  for (let i = 0; i < 18; i++) { options.push({ value: `${y}-${m}`, label: `${MESES[m]} ${y}` }); m--; if (m < 1) { m = 12; y-- } }

  return (
    <Card className="rounded-2xl border-[color:var(--brand-border)] shadow-sm">
      <CardContent className="flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs font-semibold text-muted-foreground">Período</span>
        <Select value={`${year}-${month}`} onValueChange={(v) => { const [yy, mm] = v.split("-").map(Number); setPeriod(mm, yy) }}>
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
        {branches && branches.length > 0 ? (
          <>
            <span className="text-xs font-semibold text-muted-foreground">Sucursal</span>
            <Select value={branch || "__all__"} onValueChange={(v) => setBranch(v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas las sucursales</SelectItem>
                {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        ) : null}
        {onRefresh ? (
          <Button variant="outline" size="sm" className="h-9" onClick={onRefresh} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            <span className="ml-1 hidden sm:inline">Actualizar</span>
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </CardContent>
    </Card>
  )
}

// ── KPIs ─────────────────────────────────────────────────────────────────────
export function BiKpiGrid({ items }: { items: { title: string; value: string | number; icon: LucideIcon; variant?: "primary" | "success" | "warning" | "destructive"; description?: string }[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((k, i) => <KpiCard key={i} title={k.title} value={k.value} icon={k.icon} variant={k.variant} description={k.description} />)}
    </div>
  )
}

// ── Tarjeta de respuesta estructurada de la IA ──────────────────────────────
function Section({ icon: Icon, title, items, tone = "neutral" }: { icon: LucideIcon; title: string; items: string[]; tone?: "neutral" | "good" | "warn" | "bad" }) {
  if (!items || items.length === 0) return null
  const chip = tone === "good" ? "text-emerald-600 bg-emerald-50" : tone === "warn" ? "text-amber-600 bg-amber-50" : tone === "bad" ? "text-rose-600 bg-rose-50" : "text-sky-600 bg-sky-50"
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`rounded-md p-1 ${chip}`}><Icon className="h-3.5 w-3.5" /></span>
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h4>
      </div>
      <ul className="ml-1 space-y-1">
        {items.map((t, i) => <li key={i} className="flex gap-2 text-sm leading-snug"><span className="text-muted-foreground">•</span><span>{t}</span></li>)}
      </ul>
    </div>
  )
}

export function AiAnswerCard({ answer, model, tokens }: { answer: AiAnswer; model?: string; tokens?: number | null }) {
  const conf = answer.nivel_confianza
  const confChip = conf === "alto" ? "bg-emerald-50 text-emerald-700" : conf === "medio" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"
  return (
    <Card className="rounded-2xl border-[color:var(--brand-border)] shadow-sm">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-[color:var(--brand-primary-soft)] p-1.5 text-[color:var(--brand-primary)]"><Sparkles className="h-4 w-4" /></span>
            <h3 className="text-sm font-bold text-[color:var(--brand-primary-dark)]">Análisis del asistente IA</h3>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${confChip}`}>Confianza: {conf || "—"}</span>
        </div>
        {answer.resumen_ejecutivo ? (
          <p className="rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">{answer.resumen_ejecutivo}</p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Section icon={CheckCircle2} title="Hallazgos" items={answer.hallazgos} tone="good" />
          <Section icon={ShieldAlert} title="Riesgos" items={answer.riesgos} tone="bad" />
          <Section icon={Lightbulb} title="Recomendaciones" items={answer.recomendaciones} tone="warn" />
          <Section icon={ListChecks} title="Plan de acción" items={answer.acciones} tone="neutral" />
          <Section icon={ClipboardList} title="Datos utilizados" items={answer.datos_utilizados} tone="neutral" />
          <Section icon={Info} title="Datos faltantes" items={answer.datos_faltantes} tone="warn" />
        </div>
        <div className="flex items-center justify-between border-t pt-2 text-[11px] text-muted-foreground">
          <span>Solo recomienda; las decisiones son del administrador.</span>
          <span>{model ? `Modelo: ${model}` : ""}{tokens ? ` · ${tokens} tokens` : ""}</span>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Panel "Preguntar a la IA" ────────────────────────────────────────────────
export function AskAiPanel({ scope, suggestions = [], compact }: { scope: string; suggestions?: string[]; compact?: boolean }) {
  const { month, year, branch } = useBiStore()
  const [q, setQ] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AssistantResult | null>(null)

  const ask = useCallback(async (question: string) => {
    const text = question.trim()
    if (!text || loading) return
    setLoading(true); setResult(null)
    const res = await callAssistant({ question: text, scope, month, year, branch: branch || null })
    setResult(res); setLoading(false)
  }, [loading, scope, month, year, branch])

  const notReady = result && !result.ok
  return (
    <div className="space-y-3">
      <Card className="rounded-2xl border-[color:var(--brand-primary-soft)] shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-[color:var(--brand-primary-soft)] p-1.5 text-[color:var(--brand-primary)]"><BrainCircuit className="h-4 w-4" /></span>
            <h3 className="text-sm font-bold text-[color:var(--brand-primary-dark)]">Preguntar a la IA</h3>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void ask(q) }}
              placeholder="Ej: ¿Qué sucursal es más rentable y por qué? ¿Dónde reducir gastos?"
              className="flex-1"
            />
            <Button onClick={() => void ask(q)} disabled={loading || !q.trim()} className="shrink-0">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span className="ml-1">Analizar</span>
            </Button>
          </div>
          {suggestions.length > 0 && !compact ? (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s} onClick={() => { setQ(s); void ask(s) }} disabled={loading}
                  className="rounded-full border border-[color:var(--brand-border)] bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {loading ? (
        <Card className="rounded-2xl border-[color:var(--brand-border)] shadow-sm">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Analizando datos reales del período…
          </CardContent>
        </Card>
      ) : notReady ? (
        <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">El asistente no está disponible</div>
              <div>{result?.reason || result?.error}</div>
              {(result?.error === "no_api_key" || result?.error === "ia_disabled_tenant") ? (
                <div className="mt-1 text-[12px]">Ve a <b>BI Financiero IA → Configuración IA</b> para configurar la API key y activar el asistente.</div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : result?.ok && result.answer ? (
        <AiAnswerCard answer={result.answer} model={result.model} tokens={result.tokens} />
      ) : null}
    </div>
  )
}

// ── Estados de carga / error / vacío ────────────────────────────────────────
export function BiLoading() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[92px] animate-pulse rounded-2xl bg-slate-100" />)}
    </div>
  )
}
export function BiError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="rounded-2xl border-rose-200 bg-rose-50 shadow-sm">
      <CardContent className="flex items-center justify-between gap-3 p-4 text-sm text-rose-700">
        <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{message}</span>
        {onRetry ? <Button variant="outline" size="sm" onClick={onRetry}>Reintentar</Button> : null}
      </CardContent>
    </Card>
  )
}

export function BiHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return <DashHeader title={title} subtitle={subtitle} />
}

/** Lista de sucursales del resumen para el selector. */
export function branchesFromSummary(summary: BiSummary | null): string[] {
  if (!summary) return []
  return summary.rentabilidad.map((r) => r.branch).filter((b) => b && b !== "(sin sucursal)")
}
