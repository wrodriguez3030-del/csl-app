"use client"

import { useCallback, useEffect, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { SlidersHorizontal, RefreshCcw, Save, Loader2, AlertTriangle } from "lucide-react"
import { LaserPersonnelEditor } from "./laser-personnel-editor"

interface Rule {
  id: string
  name: string
  ruleType: string
  category: string | null
  branch: string | null
  minAmount: number | null
  percentage: number | null
  fixedAmount: number | null
  priority: number
  active: boolean
  effectiveFrom?: string | null
  effectiveTo?: string | null
}

const RULE_GROUP: Record<string, { label: string; kind: "pct" | "fixed" | "laser" | "flag" }> = {
  card_percentage: { label: "Ventas con tarjeta (%)", kind: "pct" },
  category_commission: { label: "Comisión por categoría (%)", kind: "pct" },
  laser_scale: { label: "Escala depilación láser (umbral → %)", kind: "laser" },
  laser_split_mode: { label: "Láser: reparto EQUITATIVO por persona (modo cuadro) — No = usar los pesos de abajo", kind: "flag" },
  laser_weight_personas: { label: "Reparto láser: % por cantidad de personas (solo modo pesos)", kind: "pct" },
  laser_weight_pacientes: { label: "Reparto láser: % por pacientes atendidos (solo modo pesos)", kind: "pct" },
  laser_zero_patients_fixed: { label: "Láser: empleado con 0 pacientes recibe parte fija", kind: "flag" },
  laser_card_discount_before_scale: { label: "Láser: descontar tarjeta antes de la escala", kind: "flag" },
  product_unit_incentive: { label: "Incentivo por producto (RD$/unidad)", kind: "fixed" },
  cleaning_contribution: { label: "Aporte de limpieza (RD$)", kind: "fixed" },
  fixed_incentive: { label: "Incentivo fijo (RD$)", kind: "fixed" },
}
const GROUP_ORDER = ["card_percentage", "category_commission", "laser_scale", "laser_split_mode", "laser_weight_personas", "laser_weight_pacientes", "laser_zero_patients_fixed", "laser_card_discount_before_scale", "product_unit_incentive", "cleaning_contribution", "fixed_incentive"]

const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ComisionReglasPage() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canManage = canPerm(user, "sales_commission.rules.manage")

  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Record<string, { pct: string; fixed: string; threshold: string }>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  // Filtros de vigencia (effective_from/effective_to) — consulta, no operación.
  const [vigenteEn, setVigenteEn] = useState("")
  const [tipoFiltro, setTipoFiltro] = useState("")
  const [estadoFiltro, setEstadoFiltro] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionRules" })
      if (res?.ok) {
        const list = (res.records as Rule[]) || []
        setRules(list)
        const e: typeof edit = {}
        list.forEach((r) => {
          e[r.id] = {
            pct: r.percentage == null ? "" : String(Math.round(r.percentage * 10000) / 100),
            fixed: r.fixedAmount == null ? "" : String(r.fixedAmount),
            threshold: r.minAmount == null ? "" : String(r.minAmount),
          }
        })
        setEdit(e)
      } else showToast((res as { error?: string })?.error || "No se pudieron cargar las reglas", "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally {
      setLoading(false)
    }
  }, [apiUrl, showToast])
  useEffect(() => { void load() }, [load])

  const setE = (id: string, patch: Partial<{ pct: string; fixed: string; threshold: string }>) =>
    setEdit((p) => ({ ...p, [id]: { ...(p[id] || { pct: "", fixed: "", threshold: "" }), ...patch } }))

  const save = async (r: Rule) => {
    if (!canManage) return
    setSavingId(r.id)
    try {
      const e = edit[r.id] || { pct: "", fixed: "", threshold: "" }
      const payload: Record<string, string> = { action: "saveCommissionRule", id: r.id, name: r.name, ruleType: r.ruleType }
      if (r.category) payload.category = r.category
      const kind = RULE_GROUP[r.ruleType]?.kind
      if (kind === "pct") payload.percentage = String((Number(e.pct) || 0) / 100)
      if (kind === "laser") { payload.percentage = String((Number(e.pct) || 0) / 100); payload.minAmount = String(Number(e.threshold) || 0) }
      if (kind === "fixed" || kind === "flag") payload.fixedAmount = String(Number(e.fixed) || 0)
      const res = await apiJsonp(normalizeApiUrl(apiUrl), payload)
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo guardar")
      showToast("Regla actualizada", "success")
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al guardar", "error")
    } finally {
      setSavingId(null)
    }
  }

  const toggleActive = async (r: Rule) => {
    if (!canManage) return
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "setCommissionRuleActive", id: r.id, active: r.active ? "false" : "true" })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo cambiar")
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error")
    }
  }

  // Vigencia: regla vigente en la fecha X si effective_from ≤ X ≤ effective_to.
  const visibles = rules.filter((r) => {
    if (tipoFiltro && r.ruleType !== tipoFiltro) return false
    if (estadoFiltro === "activa" && !r.active) return false
    if (estadoFiltro === "inactiva" && r.active) return false
    if (vigenteEn) {
      const from = String(r.effectiveFrom || "").slice(0, 10)
      const to = String(r.effectiveTo || "").slice(0, 10)
      if (from && from > vigenteEn) return false
      if (to && to < vigenteEn) return false
    }
    return true
  })
  const grouped = GROUP_ORDER.map((g) => ({ type: g, rules: visibles.filter((r) => r.ruleType === g) })).filter((g) => g.rules.length)

  // Validación: los pesos de reparto láser deben sumar 100% (solo en modo pesos;
  // en modo equitativo los pesos no aplican).
  const modeFlag = rules.find((r) => r.ruleType === "laser_split_mode" && r.active)?.fixedAmount
  const isEquitativo = modeFlag == null ? true : Number(modeFlag) !== 0
  const wPer = rules.find((r) => r.ruleType === "laser_weight_personas" && r.active)?.percentage
  const wPac = rules.find((r) => r.ruleType === "laser_weight_pacientes" && r.active)?.percentage
  const weightsSum = wPer != null || wPac != null ? Math.round((Number(wPer || 0) + Number(wPac || 0)) * 100) : null
  const weightsBad = !isEquitativo && weightsSum != null && weightsSum !== 100

  return (
    <div className="space-y-5">
      {weightsBad ? (
        <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-3.5 w-3.5" />Los pesos de reparto láser suman {weightsSum}% (deben sumar 100%: personas {Math.round(Number(wPer || 0) * 100)}% + pacientes {Math.round(Number(wPac || 0) * 100)}%). Ajústalos abajo.
        </div>
      ) : null}
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="h-4 w-4 text-[color:var(--brand-primary)]" /> Reglas de comisión
            <Badge variant="secondary">{rules.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {!canManage ? <span className="text-xs text-muted-foreground">Solo lectura (sin permiso de gestión)</span> : null}
            <Button variant="outline" size="sm" className="h-9" onClick={load}><RefreshCcw className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      {/* Filtros de vigencia: "Reglas vigentes al ..." (effective_from/to) */}
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
          <div>
            <label className="text-[11px] font-medium">Vigente en fecha</label>
            <Input type="date" className="mt-0.5 h-9" value={vigenteEn} onChange={(e) => setVigenteEn(e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] font-medium">Tipo de regla</label>
            <select className="mt-0.5 h-9 w-full rounded-md border border-input bg-white px-2 text-sm" value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
              <option value="">Todos</option>
              {GROUP_ORDER.map((g) => <option key={g} value={g}>{RULE_GROUP[g]?.label || g}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium">Estado</label>
            <select className="mt-0.5 h-9 w-full rounded-md border border-input bg-white px-2 text-sm" value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)}>
              <option value="">Todas</option><option value="activa">Activas</option><option value="inactiva">Inactivas</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="h-9 w-full" onClick={() => { setVigenteEn(""); setTipoFiltro(""); setEstadoFiltro("") }}>Limpiar filtros</Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card className="border-[color:var(--brand-border)]"><CardContent className="py-10 text-center text-sm text-muted-foreground">Cargando reglas...</CardContent></Card>
      ) : (
        grouped.map((g) => {
          const meta = RULE_GROUP[g.type]
          return (
            <Card key={g.type} className="border-[color:var(--brand-border)]">
              <CardContent className="p-0">
                <div className="border-b px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">{meta?.label || g.type}</div>
                <div className="divide-y">
                  {g.rules.map((r) => {
                    const e = edit[r.id] || { pct: "", fixed: "", threshold: "" }
                    return (
                      <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{r.name}</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {r.category ? `Categoría: ${r.category}` : ""}{r.branch ? ` · Sucursal: ${r.branch}` : ""}
                            {meta?.kind === "laser" && r.minAmount != null ? `Umbral: ${fmtRD(r.minAmount)}` : ""}
                          </div>
                        </div>
                        {meta?.kind === "laser" ? (
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] text-muted-foreground">Umbral</span>
                            <Input className="h-8 w-28" type="number" value={e.threshold} disabled={!canManage} onChange={(ev) => setE(r.id, { threshold: ev.target.value })} />
                          </div>
                        ) : null}
                        {meta?.kind === "flag" ? (
                          <div className="flex items-center gap-1">
                            {(["1", "0"] as const).map((val) => (
                              <button key={val} type="button" disabled={!canManage}
                                onClick={() => setE(r.id, { fixed: val })}
                                className={`rounded-md border px-2.5 py-1 text-xs ${e.fixed === val ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)] text-white" : "border-input bg-white text-slate-600"} ${canManage ? "cursor-pointer" : "cursor-default"}`}>
                                {val === "1" ? "Sí" : "No"}
                              </button>
                            ))}
                          </div>
                        ) : (meta?.kind === "pct" || meta?.kind === "laser") ? (
                          <div className="flex items-center gap-1">
                            <Input className="h-8 w-20 text-right" type="number" step="0.01" value={e.pct} disabled={!canManage} onChange={(ev) => setE(r.id, { pct: ev.target.value })} />
                            <span className="text-sm text-muted-foreground">%</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="text-sm text-muted-foreground">RD$</span>
                            <Input className="h-8 w-24 text-right" type="number" step="0.01" value={e.fixed} disabled={!canManage} onChange={(ev) => setE(r.id, { fixed: ev.target.value })} />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleActive(r)}
                          disabled={!canManage}
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${r.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"} ${canManage ? "cursor-pointer" : "cursor-default"}`}
                        >
                          {r.active ? "Activa" : "Inactiva"}
                        </button>
                        {canManage ? (
                          <Button size="sm" className="h-8" disabled={savingId === r.id} onClick={() => save(r)}>
                            {savingId === r.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}Guardar
                          </Button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )
        })
      )}

      {/* Personal elegible para el incentivo láser (roster editable) */}
      <LaserPersonnelEditor />
    </div>
  )
}
