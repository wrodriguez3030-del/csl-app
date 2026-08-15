"use client"

/**
 * Inventario de Productos › Productos.
 *
 * Catálogo importado con la existencia de cada sucursal en columnas. Buscador
 * por nombre o código, filtro por categoría y por estado. La búsqueda y el
 * filtro se resuelven en el SERVIDOR (la lista puede pasar de 1000 filas y
 * PostgREST corta en seco sin avisar).
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { KpiCard } from "@/components/kpi-card"
import { Search, Package, PackageSearch, Layers, TriangleAlert, Loader2 } from "lucide-react"
import { fmtQty, fmtMoney, UMBRAL_STOCK_BAJO, type ProductoWithStock } from "@/lib/productos-client"

const TODAS = "__todas__"

export function ProdCatalogoPage() {
  const { apiUrl, showToast } = useAppStore()

  const [records, setRecords] = useState<ProductoWithStock[]>([])
  const [sucursales, setSucursales] = useState<string[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [categoria, setCategoria] = useState(TODAS)
  const [soloActivos, setSoloActivos] = useState(true)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "getProductos",
        search: search.trim(),
        categoria: categoria === TODAS ? "" : categoria,
        soloActivos: soloActivos ? "true" : "false",
      })
      if (!res?.ok) throw new Error(String(res?.error || "No se pudo cargar el catálogo"))
      setRecords((res.records as ProductoWithStock[]) || [])
      setSucursales((res.sucursales as string[]) || [])
      setCategorias((res.categorias as string[]) || [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar el catálogo", "error")
    } finally {
      setLoading(false)
    }
  }, [apiUrl, search, categoria, soloActivos, showToast])

  // Debounce del buscador: no dispara una consulta por tecla.
  useEffect(() => {
    const t = setTimeout(() => void load(), 350)
    return () => clearTimeout(t)
  }, [load])

  const kpis = useMemo(() => {
    let unidades = 0
    let conStock = 0
    let bajos = 0
    for (const p of records) {
      unidades += p.total
      if (p.total > 0) conStock += 1
      if (p.total > 0 && p.total <= UMBRAL_STOCK_BAJO) bajos += 1
    }
    return { productos: records.length, conStock, unidades, bajos }
  }, [records])

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-3 sm:p-4">
          <div>
            <Label className="text-xs">Buscar producto</Label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre o código de barra..."
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Categoría</Label>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger className="mt-1 h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas</SelectItem>
                {categorias.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Estado</Label>
            <Select value={soloActivos ? "activos" : "todos"} onValueChange={(v) => setSoloActivos(v === "activos")}>
              <SelectTrigger className="mt-1 h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="activos">Solo activos</SelectItem>
                <SelectItem value="todos">Activos e inactivos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="Productos" value={kpis.productos} icon={Package} />
        <KpiCard title="Con existencia" value={kpis.conStock} icon={PackageSearch} variant="success" />
        <KpiCard title="Unidades totales" value={fmtQty(kpis.unidades)} icon={Layers} />
        <KpiCard title="Stock bajo" value={kpis.bajos} icon={TriangleAlert} variant="warning" description={`${UMBRAL_STOCK_BAJO} unidades o menos`} />
      </div>

      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando catálogo…
            </div>
          ) : records.length === 0 ? (
            <div className="space-y-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                {search || categoria !== TODAS
                  ? "Ningún producto coincide con ese filtro."
                  : "Todavía no has importado productos."}
              </p>
              {!search && categoria === TODAS && (
                <p className="text-xs text-muted-foreground">
                  Ve a <b>Importar Excel</b> y carga el archivo de productos para empezar.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Producto</th>
                    <th className="px-3 py-2 text-left">Código</th>
                    <th className="px-3 py-2 text-left">Categoría</th>
                    {sucursales.map((s) => (
                      <th key={s} className="px-3 py-2 text-right whitespace-nowrap">{s}</th>
                    ))}
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Precio</th>
                    <th className="px-3 py-2 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((p) => (
                    <tr key={p.id} className="border-t border-[color:var(--brand-border)] hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{p.nombre}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.sku || "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.categoria || "—"}</td>
                      {sucursales.map((s) => {
                        const qty = p.stock?.[s] || 0
                        return (
                          <td key={s} className={`px-3 py-2 text-right tabular-nums ${qty === 0 ? "text-muted-foreground" : ""}`}>
                            {fmtQty(qty)}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtQty(p.total)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs">{p.precioExterno == null ? "—" : fmtMoney(p.precioExterno)}</td>
                      <td className="px-3 py-2 text-center">
                        {p.activo ? (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Activo</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Inactivo</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {!loading && records.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{records.length} productos listados</span>
          <Button variant="ghost" size="sm" onClick={() => void load()}>Actualizar</Button>
        </div>
      )}
    </div>
  )
}
