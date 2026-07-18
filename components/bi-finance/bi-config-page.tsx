"use client"

/**
 * BI FINANCIERO IA — Configuración IA (por tenant).
 * La API key NUNCA se edita aquí: vive solo en el servidor (env OPENAI_API_KEY).
 * Aquí se configura proveedor, modelo, temperatura, tokens, prompt y límite,
 * y se prueba la conexión contra el backend seguro.
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
import { BiHeader } from "./bi-shared"
import { callAssistant } from "./bi-shared"
import { canPerm } from "@/lib/permissions"
import { useSessionUser } from "@/hooks/use-session-user"
import { CheckCircle2, XCircle, Loader2, ShieldCheck, KeyRound, Save, Zap } from "lucide-react"

interface Settings {
  enabled: boolean; provider: string; model: string | null; temperature: number
  max_tokens: number; system_prompt: string | null; monthly_query_limit: number
}
interface EnvInfo { keyPresent: boolean; enabledEnv: boolean; envModel: string | null; effectiveModel: string }

export function BiConfigPage() {
  const user = useSessionUser()
  const canEdit = canPerm(user, "bi_finance.config")
  const [settings, setSettings] = useState<Settings | null>(null)
  const [env, setEnv] = useState<EnvInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp("", { action: "getBiFinanceSettings" }) as unknown as { settings: Settings; env: EnvInfo }
      setSettings({
        enabled: res.settings.enabled ?? true, provider: res.settings.provider || "openai",
        model: res.settings.model ?? null, temperature: Number(res.settings.temperature ?? 0.2),
        max_tokens: Number(res.settings.max_tokens ?? 1200), system_prompt: res.settings.system_prompt ?? null,
        monthly_query_limit: Number(res.settings.monthly_query_limit ?? 300),
      })
      setEnv(res.env)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const save = useCallback(async () => {
    if (!settings) return
    setSaving(true); setSaved(false)
    try { await apiJsonp("", { action: "saveBiFinanceSettings", data: JSON.stringify(settings) }); setSaved(true); setTimeout(() => setSaved(false), 2500) } finally { setSaving(false) }
  }, [settings])

  const probar = useCallback(async () => {
    setTesting(true); setTest(null)
    const res = await callAssistant({ mode: "test" })
    if (res.ok) setTest({ ok: true, msg: `Conexión OK · modelo ${res.model} · ${res.latencyMs ?? "?"} ms` })
    else setTest({ ok: false, msg: res.reason || res.error || "No se pudo conectar" })
    setTesting(false)
  }, [])

  if (loading || !settings) return <div className="space-y-4"><BiHeader title="Configuración IA" /><div className="h-40 animate-pulse rounded-2xl bg-slate-100" /></div>

  return (
    <div className="space-y-4">
      <BiHeader title="Configuración IA" subtitle="Proveedor, modelo y parámetros del asistente financiero" />

      {/* Estado del entorno (clave/flags del servidor) */}
      <Card className="rounded-2xl border-[color:var(--brand-border)] shadow-sm">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <EnvStat ok={env?.keyPresent} icon={KeyRound} label="OPENAI_API_KEY" okText="Configurada en el servidor" badText="No configurada (pídela al administrador)" />
          <EnvStat ok={env?.enabledEnv} icon={ShieldCheck} label="BI_FINANCE_AI_ENABLED" okText="Habilitado (=true)" badText="Deshabilitado (define =true en Vercel)" />
          <EnvStat ok icon={Zap} label="Modelo efectivo" okText={env?.effectiveModel || "—"} badText="—" neutral />
        </CardContent>
      </Card>

      <DashPanel title="Parámetros del asistente">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-center justify-between rounded-xl border border-[color:var(--brand-border)] p-3">
            <div><div className="text-sm font-semibold">Asistente activo</div><div className="text-xs text-muted-foreground">Habilita/inhabilita la IA para este negocio</div></div>
            <Switch checked={settings.enabled} onCheckedChange={(v) => setSettings({ ...settings, enabled: v })} disabled={!canEdit} />
          </div>
          <Field label="Proveedor">
            <Select value={settings.provider} onValueChange={(v) => setSettings({ ...settings, provider: v })} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="openai">OpenAI (ChatGPT)</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Modelo (vacío = usar OPENAI_MODEL del servidor)">
            <Input value={settings.model ?? ""} placeholder={env?.envModel || env?.effectiveModel || "gpt-4o"} onChange={(e) => setSettings({ ...settings, model: e.target.value || null })} disabled={!canEdit} />
          </Field>
          <Field label={`Temperatura (${settings.temperature.toFixed(2)})`}>
            <Input type="number" min={0} max={1} step={0.05} value={settings.temperature} onChange={(e) => setSettings({ ...settings, temperature: Number(e.target.value) })} disabled={!canEdit} />
          </Field>
          <Field label="Máx. tokens de respuesta">
            <Input type="number" min={200} max={4000} step={100} value={settings.max_tokens} onChange={(e) => setSettings({ ...settings, max_tokens: Number(e.target.value) })} disabled={!canEdit} />
          </Field>
          <Field label="Límite de consultas por período">
            <Input type="number" min={0} step={10} value={settings.monthly_query_limit} onChange={(e) => setSettings({ ...settings, monthly_query_limit: Number(e.target.value) })} disabled={!canEdit} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Instrucciones adicionales del negocio (prompt del sistema, opcional)">
              <Textarea rows={4} value={settings.system_prompt ?? ""} placeholder="Ej: Prioriza recomendaciones de bajo costo. Considera la estacionalidad de diciembre." onChange={(e) => setSettings({ ...settings, system_prompt: e.target.value || null })} disabled={!canEdit} />
            </Field>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={saving || !canEdit}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}<span className="ml-1">Guardar configuración</span></Button>
          <Button variant="outline" onClick={probar} disabled={testing}>{testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}<span className="ml-1">Probar conexión</span></Button>
          {saved ? <span className="flex items-center gap-1 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Guardado</span> : null}
          {test ? <span className={`flex items-center gap-1 text-sm ${test.ok ? "text-emerald-600" : "text-rose-600"}`}>{test.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{test.msg}</span> : null}
        </div>
        {!canEdit ? <div className="mt-2 text-xs text-muted-foreground">Necesitas el permiso <code>bi_finance.config</code> para editar.</div> : null}
      </DashPanel>

      <Card className="rounded-2xl border-[color:var(--brand-border)] bg-slate-50 shadow-sm">
        <CardContent className="p-4 text-xs leading-relaxed text-muted-foreground">
          <div className="font-semibold text-slate-600">Seguridad</div>
          La API key nunca se guarda en la base de datos ni se muestra en la interfaz: reside únicamente como variable de entorno del servidor (<code>OPENAI_API_KEY</code>). El asistente se ejecuta 100% en el backend, usa solo datos agregados del negocio activo (sin datos personales de clientes), y cada consulta queda auditada. La IA únicamente recomienda; las decisiones son responsabilidad del administrador.
        </CardContent>
      </Card>
    </div>
  )
}

function EnvStat({ ok, icon: Icon, label, okText, badText, neutral }: { ok?: boolean; icon: typeof KeyRound; label: string; okText: string; badText: string; neutral?: boolean }) {
  const good = neutral ? "text-slate-600 bg-slate-100" : ok ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50"
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[color:var(--brand-border)] p-3">
      <span className={`rounded-lg p-2 ${good}`}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{neutral ? okText : ok ? okText : badText}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>
}
