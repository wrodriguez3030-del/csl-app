"use client"

/**
 * PERSONAL QUE APLICA INCENTIVO LÁSER — editor del roster
 * (`sales_commission_collaborators`). No hardcodea nombres: alta/edición/baja
 * por sucursal, con "Aplica láser" (servicio DEPILACIÓN LÁSER) y activo/inactivo.
 * Reutilizable en Reglas de comisión y en la pantalla de Comisión láser.
 */
import { useCallback, useEffect, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { useCommissionBranches } from "@/hooks/use-commission-branches"
import { canPerm } from "@/lib/permissions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Users, Loader2, Plus, Trash2, RefreshCcw } from "lucide-react"

interface Collab {
  id: string; name: string; branch: string; services: string[]
  active: boolean; evaluationPct: number; cleaningContribution: number
  bonusExtra: number; productUnitAmount: number | null
}

export function LaserPersonnelEditor() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canManage = canPerm(user, "sales_commission.rules.manage")
  const BRANCHES = useCommissionBranches()

  const [rows, setRows] = useState<Collab[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [branchFilter, setBranchFilter] = useState("")
  const [nuevo, setNuevo] = useState({ name: "", branch: "", appliesLaser: true, active: true })
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionCollaborators", includeInactive: "1", ...(branchFilter ? { branch: branchFilter } : {}) })
      if (res?.ok) setRows(((res.records as Collab[]) || []))
      else showToast((res as { error?: string })?.error || "Error", "error")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast, branchFilter])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!nuevo.branch && BRANCHES.length) setNuevo((p) => ({ ...p, branch: BRANCHES[0] }))
  }, [BRANCHES, nuevo.branch])

  const applies = (c: Collab) => c.services?.includes("DEPILACION_LASER")

  const saveRow = async (c: Collab, patch: Partial<{ appliesLaser: boolean; active: boolean; evaluationPct: number; cleaningContribution: number; bonusExtra: number; productUnitAmount: number | null; branch: string }>) => {
    if (!canManage) return
    setBusyId(c.id)
    try {
      const prodRate = patch.productUnitAmount !== undefined ? patch.productUnitAmount : c.productUnitAmount
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "saveCommissionCollaborator", id: c.id, name: c.name, branch: patch.branch ?? c.branch,
        appliesLaser: (patch.appliesLaser ?? applies(c)) ? "1" : "0",
        active: (patch.active ?? c.active) ? "1" : "0",
        evaluationPct: String(patch.evaluationPct ?? c.evaluationPct),
        cleaningContribution: String(patch.cleaningContribution ?? c.cleaningContribution),
        bonusExtra: String(patch.bonusExtra ?? c.bonusExtra ?? 0),
        productUnitAmount: prodRate == null ? "" : String(prodRate),
      })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo guardar")
      invalidateReadCache("getCommissionLaserDetail"); invalidateReadCache("getCommissionRunPreview")
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setBusyId(null) }
  }

  const del = async (c: Collab) => {
    if (!canManage) return
    if (!window.confirm(`¿Dar de baja a ${c.name} (${c.branch})? No se borra el histórico; deja de participar.`)) return
    setBusyId(c.id)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "deleteCommissionCollaborator", id: c.id, reason: "baja desde UI" })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo dar de baja")
      showToast("Colaborador dado de baja", "success")
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setBusyId(null) }
  }

  const add = async () => {
    if (!canManage) return
    if (!nuevo.name.trim()) { showToast("Escribe el nombre del empleado", "error"); return }
    if (!nuevo.branch.trim()) { showToast("Selecciona la sucursal", "error"); return }
    setAdding(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "saveCommissionCollaborator", name: nuevo.name.trim(), branch: nuevo.branch,
        appliesLaser: nuevo.appliesLaser ? "1" : "0", active: nuevo.active ? "1" : "0",
      })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo agregar")
      showToast("Empleado agregado", "success")
      setNuevo({ name: "", branch: nuevo.branch, appliesLaser: true, active: true })
      invalidateReadCache("getCommissionLaserDetail")
      await load()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setAdding(false) }
  }

  const Toggle = ({ on, onClick, disabled, labelOn = "Sí", labelOff = "No" }: { on: boolean; onClick: () => void; disabled?: boolean; labelOn?: string; labelOff?: string }) => (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"} ${disabled ? "cursor-default opacity-70" : "cursor-pointer"}`}>
      {on ? labelOn : labelOff}
    </button>
  )

  return (
    <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Users className="h-4 w-4 text-[color:var(--brand-primary)]" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Personal que aplica incentivo láser</span>
        <Badge variant="secondary">{rows.length}</Badge>
        <select className="ml-auto h-8 rounded-md border border-input bg-white px-2 text-sm" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
          <option value="">Todas las sucursales</option>
          {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <Button size="sm" variant="outline" className="h-8" onClick={load}><RefreshCcw className="h-3.5 w-3.5" /></Button>
      </div>

      {loading ? <div className="py-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
            <th className="px-3 py-2">#</th><th className="px-2 py-2">Empleado</th><th className="px-2 py-2">Sucursal</th>
            <th className="px-2 py-2 text-center">Aplica láser</th><th className="px-2 py-2 text-center">Activo</th>
            <th className="px-2 py-2 text-right">Eval.%</th><th className="px-2 py-2 text-right">Limpieza</th>
            <th className="px-2 py-2 text-right" title="Bono extra RD$ del mes">Bono</th>
            <th className="px-2 py-2 text-right" title="Tarifa RD$/unidad de producto; vacío = regla general (RD$100)">Prod. RD$/u</th>
            <th className="px-3 py-2 text-right">Acciones</th>
          </tr></thead>
          <tbody>{rows.map((c, i) => (
            <tr key={c.id} className={`border-b last:border-0 ${!c.active ? "bg-slate-50/60 text-muted-foreground" : ""}`}>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
              <td className="px-2 py-2 font-medium">{c.name}</td>
              <td className="px-2 py-2 text-xs">
                {canManage ? (
                  <select
                    className="h-7 rounded-md border border-input bg-white px-1 text-xs"
                    value={c.branch}
                    disabled={busyId === c.id}
                    title="Cambiar de sucursal"
                    onChange={(e) => { if (e.target.value !== c.branch) void saveRow(c, { branch: e.target.value }) }}
                  >
                    {(BRANCHES.includes(c.branch) ? BRANCHES : [c.branch, ...BRANCHES]).map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                ) : c.branch}
              </td>
              <td className="px-2 py-2 text-center"><Toggle on={applies(c)} disabled={!canManage || busyId === c.id} onClick={() => saveRow(c, { appliesLaser: !applies(c) })} /></td>
              <td className="px-2 py-2 text-center"><Toggle on={c.active} disabled={!canManage || busyId === c.id} onClick={() => saveRow(c, { active: !c.active })} labelOn="Activo" labelOff="Inactivo" /></td>
              <td className="px-2 py-2 text-right">
                <Input className="ml-auto h-7 w-16 text-right" type="number" defaultValue={c.evaluationPct} disabled={!canManage}
                  onBlur={(e) => { const v = Number(e.target.value); if (v !== c.evaluationPct) void saveRow(c, { evaluationPct: v }) }} />
              </td>
              <td className="px-2 py-2 text-right">
                <Input className="ml-auto h-7 w-20 text-right" type="number" defaultValue={c.cleaningContribution} disabled={!canManage}
                  onBlur={(e) => { const v = Number(e.target.value); if (v !== c.cleaningContribution) void saveRow(c, { cleaningContribution: v }) }} />
              </td>
              <td className="px-2 py-2 text-right">
                <Input className="ml-auto h-7 w-20 text-right" type="number" defaultValue={c.bonusExtra || 0} disabled={!canManage}
                  onBlur={(e) => { const v = Number(e.target.value); if (v !== (c.bonusExtra || 0)) void saveRow(c, { bonusExtra: v }) }} />
              </td>
              <td className="px-2 py-2 text-right">
                <Input className="ml-auto h-7 w-20 text-right" type="number" placeholder="100" defaultValue={c.productUnitAmount ?? ""} disabled={!canManage}
                  onBlur={(e) => { const raw = e.target.value.trim(); const v = raw === "" ? null : Number(raw); if (v !== (c.productUnitAmount ?? null)) void saveRow(c, { productUnitAmount: v }) }} />
              </td>
              <td className="px-3 py-2 text-right">
                {canManage ? <Button size="sm" variant="ghost" className="h-7 text-red-600 hover:bg-red-50" disabled={busyId === c.id} onClick={() => del(c)}><Trash2 className="h-3.5 w-3.5" /></Button> : null}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-end gap-2 border-t bg-slate-50/50 px-4 py-3">
          <div><label className="text-[11px] font-medium">Empleado</label><Input className="mt-0.5 h-8 w-48" value={nuevo.name} onChange={(e) => setNuevo((p) => ({ ...p, name: e.target.value }))} placeholder="Nombre" /></div>
          <div><label className="text-[11px] font-medium">Sucursal</label>
            <select className="mt-0.5 h-8 w-40 rounded-md border border-input bg-white px-2 text-sm" value={nuevo.branch} onChange={(e) => setNuevo((p) => ({ ...p, branch: e.target.value }))}>{BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          </div>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={nuevo.appliesLaser} onChange={(e) => setNuevo((p) => ({ ...p, appliesLaser: e.target.checked }))} /> Aplica láser</label>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={nuevo.active} onChange={(e) => setNuevo((p) => ({ ...p, active: e.target.checked }))} /> Activo</label>
          <Button size="sm" className="h-8" disabled={adding} onClick={add}>{adding ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}Agregar</Button>
        </div>
      ) : null}
    </CardContent></Card>
  )
}
