"use client"

/**
 * Servicios SIN PRESTADOR (Incentivos de Ventas): filas de venta de servicios
 * donde el archivo no trae prestador comisionable (vacío, "Sin Información",
 * recepción/POS). Excluye Depilación Láser (va por fondo) y productos.
 * Permite asignar MANUALMENTE el prestador correcto: la asignación actualiza la
 * venta y suma el delta de comisión (venta × % de la categoría) a la
 * liquidación del prestador en el período. Requiere `sales_commission.adjust`.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { UserX, UserCheck, Loader2, RefreshCcw } from "lucide-react"
import { CATEGORY_LABELS } from "@/lib/commission/classification"
import { CommissionFilterBar, useCommissionFilters } from "./comision-filter-bar"

const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface UnassignedRow {
  id: string; date: string; branch: string; customer: string
  service: string; category: string; amount: number; providerOriginal: string
}
interface Collab { id: string; name: string; branch: string; active: boolean }

export function ComisionSinPrestadorPage() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canAssign = canPerm(user, "sales_commission.adjust")
  const { params, label: periodDisplay } = useCommissionFilters()

  const [rows, setRows] = useState<UnassignedRow[]>([])
  const [totals, setTotals] = useState({ count: 0, amount: 0 })
  const [collabs, setCollabs] = useState<Collab[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [provider, setProvider] = useState("")
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setSelected(new Set())
    try {
      const [res, col] = await Promise.all([
        apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionUnassignedServices", ...params }),
        apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionCollaborators" }),
      ])
      if (res?.ok) {
        setRows((res.rows as UnassignedRow[]) || [])
        setTotals((res.totals as { count: number; amount: number }) || { count: 0, amount: 0 })
      } else showToast((res as { error?: string })?.error || "Error", "error")
      if (col?.ok) setCollabs(((col.records as Collab[]) || []).filter((c) => c.active))
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally { setLoading(false) }
  }, [apiUrl, params, showToast])
  useEffect(() => { void load() }, [load])

  const allSelected = rows.length > 0 && selected.size === rows.length
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const selectedAmount = useMemo(
    () => rows.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.amount, 0),
    [rows, selected],
  )

  const assign = async () => {
    if (!provider || !selected.size) return
    setAssigning(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "assignCommissionSaleProvider", provider, ids: [...selected].join(","),
      })
      if (res?.ok) {
        const deltas = (res.deltas as { month: number; year: number; delta: number }[]) || []
        const deltaTotal = deltas.reduce((s, d) => s + d.delta, 0)
        showToast(`${res.updated} venta(s) asignada(s) a ${res.provider}${deltaTotal ? ` · comisión +${fmtRD(deltaTotal)}` : ""}`, "success")
        await load()
      } else showToast((res as { error?: string })?.error || "Error al asignar", "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al asignar", "error")
    } finally { setAssigning(false) }
  }

  return (
    <div className="space-y-5">
      <CommissionFilterBar branches={["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]} />

      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <UserX className="h-4 w-4 text-[color:var(--brand-primary)]" /> Servicios sin prestador
            <Badge variant="secondary">{totals.count} servicios</Badge>
            <Badge className="border-amber-200 bg-amber-100 text-amber-700 hover:bg-amber-100">{fmtRD(totals.amount)} sin comisionar</Badge>
            <span className="text-xs font-normal text-muted-foreground">Período: <b className="text-foreground">{periodDisplay}</b> · excluye Depilación Láser y productos</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={provider || "none"} onValueChange={(v) => setProvider(v === "none" ? "" : v)}>
              <SelectTrigger className="h-9 w-64"><SelectValue placeholder="Prestador a asignar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Selecciona prestador —</SelectItem>
                {collabs.map((c) => <SelectItem key={c.id} value={c.name}>{c.name} · {c.branch}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button className="h-9" onClick={assign} disabled={!canAssign || !provider || !selected.size || assigning}>
              {assigning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserCheck className="mr-1.5 h-4 w-4" />}
              Asignar a seleccionadas ({selected.size}{selected.size ? ` · ${fmtRD(selectedAmount)}` : ""})
            </Button>
            <Button variant="outline" className="h-9" onClick={load} disabled={loading}><RefreshCcw className="mr-1.5 h-4 w-4" />Actualizar</Button>
          </div>
          {!canAssign ? <div className="text-xs text-amber-600">Necesitas el permiso <code>sales_commission.adjust</code> para asignar prestadores.</div> : null}
        </CardContent>
      </Card>

      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-3 sm:p-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin servicios pendientes de prestador para {periodDisplay}. ✔</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="w-8 py-2"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Seleccionar todo" /></th>
                    <th className="py-2 text-left">Fecha</th>
                    <th className="py-2 text-left">Sucursal</th>
                    <th className="py-2 text-left">Cliente</th>
                    <th className="py-2 text-left">Servicio</th>
                    <th className="py-2 text-left">Categoría</th>
                    <th className="py-2 text-left">Prestador (archivo)</th>
                    <th className="py-2 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={`border-b last:border-0 ${selected.has(r.id) ? "bg-[color:var(--brand-primary)]/5" : ""}`}>
                      <td className="py-1.5"><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={`Seleccionar ${r.service}`} /></td>
                      <td className="py-1.5 whitespace-nowrap">{r.date}</td>
                      <td className="py-1.5">{r.branch}</td>
                      <td className="py-1.5">{r.customer || <span className="text-slate-300">—</span>}</td>
                      <td className="py-1.5 font-medium">{r.service}</td>
                      <td className="py-1.5">{CATEGORY_LABELS[r.category] || r.category}</td>
                      <td className="py-1.5 text-muted-foreground">{r.providerOriginal || <span className="text-slate-300">(vacío)</span>}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtRD(r.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-slate-50 font-bold">
                    <td colSpan={7} className="py-2 text-xs uppercase">Total</td>
                    <td className="py-2 text-right tabular-nums">{fmtRD(totals.amount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
