"use client"

/**
 * BI FINANCIERO IA — Configuración IA (por tenant): credenciales OpenAI seguras,
 * selección de modelos recientes, límites de uso/gasto y tablero de consumo.
 * La API key se pega en un campo password, viaja por HTTPS y se guarda CIFRADA
 * en el backend — nunca se muestra completa ni se guarda en el frontend.
 */
import { useCallback, useEffect, useState } from "react"
import { apiJsonp } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DashPanel } from "@/components/dashboard-kit"
import { BiHeader, callAssistant, callKeyRoute, fmtInt } from "./bi-shared"
import {
  CheckCircle2, XCircle, Loader2, ShieldCheck, KeyRound, Save, Zap, Trash2, RefreshCcw,
  Gauge, DollarSign, Cpu, Clock, TrendingUp, Lock,
} from "lucide-react"

interface Settings {
  enabled: boolean; provider: string; model: string | null; temperature: number
  max_tokens: number; system_prompt: string | null; allocate_overhead: boolean
  monthly_query_limit: number | null; daily_query_limit: number | null
  monthly_input_token_limit: number | null; monthly_output_token_limit: number | null; monthly_total_token_limit: number | null
  monthly_cost_limit: number | null; cost_currency: string
  alert_threshold_70: boolean; alert_threshold_90: boolean; block_at_100: boolean
}
interface KeyStatus { configured: boolean; last4: string | null; source: "db" | "env" | null }
interface ModelItem { id: string; display: string; reasoning: boolean; legacy: boolean; source: string }
interface Usage {
  queriesMonth: number; queriesDay: number; inputTokens: number; outputTokens: number; totalTokens: number
  cost: number; currency: string; hasCost: boolean; topModel: string | null; lastAt: string | null
  pct: { queries: number | null; tokens: number | null; cost: number | null; max: number }
  status: "ok" | "warn70" | "warn90" | "blocked"
}
interface Pricing { model_id: string; input_cost_per_1m_tokens: number | null; output_cost_per_1m_tokens: number | null; currency: string; active?: boolean }

const num = (v: number | null) => (v == null ? "" : String(v))

export function BiConfigPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [canManageKey, setCanManageKey] = useState(false)
  const [canConfig, setCanConfig] = useState(false)
  const [recommended, setRecommended] = useState<Record<string, string>>({})
  const [envModel, setEnvModel] = useState<string | null>(null)
  const [models, setModels] = useState<ModelItem[]>([])
  const [modelsUpdatedAt, setModelsUpdatedAt] = useState<string | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [pricing, setPricing] = useState<Pricing[]>([])
  const [loading, setLoading] = useState(true)

  // acciones
  const [keyInput, setKeyInput] = useState("")
  const [savingKey, setSavingKey] = useState(false)
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null)
  const [refreshingModels, setRefreshingModels] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const s = await apiJsonp("", { action: "getBiFinanceSettings" }) as unknown as {
        settings: Settings; keyStatus: KeyStatus; canManageKey: boolean; canConfig: boolean; env: { envModel: string | null }; recommended: Record<string, string>
      }
      setSettings({
        enabled: s.settings.enabled ?? true, provider: s.settings.provider || "openai", model: s.settings.model ?? null,
        temperature: Number(s.settings.temperature ?? 0.2), max_tokens: Number(s.settings.max_tokens ?? 1200),
        system_prompt: s.settings.system_prompt ?? null, allocate_overhead: s.settings.allocate_overhead ?? true,
        monthly_query_limit: s.settings.monthly_query_limit ?? 300, daily_query_limit: s.settings.daily_query_limit ?? null,
        monthly_input_token_limit: s.settings.monthly_input_token_limit ?? null, monthly_output_token_limit: s.settings.monthly_output_token_limit ?? null,
        monthly_total_token_limit: s.settings.monthly_total_token_limit ?? null, monthly_cost_limit: s.settings.monthly_cost_limit ?? null,
        cost_currency: s.settings.cost_currency ?? "USD",
        alert_threshold_70: s.settings.alert_threshold_70 ?? true, alert_threshold_90: s.settings.alert_threshold_90 ?? true, block_at_100: s.settings.block_at_100 ?? true,
      })
      setKeyStatus(s.keyStatus); setCanManageKey(s.canManageKey); setCanConfig(s.canConfig)
      setEnvModel(s.env.envModel); setRecommended(s.recommended || {})
      const [m, u, pr] = await Promise.all([
        apiJsonp("", { action: "getBiFinanceModels" }) as unknown as Promise<{ models: ModelItem[]; updatedAt: string | null }>,
        apiJsonp("", { action: "getBiFinanceUsage" }) as unknown as Promise<{ usage: Usage }>,
        apiJsonp("", { action: "getBiFinancePricing" }) as unknown as Promise<{ rows: Pricing[] }>,
      ])
      setModels(m.models || []); setModelsUpdatedAt(m.updatedAt); setUsage(u.usage); setPricing(pr.rows || [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void loadAll() }, [loadAll])

  const saveKey = useCallback(async () => {
    if (!keyInput.trim()) return
    setSavingKey(true); setKeyMsg(null)
    const res = await callKeyRoute({ action: "save", apiKey: keyInput.trim() })
    if (res.ok) { setKeyMsg({ ok: true, msg: `API key guardada (sk-****${res.last4})` }); setKeyInput(""); setKeyStatus({ configured: true, last4: res.last4 ?? null, source: "db" }) }
    else setKeyMsg({ ok: false, msg: res.error || "No se pudo guardar" })
    setSavingKey(false)
  }, [keyInput])
  const deleteKey = useCallback(async () => {
    if (!window.confirm("¿Eliminar la API key configurada para este negocio?")) return
    const res = await callKeyRoute({ action: "delete" })
    if (res.ok) { setKeyStatus({ configured: res.configured ?? false, last4: res.last4 ?? null, source: (res.source as "db" | "env" | null) ?? null }); setKeyMsg({ ok: true, msg: "API key eliminada" }) }
  }, [])

  const saveSettings = useCallback(async () => {
    if (!settings) return
    setSaving(true); setSaved(false)
    try { await apiJsonp("", { action: "saveBiFinanceSettings", data: JSON.stringify(settings) }); setSaved(true); setTimeout(() => setSaved(false), 2500); void loadAll() } finally { setSaving(false) }
  }, [settings, loadAll])

  const probar = useCallback(async () => {
    setTesting(true); setTest(null)
    const res = await callAssistant({ mode: "test" })
    if (res.ok) setTest({ ok: true, msg: `Conexión OK · modelo ${res.model} · ${res.latencyMs ?? "?"} ms` })
    else setTest({ ok: false, msg: res.reason || res.error || "No se pudo conectar" })
    setTesting(false)
  }, [])

  const refreshModelsNow = useCallback(async () => {
    setRefreshingModels(true)
    try {
      const r = await apiJsonp("", { action: "refreshBiFinanceModels" }) as unknown as { ok: boolean; reason?: string; count?: number }
      if (!r.ok) setKeyMsg({ ok: false, msg: r.reason || "No se pudieron actualizar los modelos" })
      const m = await apiJsonp("", { action: "getBiFinanceModels" }) as unknown as { models: ModelItem[]; updatedAt: string | null }
      setModels(m.models || []); setModelsUpdatedAt(m.updatedAt)
    } finally { setRefreshingModels(false) }
  }, [])

  const savePricingRow = useCallback(async (row: Pricing) => {
    await apiJsonp("", { action: "saveBiFinancePricing", data: JSON.stringify(row) })
    const pr = await apiJsonp("", { action: "getBiFinancePricing" }) as unknown as { rows: Pricing[] }
    setPricing(pr.rows || [])
  }, [])

  if (loading || !settings) return <div className="space-y-4"><BiHeader title="Configuración IA" /><div className="h-40 animate-pulse rounded-2xl bg-slate-100" /></div>
  const S = settings
  const set = (patch: Partial<Settings>) => setSettings({ ...S, ...patch })

  return (
    <div className="space-y-4">
      <BiHeader title="Configuración IA" subtitle="Credenciales OpenAI, modelos, límites de uso y control de gasto" />

      {/* ── Credenciales OpenAI ─────────────────────────────────────────── */}
      <DashPanel title="Credenciales OpenAI">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${keyStatus?.configured ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
            <KeyRound className="h-4 w-4" />
            {keyStatus?.configured ? `Configurada · sk-****${keyStatus.last4}` : "No configurada"}
          </span>
          {keyStatus?.configured ? <span className="text-xs text-muted-foreground">Origen: {keyStatus.source === "db" ? "guardada en el sistema (cifrada)" : "variable de entorno del servidor"}</span> : null}
        </div>
        {canManageKey ? (
          <div className="space-y-2">
            <Field label="Pega tu API key de OpenAI (campo protegido, se guarda cifrada)">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input type="password" autoComplete="off" placeholder="sk-..." value={keyInput} onChange={(e) => setKeyInput(e.target.value)} className="flex-1 font-mono" />
                <Button onClick={saveKey} disabled={savingKey || !keyInput.trim()} className="shrink-0">{savingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}<span className="ml-1">Guardar API key</span></Button>
              </div>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={probar} disabled={testing || !keyStatus?.configured}>{testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}<span className="ml-1">Probar conexión</span></Button>
              {keyStatus?.source === "db" ? <Button variant="ghost" size="sm" onClick={deleteKey} className="text-rose-600 hover:text-rose-700"><Trash2 className="h-4 w-4" /><span className="ml-1">Eliminar / reemplazar</span></Button> : null}
              {keyMsg ? <span className={`flex items-center gap-1 text-sm ${keyMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{keyMsg.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{keyMsg.msg}</span> : null}
              {test ? <span className={`flex items-center gap-1 text-sm ${test.ok ? "text-emerald-600" : "text-rose-600"}`}>{test.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{test.msg}</span> : null}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <Lock className="mr-1 inline h-4 w-4" /> No tienes permiso para gestionar la API key. Contacte al administrador (permiso <code>bi_finance.ai_secrets.manage</code>).
          </div>
        )}
      </DashPanel>

      {/* ── Asistente y modelo ──────────────────────────────────────────── */}
      <DashPanel title="Asistente y modelo">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ToggleRow title="Asistente IA activo" desc="Habilita/inhabilita la IA para este negocio" checked={S.enabled} onChange={(v) => set({ enabled: v })} disabled={!canConfig} />
          <ToggleRow title="Prorratear gastos generales" desc="Reparte overhead entre sucursales por ingresos" checked={S.allocate_overhead} onChange={(v) => set({ allocate_overhead: v })} disabled={!canConfig} />
          <div className="rounded-xl border border-[color:var(--brand-border)] p-3">
            <div className="text-sm font-semibold">Modelo efectivo</div>
            <div className="text-lg font-black text-[color:var(--brand-primary-dark)]">{S.model || envModel || "gpt-4o"}</div>
            <div className="text-[11px] text-muted-foreground">{S.model ? "seleccionado" : envModel ? "de OPENAI_MODEL" : "por defecto"}</div>
          </div>
          <Field label="Modelo para BI Financiero">
            <Select value={S.model || "__env__"} onValueChange={(v) => set({ model: v === "__env__" ? null : v })} disabled={!canConfig}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="__env__">Usar OPENAI_MODEL del servidor {envModel ? `(${envModel})` : ""}</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.display}{m.legacy ? " · legacy" : ""}{m.reasoning ? " · reasoning" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Actualizar catálogo de modelos</Label>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={refreshModelsNow} disabled={refreshingModels || !canConfig}>{refreshingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}<span className="ml-1">Actualizar modelos</span></Button>
              <span className="text-[11px] text-muted-foreground">{modelsUpdatedAt ? `Actualizado: ${new Date(modelsUpdatedAt).toLocaleString("es-DO")}` : "Lista fallback"}</span>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Recomendados</Label>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(recommended).map(([k, v]) => (
                <button key={k} disabled={!canConfig} onClick={() => set({ model: v })}
                  className="rounded-full border border-[color:var(--brand-border)] bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  {k.replace("_", " ")}: {v}
                </button>
              ))}
            </div>
          </div>
          <Field label={`Temperatura (${S.temperature.toFixed(2)})`}>
            <Input type="number" min={0} max={1} step={0.05} value={S.temperature} onChange={(e) => set({ temperature: Number(e.target.value) })} disabled={!canConfig} />
          </Field>
          <Field label="Máx. tokens de respuesta">
            <Input type="number" min={200} max={8000} step={100} value={S.max_tokens} onChange={(e) => set({ max_tokens: Number(e.target.value) })} disabled={!canConfig} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Instrucciones adicionales del negocio (opcional)">
              <Textarea rows={3} value={S.system_prompt ?? ""} placeholder="Ej: Prioriza recomendaciones de bajo costo. Considera la estacionalidad de diciembre." onChange={(e) => set({ system_prompt: e.target.value || null })} disabled={!canConfig} />
            </Field>
          </div>
        </div>
      </DashPanel>

      {/* ── Control de uso y gasto ──────────────────────────────────────── */}
      <DashPanel title="Control de uso y gasto">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <LimitField label="Consultas por día" value={S.daily_query_limit} onChange={(v) => set({ daily_query_limit: v })} disabled={!canConfig} />
          <LimitField label="Consultas por mes" value={S.monthly_query_limit} onChange={(v) => set({ monthly_query_limit: v })} disabled={!canConfig} />
          <LimitField label="Tokens de entrada / mes" value={S.monthly_input_token_limit} onChange={(v) => set({ monthly_input_token_limit: v })} disabled={!canConfig} />
          <LimitField label="Tokens de salida / mes" value={S.monthly_output_token_limit} onChange={(v) => set({ monthly_output_token_limit: v })} disabled={!canConfig} />
          <LimitField label="Tokens totales / mes" value={S.monthly_total_token_limit} onChange={(v) => set({ monthly_total_token_limit: v })} disabled={!canConfig} />
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><LimitField label="Gasto máximo / mes" value={S.monthly_cost_limit} onChange={(v) => set({ monthly_cost_limit: v })} disabled={!canConfig} /></div>
            <Field label="Moneda">
              <Select value={S.cost_currency} onValueChange={(v) => set({ cost_currency: v })} disabled={!canConfig}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["USD", "DOP"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <ToggleRow title="Alertar al 70%" desc="Aviso amarillo al acercarse al límite" checked={S.alert_threshold_70} onChange={(v) => set({ alert_threshold_70: v })} disabled={!canConfig} />
          <ToggleRow title="Alertar al 90%" desc="Aviso naranja/rojo" checked={S.alert_threshold_90} onChange={(v) => set({ alert_threshold_90: v })} disabled={!canConfig} />
          <ToggleRow title="Bloquear al 100%" desc="Detiene nuevas consultas (superadmin exento)" checked={S.block_at_100} onChange={(v) => set({ block_at_100: v })} disabled={!canConfig} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={saveSettings} disabled={saving || !canConfig}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}<span className="ml-1">Guardar configuración</span></Button>
          {saved ? <span className="flex items-center gap-1 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Guardado</span> : null}
          {!canConfig ? <span className="text-xs text-muted-foreground">Necesitas <code>bi_finance.config</code> para editar.</span> : null}
        </div>
      </DashPanel>

      {/* ── Dashboard de uso ────────────────────────────────────────────── */}
      {usage ? (
        <DashPanel title="Consumo del mes">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <UsageCard icon={Gauge} label="Consultas del mes" value={fmtInt(usage.queriesMonth)} sub={`Hoy: ${fmtInt(usage.queriesDay)}`} />
            <UsageCard icon={Cpu} label="Tokens usados" value={fmtInt(usage.totalTokens)} sub={`In ${fmtInt(usage.inputTokens)} · Out ${fmtInt(usage.outputTokens)}`} />
            <UsageCard icon={DollarSign} label="Costo estimado" value={usage.hasCost ? `${usage.currency} ${usage.cost.toFixed(4)}` : "Pendiente"} sub={usage.hasCost ? "según precios configurados" : "configura precios por modelo"} />
            <UsageCard icon={TrendingUp} label="Modelo más usado" value={usage.topModel || "—"} sub={usage.lastAt ? `Última: ${new Date(usage.lastAt).toLocaleString("es-DO")}` : "sin consultas"} />
          </div>
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Uso del límite (mayor porcentaje entre consultas/tokens/gasto)</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {usage.pct.max.toFixed(0)}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full transition-all ${usage.status === "blocked" ? "bg-rose-500" : usage.status === "warn90" ? "bg-orange-500" : usage.status === "warn70" ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, usage.pct.max)}%` }} />
            </div>
            <div className="mt-1 text-[11px] font-semibold">
              {usage.status === "blocked" ? <span className="text-rose-600">Límite alcanzado — nuevas consultas bloqueadas (salvo superadmin).</span>
                : usage.status === "warn90" ? <span className="text-orange-600">Cerca del límite (≥90%).</span>
                : usage.status === "warn70" ? <span className="text-amber-600">Atención: uso ≥70% del límite.</span>
                : <span className="text-emerald-600">Uso saludable.</span>}
            </div>
          </div>
        </DashPanel>
      ) : null}

      {/* ── Precios por modelo ──────────────────────────────────────────── */}
      <DashPanel title="Precios por modelo (para estimar costo)">
        <p className="mb-2 text-xs text-muted-foreground">Los precios cambian; configúralos manualmente (USD por 1M de tokens). Si un modelo no tiene precio, el costo se muestra como “Pendiente” y no se bloquea por gasto.</p>
        <PricingEditor pricing={pricing} models={models} onSave={savePricingRow} disabled={!canConfig} />
      </DashPanel>

      <Card className="rounded-2xl border-[color:var(--brand-border)] bg-slate-50 shadow-sm">
        <CardContent className="p-4 text-xs leading-relaxed text-muted-foreground">
          <div className="font-semibold text-slate-600">Seguridad</div>
          La API key se guarda cifrada (AES-256-GCM) en el servidor, nunca en el navegador ni en logs, y solo se muestra como <code>sk-****{keyStatus?.last4 || "abcd"}</code>. El asistente corre 100% en el backend, usa solo datos agregados del negocio activo (sin datos personales de clientes), audita cada acción y respeta los límites de uso/gasto. La IA únicamente recomienda; las decisiones son del administrador. Configuración independiente por negocio (Cibao ≠ Depicenter).
        </CardContent>
      </Card>
    </div>
  )
}

function ToggleRow({ title, desc, checked, onChange, disabled }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[color:var(--brand-border)] p-3">
      <div><div className="text-sm font-semibold">{title}</div><div className="text-xs text-muted-foreground">{desc}</div></div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}
function LimitField({ label, value, onChange, disabled }: { label: string; value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  return (
    <Field label={label}>
      <Input type="number" min={0} placeholder="sin límite" value={num(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} disabled={disabled} />
    </Field>
  )
}
function UsageCard({ icon: Icon, label, value, sub }: { icon: typeof Gauge; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--brand-border)] p-3">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="mt-1 truncate text-lg font-black tabular-nums text-[color:var(--brand-primary-dark)]">{value}</div>
      {sub ? <div className="text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  )
}
function PricingEditor({ pricing, models, onSave, disabled }: { pricing: Pricing[]; models: ModelItem[]; onSave: (row: Pricing) => Promise<void>; disabled?: boolean }) {
  const [draft, setDraft] = useState<Pricing>({ model_id: "", input_cost_per_1m_tokens: null, output_cost_per_1m_tokens: null, currency: "USD" })
  const [busy, setBusy] = useState(false)
  const save = async (row: Pricing) => { setBusy(true); try { await onSave(row) } finally { setBusy(false) } }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="p-2">Modelo</th><th className="p-2 text-right">Entrada / 1M</th><th className="p-2 text-right">Salida / 1M</th><th className="p-2">Moneda</th></tr></thead>
          <tbody>
            {pricing.length ? pricing.map((p) => (
              <tr key={p.model_id} className="border-b last:border-0">
                <td className="p-2 font-medium">{p.model_id}</td>
                <td className="p-2 text-right tabular-nums">{p.input_cost_per_1m_tokens ?? "—"}</td>
                <td className="p-2 text-right tabular-nums">{p.output_cost_per_1m_tokens ?? "—"}</td>
                <td className="p-2">{p.currency}</td>
              </tr>
            )) : <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">Sin precios configurados.</td></tr>}
          </tbody>
        </table>
      </div>
      {!disabled ? (
        <div className="grid gap-2 sm:grid-cols-4">
          <Select value={draft.model_id || "__pick__"} onValueChange={(v) => setDraft({ ...draft, model_id: v === "__pick__" ? "" : v })}>
            <SelectTrigger><SelectValue placeholder="Modelo" /></SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="__pick__">Selecciona modelo…</SelectItem>
              {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="number" placeholder="Entrada USD/1M" value={draft.input_cost_per_1m_tokens ?? ""} onChange={(e) => setDraft({ ...draft, input_cost_per_1m_tokens: e.target.value === "" ? null : Number(e.target.value) })} />
          <Input type="number" placeholder="Salida USD/1M" value={draft.output_cost_per_1m_tokens ?? ""} onChange={(e) => setDraft({ ...draft, output_cost_per_1m_tokens: e.target.value === "" ? null : Number(e.target.value) })} />
          <Button size="sm" disabled={busy || !draft.model_id} onClick={() => save(draft)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}<span className="ml-1">Guardar precio</span></Button>
        </div>
      ) : null}
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>
}
