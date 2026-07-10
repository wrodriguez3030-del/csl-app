"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { UserCog, RefreshCcw, ArrowUpDown } from "lucide-react"
import { CommissionFilterBar, useCommissionFilters } from "./comision-filter-bar"

interface Calc {
  id: string; provider: string; branch: string; periodMonth: number; periodYear: number
  productsCount: number; productIncentive: number; serviceCommission: number; laserIncentive: number
  fixedIncentive: number; manualAdjustment: number; bonusExtra: number; cleaningContribution: number; netTotal: number
}
const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Col = { key: keyof Calc; label: string; num?: boolean; money?: boolean }
const COLS: Col[] = [
  { key: "provider", label: "Prestador" },
  { key: "branch", label: "Sucursal" },
  { key: "productsCount", label: "Prod. (u)", num: true },
  { key: "productIncentive", label: "Inc. productos", num: true, money: true },
  { key: "serviceCommission", label: "Com. servicios", num: true, money: true },
  { key: "laserIncentive", label: "Láser", num: true, money: true },
  { key: "manualAdjustment", label: "Ajuste", num: true, money: true },
  { key: "bonusExtra", label: "Bono", num: true, money: true },
  { key: "cleaningContribution", label: "Limpieza", num: true, money: true },
  { key: "netTotal", label: "Neto", num: true, money: true },
]

export function ComisionPrestadoresPage() {
  const { apiUrl, showToast } = useAppStore()
  const { params } = useCommissionFilters()
  const [items, setItems] = useState<Calc[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<{ key: keyof Calc; dir: 1 | -1 }>({ key: "netTotal", dir: -1 })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionCalculations", ...params })
      if (res?.ok) setItems((res.records as Calc[]) || [])
      else showToast((res as { error?: string })?.error || "Error", "error")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
  }, [apiUrl, showToast, params])
  useEffect(() => { void load() }, [load])
  const providerOptions = [...new Set(items.map((c) => c.provider).filter(Boolean))].sort()

  const sorted = useMemo(() => {
    const arr = [...items]
    arr.sort((a, b) => {
      const va = a[sort.key], vb = b[sort.key]
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sort.dir
      return String(va).localeCompare(String(vb)) * sort.dir
    })
    return arr
  }, [items, sort])

  const toggleSort = (key: keyof Calc) => setSort((s) => s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 })

  const totalNet = items.reduce((s, c) => s + c.netTotal, 0)

  return (
    <div className="space-y-5">
      <CommissionFilterBar branches={["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]} providers={providerOptions} />
      <Card className="border-[color:var(--brand-border)]"><CardContent className="flex items-center gap-2 p-3 text-sm font-semibold sm:p-4">
        <UserCog className="h-4 w-4 text-[color:var(--brand-primary)]" /> Comisiones por prestador
        <Badge variant="secondary">{items.length}</Badge>
        <span className="ml-2 text-xs font-normal text-muted-foreground">Neto total: <b className="text-foreground">{fmtRD(totalNet)}</b></span>
        <Button variant="outline" size="sm" className="ml-auto h-9" onClick={load}><RefreshCcw className="h-4 w-4" /></Button>
      </CardContent></Card>

      <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
        {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
          : items.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No hay cálculos. Importa un archivo de ventas primero.</div>
          : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                <th className="px-3 py-2 text-center">#</th>
                {COLS.map((c) => (
                  <th key={String(c.key)} className={`px-2 py-2 ${c.num ? "text-right" : ""}`}>
                    <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.key)}>{c.label}<ArrowUpDown className="h-3 w-3 opacity-50" /></button>
                  </th>
                ))}
              </tr></thead>
              <tbody>{sorted.map((r, i) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{i + 1}</td>
                  {COLS.map((c) => {
                    const v = r[c.key]
                    return <td key={String(c.key)} className={`px-2 py-2 ${c.num ? "text-right tabular-nums" : "font-medium"}`}>{c.money ? fmtRD(Number(v) || 0) : String(v ?? "")}</td>
                  })}
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </CardContent></Card>
    </div>
  )
}
