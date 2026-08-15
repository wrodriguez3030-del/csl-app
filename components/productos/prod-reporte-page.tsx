"use client"

/**
 * Inventario de Productos › Reporte de existencias.
 *
 * Marcas una o varias sucursales y sale el PDF con el formato del modelo
 * impreso: encabezado con la marca del negocio, tres KPIs, tabla ordenada de
 * mayor a menor y la nota «Stock bajo». Con varias sucursales se imprime una
 * página por sucursal y, opcionalmente, una de consolidado.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { useSessionUser } from "@/hooks/use-session-user"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Printer, Loader2, Building2 } from "lucide-react"
import { fmtQty, periodoActual, UMBRAL_STOCK_BAJO } from "@/lib/productos-client"
import { buildReporteData, kpisDeSucursal, printProductosPdf, type StockRecord } from "@/lib/inventario-productos-pdf"

export function ProdReportePage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const sessionUser = useSessionUser()
  const generadoPor = sessionUser?.nombre || sessionUser?.username || ""

  const [sucursales, setSucursales] = useState<string[]>([])
  const [elegidas, setElegidas] = useState<string[]>([])
  const [records, setRecords] = useState<StockRecord[]>([])
  const [periodo, setPeriodo] = useState(periodoActual())
  const [umbral, setUmbral] = useState(String(UMBRAL_STOCK_BAJO))
  const [consolidado, setConsolidado] = useState(true)
  const [soloActivos, setSoloActivos] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "getProductStockReport",
        soloActivos: soloActivos ? "true" : "false",
      })
      if (!res?.ok) throw new Error(String(res?.error || "No se pudieron cargar las existencias"))
      const sucs = (res.sucursales as string[]) || []
      setSucursales(sucs)
      setElegidas((prev) => (prev.length ? prev.filter((s) => sucs.includes(s)) : sucs))
      setRecords((res.records as StockRecord[]) || [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally {
      setLoading(false)
    }
  }, [apiUrl, soloActivos, showToast])

  useEffect(() => { void load() }, [load])

  const umbralNum = useMemo(() => {
    const n = Number(umbral)
    return Number.isFinite(n) && n >= 0 ? n : UMBRAL_STOCK_BAJO
  }, [umbral])

  const data = useMemo(
    () => buildReporteData(records, elegidas),
    [records, elegidas],
  )

  const toggle = (suc: string) => {
    setElegidas((prev) => (prev.includes(suc) ? prev.filter((s) => s !== suc) : [...prev, suc]))
  }

  const imprimir = () => {
    if (!data.length) {
      showToast("Elige al menos una sucursal", "error")
      return
    }
    printProductosPdf({
      data,
      records,
      business,
      periodo: periodo.trim() || periodoActual(),
      umbral: umbralNum,
      origin: window.location.origin,
      generadoPor,
      consolidado,
    })
  }

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-[color:var(--brand-primary)]" /> Sucursales del reporte
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando existencias…
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sucursales.map((s) => {
                const activa = elegidas.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggle(s)}
                    className={`cursor-pointer rounded-xl border px-3 py-2 text-sm transition ${
                      activa
                        ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary-soft)] font-semibold"
                        : "border-[color:var(--brand-border)] text-muted-foreground hover:bg-muted/40"
                    }`}
                  >
                    {s}
                  </button>
                )
              })}
              {sucursales.length === 0 && (
                <p className="text-sm text-muted-foreground">No hay sucursales disponibles.</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Periodo (título del reporte)</Label>
              <Input className="mt-1 h-10" value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="MES AGOSTO" />
            </div>
            <div>
              <Label className="text-xs">Alerta de stock bajo (unidades o menos)</Label>
              <Input className="mt-1 h-10" type="number" min={0} value={umbral} onChange={(e) => setUmbral(e.target.value)} />
            </div>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={consolidado} onCheckedChange={(v) => setConsolidado(v === true)} />
                Incluir página de consolidado
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={soloActivos} onCheckedChange={(v) => setSoloActivos(v === true)} />
                Solo productos activos
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <Button className="h-10" onClick={imprimir} disabled={loading || !elegidas.length}>
              <Printer className="mr-1.5 h-4 w-4" /> Generar PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Vista previa de los KPIs por sucursal — lo mismo que saldrá impreso */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.map((bloque) => {
          const k = kpisDeSucursal(bloque.items, umbralNum)
          return (
            <Card key={bloque.sucursal} className="border-[color:var(--brand-border)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold uppercase tracking-wide">{bloque.sucursal}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Productos</div>
                    <div className="text-xl font-bold tabular-nums">{fmtQty(k.productos)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Unidades</div>
                    <div className="text-xl font-bold tabular-nums">{fmtQty(k.unidades)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Stock bajo</div>
                    <div className="text-xl font-bold tabular-nums text-amber-600">{fmtQty(k.alerta)}</div>
                  </div>
                </div>
                <div className="max-h-52 overflow-y-auto rounded-lg border border-[color:var(--brand-border)]">
                  <table className="w-full text-xs">
                    <tbody>
                      {bloque.items.slice(0, 50).map((it, i) => (
                        <tr key={`${it.nombre}-${i}`} className="border-b border-[color:var(--brand-border)] last:border-0">
                          <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-1">{it.nombre}</td>
                          <td className="px-2 py-1 text-right tabular-nums font-medium">{fmtQty(it.cantidad)}</td>
                          <td className="px-2 py-1 text-right text-amber-700">
                            {it.cantidad <= umbralNum ? "Stock bajo" : ""}
                          </td>
                        </tr>
                      ))}
                      {bloque.items.length === 0 && (
                        <tr><td className="px-2 py-3 text-center text-muted-foreground">Sin existencias</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {bloque.items.length > 50 && (
                  <p className="text-[11px] text-muted-foreground">
                    Vista previa de los primeros 50. El PDF incluye los {bloque.items.length}.
                  </p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
