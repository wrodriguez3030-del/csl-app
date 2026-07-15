"use client"

/**
 * Servicios SIN PRESTADOR (Incentivos de Ventas): filas de venta de servicios
 * donde el archivo no trae prestador comisionable (vacío, "Sin Información",
 * recepción/POS). Excluye Depilación Láser (va por fondo) y productos.
 * Permite asignar MANUALMENTE el prestador correcto: la asignación actualiza la
 * venta y suma el delta de comisión (venta × % de la categoría) a la
 * liquidación del prestador en el período. La vista "Asignadas" permite revisar
 * y DESHACER (revierte el delta). Requiere `sales_commission.adjust`.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { UserX, UserCheck, Loader2, RefreshCcw, Search, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"
import { CATEGORY_LABELS } from "@/lib/commission/classification"
import { normalizeName } from "@/lib/commission/normalize"
import { CommissionFilterBar, useCommissionFilters } from "./comision-filter-bar"

const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface UnassignedRow {
  id: string; date: string; branch: string; customer: string
  service: string; category: string; amount: number; providerOriginal: string
  // solo en la vista "Asignadas"
  provider?: string; assignedBy?: string; assignedAt?: string
}
interface Collab { id: string; name: string; branch: string; active: boolean }

type SortKey = "date" | "branch" | "customer" | "service" | "category" | "amount"

function SortableTh({ label, k, sortKey, sortDir, onSort, right }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc"
  onSort: (k: SortKey) => void; right?: boolean
}) {
  const active = sortKey === k
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown
  return (
    <th className={`py-2 ${right ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground ${active ? "text-foreground" : ""}`}
        title={`Ordenar por ${label}`}
      >
        {right ? <Icon className="h-3 w-3" /> : null}
        {label}
        {!right ? <Icon className="h-3 w-3" /> : null}
      </button>
    </th>
  )
}

export function ComisionSinPrestadorPage() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canAssign = canPerm(user, "sales_commission.adjust")
  const { params, label: periodDisplay } = useCommissionFilters()

  const [mode, setMode] = useState<"pendientes" | "asignadas">("pendientes")
  const [rows, setRows] = useState<UnassignedRow[]>([])
  const [totals, setTotals] = useState({ count: 0, amount: 0 })
  const [aRows, setARows] = useState<UnassignedRow[]>([])
  const [aTotals, setATotals] = useState({ count: 0, amount: 0 })
  const [collabs, setCollabs] = useState<Collab[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [provider, setProvider] = useState("")
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(false)
  const [search, setSearch] = useState("")
  const [catFilter, setCatFilter] = useState("todas")
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const load = useCallback(async () => {
    setLoading(true)
    setSelected(new Set())
    try {
      const [res, asg, col] = await Promise.all([
        apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionUnassignedServices", ...params }),
        apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionAssignedServices", ...params }),
        apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionCollaborators" }),
      ])
      if (res?.ok) {
        setRows((res.rows as UnassignedRow[]) || [])
        setTotals((res.totals as { count: number; amount: number }) || { count: 0, amount: 0 })
      } else showToast((res as { error?: string })?.error || "Error", "error")
      if (asg?.ok) {
        setARows((asg.rows as UnassignedRow[]) || [])
        setATotals((asg.totals as { count: number; amount: number }) || { count: 0, amount: 0 })
      }
      if (col?.ok) setCollabs(((col.records as Collab[]) || []).filter((c) => c.active))
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally { setLoading(false) }
  }, [apiUrl, params, showToast])
  useEffect(() => { void load() }, [load])

  const isAssignedView = mode === "asignadas"
  const activeRows = isAssignedView ? aRows : rows
  const activeTotals = isAssignedView ? aTotals : totals
  const switchMode = (m: "pendientes" | "asignadas") => { setMode(m); setSelected(new Set()) }

  // Filtros de servicio/categoría + orden por columna (client-side).
  const categories = useMemo(
    () => Array.from(new Set(activeRows.map((r) => r.category))).sort((a, b) => (CATEGORY_LABELS[a] || a).localeCompare(CATEGORY_LABELS[b] || b)),
    [activeRows],
  )
  const view = useMemo(() => {
    const q = normalizeName(search)
    let list = activeRows
    if (catFilter !== "todas") list = list.filter((r) => r.category === catFilter)
    if (q) list = list.filter((r) => normalizeName(r.service).includes(q) || normalizeName(r.customer).includes(q) || normalizeName(r.provider || "").includes(q))
    const dir = sortDir === "asc" ? 1 : -1
    return [...list].sort((a, b) => {
      if (sortKey === "amount") return (a.amount - b.amount) * dir
      const av = sortKey === "category" ? (CATEGORY_LABELS[a.category] || a.category) : a[sortKey]
      const bv = sortKey === "category" ? (CATEGORY_LABELS[b.category] || b.category) : b[sortKey]
      return String(av).localeCompare(String(bv)) * dir || a.date.localeCompare(b.date)
    })
  }, [activeRows, search, catFilter, sortKey, sortDir])
  const viewAmount = useMemo(() => view.reduce((s, r) => s + r.amount, 0), [view])
  const filtered = view.length !== activeRows.length

  const requestSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("asc") }
  }

  const allSelected = view.length > 0 && view.every((r) => selected.has(r.id))
  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev)
    if (allSelected) view.forEach((r) => next.delete(r.id))
    else view.forEach((r) => next.add(r.id))
    return next
  })
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const selectedAmount = useMemo(
    () => activeRows.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.amount, 0),
    [activeRows, selected],
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

  const unassign = async () => {
    if (!selected.size) return
    setAssigning(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "unassignCommissionSaleProvider", ids: [...selected].join(","),
      })
      if (res?.ok) {
        const deltas = (res.deltas as { provider: string; delta: number }[]) || []
        const deltaTotal = deltas.reduce((s, d) => s + d.delta, 0)
        showToast(`${res.updated} asignación(es) deshecha(s)${deltaTotal ? ` · comisión −${fmtRD(deltaTotal)}` : ""}`, "success")
        await load()
      } else showToast((res as { error?: string })?.error || "Error al deshacer", "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al deshacer", "error")
    } finally { setAssigning(false) }
  }

  return (
    <div className="space-y-5">
      <CommissionFilterBar branches={["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]} />

      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <UserX className="h-4 w-4 text-[color:var(--brand-primary)]" /> Servicios sin prestador
            <Badge variant="secondary">{totals.count} pendientes</Badge>
            <Badge className="border-amber-200 bg-amber-100 text-amber-700 hover:bg-amber-100">{fmtRD(totals.amount)} sin comisionar</Badge>
            {aTotals.count > 0 && <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{aTotals.count} asignados</Badge>}
            <span className="text-xs font-normal text-muted-foreground">Período: <b className="text-foreground">{periodDisplay}</b> · excluye Depilación Láser y productos</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border">
              <button type="button" onClick={() => switchMode("pendientes")}
                className={`px-3 py-1.5 text-xs font-semibold ${!isAssignedView ? "bg-[color:var(--brand-primary)] text-white" : "bg-background text-muted-foreground hover:text-foreground"}`}>
                Pendientes ({totals.count})
              </button>
              <button type="button" onClick={() => switchMode("asignadas")}
                className={`px-3 py-1.5 text-xs font-semibold ${isAssignedView ? "bg-[color:var(--brand-primary)] text-white" : "bg-background text-muted-foreground hover:text-foreground"}`}>
                Asignadas ({aTotals.count})
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="h-9 w-64 pl-8" placeholder={isAssignedView ? "Buscar servicio, cliente o prestador..." : "Buscar servicio o cliente..."} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las categorías</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c] || c}</SelectItem>)}
              </SelectContent>
            </Select>
            {!isAssignedView ? (
              <>
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
              </>
            ) : (
              <Button variant="outline" className="h-9 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={unassign} disabled={!canAssign || !selected.size || assigning}>
                {assigning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserX className="mr-1.5 h-4 w-4" />}
                Quitar asignación ({selected.size}{selected.size ? ` · ${fmtRD(selectedAmount)}` : ""})
              </Button>
            )}
            <Button variant="outline" className="h-9" onClick={load} disabled={loading}><RefreshCcw className="mr-1.5 h-4 w-4" />Actualizar</Button>
          </div>
          {!canAssign ? <div className="text-xs text-amber-600">Necesitas el permiso <code>sales_commission.adjust</code> para asignar o quitar prestadores.</div> : null}
        </CardContent>
      </Card>

      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-3 sm:p-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
          ) : activeRows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {isAssignedView ? `Sin asignaciones manuales para ${periodDisplay}.` : `Sin servicios pendientes de prestador para ${periodDisplay}. ✔`}
            </div>
          ) : view.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Ningún servicio coincide con la búsqueda/categoría. ({activeRows.length} en el período)</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="w-8 py-2"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Seleccionar todo lo visible" /></th>
                    <SortableTh label="Fecha" k="date" sortKey={sortKey} sortDir={sortDir} onSort={requestSort} />
                    <SortableTh label="Sucursal" k="branch" sortKey={sortKey} sortDir={sortDir} onSort={requestSort} />
                    <SortableTh label="Cliente" k="customer" sortKey={sortKey} sortDir={sortDir} onSort={requestSort} />
                    <SortableTh label="Servicio" k="service" sortKey={sortKey} sortDir={sortDir} onSort={requestSort} />
                    <SortableTh label="Categoría" k="category" sortKey={sortKey} sortDir={sortDir} onSort={requestSort} />
                    {isAssignedView ? (
                      <>
                        <th className="py-2 text-left">Prestador asignado</th>
                        <th className="py-2 text-left">Asignado por</th>
                      </>
                    ) : (
                      <th className="py-2 text-left">Prestador (archivo)</th>
                    )}
                    <SortableTh label="Monto" k="amount" sortKey={sortKey} sortDir={sortDir} onSort={requestSort} right />
                  </tr>
                </thead>
                <tbody>
                  {view.map((r) => (
                    <tr key={r.id} className={`border-b last:border-0 ${selected.has(r.id) ? "bg-[color:var(--brand-primary)]/5" : ""}`}>
                      <td className="py-1.5"><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={`Seleccionar ${r.service}`} /></td>
                      <td className="py-1.5 whitespace-nowrap">{r.date}</td>
                      <td className="py-1.5">{r.branch}</td>
                      <td className="py-1.5">{r.customer || <span className="text-slate-300">—</span>}</td>
                      <td className="py-1.5 font-medium">{r.service}</td>
                      <td className="py-1.5">{CATEGORY_LABELS[r.category] || r.category}</td>
                      {isAssignedView ? (
                        <>
                          <td className="py-1.5 font-semibold text-emerald-700">{r.provider}</td>
                          <td className="py-1.5 text-xs text-muted-foreground">{r.assignedBy}<br />{r.assignedAt}</td>
                        </>
                      ) : (
                        <td className="py-1.5 text-muted-foreground">{r.providerOriginal || <span className="text-slate-300">(vacío)</span>}</td>
                      )}
                      <td className="py-1.5 text-right tabular-nums">{fmtRD(r.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-slate-50 font-bold">
                    <td colSpan={isAssignedView ? 8 : 7} className="py-2 text-xs uppercase">{filtered ? `Total filtrado (${view.length} de ${activeRows.length})` : "Total"}</td>
                    <td className="py-2 text-right tabular-nums">{fmtRD(filtered ? viewAmount : activeTotals.amount)}</td>
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
