"use client"

import { useMemo, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { loadXLSX } from "@/lib/load-xlsx"
import { SeqBadge } from "@/components/seq-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Package, Plus, Pencil, Trash2, Save, X, Search, Upload, Download,
  AlertTriangle, TrendingDown, Boxes,
} from "lucide-react"
import { RecordActions } from "@/components/record-actions"
import type { InventarioItem, PiezaCatalogo } from "@/lib/types"

const emptyPiezaCatalogo: PiezaCatalogo = {
  Pieza: "", Categoria: "", Prioridad: "Media", Tipo: "Consumible",
  Funcion: "", FallasComunes: "", Activa: "Sí",
}

const empty: InventarioItem = {
  ItemID: "", CodigoBarras: "", Pieza: "", Categoria: "",
  Marca: "", Modelo: "", NumeroParte: "",
  PrecioCompra: 0, PrecioCompraMercado: 0, PrecioVenta: 0,
  StockRafaelVidal: 0, StockLosJardines: 0, StockVillaOlga: 0, StockLaVega: 0,
  StockMinimo: 5, Proveedor: "", Estado: "Activo", Observaciones: "",
}

function fmt(n: number) { return n.toLocaleString("es-DO") }
function money(n: number) { return "RD$ " + (n || 0).toLocaleString("es-DO", {minimumFractionDigits: 2, maximumFractionDigits: 2}) }

export function InventarioPage() {
  const { db, setDb, showToast, apiUrl } = useAppStore()
  const [open, setOpen] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [form, setForm] = useState<InventarioItem>(empty)
  const [isEditing, setIsEditing] = useState(false)
  const [search, setSearch] = useState("")
  const [filterSuc, setFilterSuc] = useState("todas")
  const [filterCat, setFilterCat] = useState("todas")
  const [filterEstado, setFilterEstado] = useState("Activo")
  const [filterAlerta, setFilterAlerta] = useState("todos")
  const [sortCol, setSortCol] = useState("Pieza")
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc")
  
  // Estado para ajuste de stock
  const [showAdjustStock, setShowAdjustStock] = useState(false)
  const [adjustItem, setAdjustItem] = useState<InventarioItem | null>(null)
  const [adjustQuantity, setAdjustQuantity] = useState(0)
  const [adjustType, setAdjustType] = useState<"add"|"remove">("add")
  const [adjustSucursal, setAdjustSucursal] = useState<"Rafael Vidal"|"Los Jardines"|"Villa Olga"|"La Vega">("Rafael Vidal")

  // Estado para crear nueva pieza del catálogo inline (desde el modal de inventario)
  const [showNuevaPieza, setShowNuevaPieza] = useState(false)
  const [nuevaPiezaForm, setNuevaPiezaForm] = useState<PiezaCatalogo>(emptyPiezaCatalogo)
  const [savingNuevaPieza, setSavingNuevaPieza] = useState(false)
  // Cuando el usuario elige "+ Nueva categoría" en el select, mostramos input
  // libre para escribirla. También entra en este modo si la categoría
  // pre-cargada del form principal no existe aún en el catálogo.
  const [nuevaPiezaCustomCat, setNuevaPiezaCustomCat] = useState(false)

  const inventario = db.inventario || []

  const categorias = useMemo(() => {
    const set = new Set<string>()
    inventario.forEach(i => { if (i.Categoria) set.add(i.Categoria) })
    db.piezas.forEach(p => { if (p.Categoria) set.add(p.Categoria) })
    return Array.from(set).sort()
  }, [inventario, db.piezas])

  const stockTotal = (i: InventarioItem) =>
    (Number(i.StockRafaelVidal)||0) + (Number(i.StockLosJardines)||0) +
    (Number(i.StockVillaOlga)||0) + (Number(i.StockLaVega)||0)

  const stockBySuc = (i: InventarioItem, suc: string) => {
    if (suc === "Rafael Vidal") return Number(i.StockRafaelVidal) || 0
    if (suc === "Los Jardines") return Number(i.StockLosJardines) || 0
    if (suc === "Villa Olga") return Number(i.StockVillaOlga) || 0
    if (suc === "La Vega") return Number(i.StockLaVega) || 0
    return stockTotal(i)
  }

  const filtered = useMemo(() => {
    return inventario.filter(i => {
      if (filterEstado !== "todos" && i.Estado !== filterEstado) return false
      if (filterCat !== "todas" && i.Categoria !== filterCat) return false
      const stock = filterSuc === "todas" ? stockTotal(i) : stockBySuc(i, filterSuc)
      if (filterAlerta === "bajo" && stock > (i.StockMinimo||0)) return false
      if (filterAlerta === "agotado" && stock > 0) return false
      if (search) {
        const q = search.toLowerCase()
        const txt = [i.Pieza, i.CodigoBarras, i.Marca, i.NumeroParte, i.Modelo, i.Categoria].join(" ").toLowerCase()
        if (!txt.includes(q)) return false
      }
      return true
    }).sort((a, b) => {
      let va: any, vb: any
      switch(sortCol) {
        case "CodigoBarras": va = a.CodigoBarras||""; vb = b.CodigoBarras||""; break
        case "Pieza": va = a.Pieza; vb = b.Pieza; break
        case "Categoria": va = a.Categoria; vb = b.Categoria; break
        case "Marca": va = a.Marca||""; vb = b.Marca||""; break
        case "PrecioVenta": va = Number(a.PrecioVenta)||0; vb = Number(b.PrecioVenta)||0; break
        case "Stock": va = stockTotal(a); vb = stockTotal(b); break
        default: return 0
      }
      if (typeof va === "string") { va = va.toLowerCase(); vb = vb.toLowerCase() }
      if (va < vb) return sortDir === "asc" ? -1 : 1
      if (va > vb) return sortDir === "asc" ? 1 : -1
      return 0
    })
  }, [inventario, search, filterSuc, filterCat, filterEstado, filterAlerta, sortCol, sortDir])

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }
  const SortIcon = ({col}:{col:string}) =>
    sortCol !== col ? <span className="text-muted-foreground/30 ml-1">⇅</span>
    : <span className="ml-1 text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>

  // KPIs
  const kpis = useMemo(() => {
    const total = inventario.length
    const activos = inventario.filter(i => i.Estado === "Activo").length
    const bajoStock = inventario.filter(i => i.Estado === "Activo" && stockTotal(i) > 0 && stockTotal(i) <= (i.StockMinimo||0)).length
    const agotado = inventario.filter(i => i.Estado === "Activo" && stockTotal(i) === 0).length
    const valorTotal = inventario.filter(i => i.Estado === "Activo").reduce((s, i) => s + (Number(i.PrecioCompra)||0) * stockTotal(i), 0)
    return { total, activos, bajoStock, agotado, valorTotal }
  }, [inventario])

  const openNew = () => {
    setForm({...empty, ItemID: "inv_" + Date.now()})
    setIsEditing(false); setOpen(true)
  }
  const openEdit = (item: InventarioItem) => { setForm({...item}); setIsEditing(true); setOpen(true) }

  const handleSave = () => {
    if (!form.Pieza.trim()) { showToast("Nombre de pieza obligatorio", "error"); return }
    const id = form.ItemID || ("inv_" + Date.now())
    const nuevo = {...form, ItemID: id}
    const lista = isEditing
      ? inventario.map(i => i.ItemID === id ? nuevo : i)
      : [...inventario, nuevo]
    setDb({...db, inventario: lista})
    
    // Guardar en Supabase
    void guardarEnSupabase(nuevo, isEditing ? "updateInventario" : "addInventario")
    
    showToast(isEditing ? "Item actualizado" : "Item agregado al inventario", "success")
    setOpen(false)
  }

  // Crea una pieza del catálogo desde el modal de Nuevo item de inventario.
  // Guarda local (optimistic) + Supabase (savePieza), y auto-rellena el form
  // principal de inventario con la nueva pieza para no perder el contexto.
  const handleSaveNuevaPieza = async () => {
    const nombre = nuevaPiezaForm.Pieza.trim()
    if (!nombre) {
      showToast("Nombre de la pieza es obligatorio", "error")
      return
    }
    if (db.piezas.some(p => p.Pieza.toLowerCase() === nombre.toLowerCase())) {
      showToast("Ya existe una pieza con ese nombre en el catálogo", "error")
      return
    }
    setSavingNuevaPieza(true)
    const nueva: PiezaCatalogo = { ...nuevaPiezaForm, Pieza: nombre }
    // Optimistic update local + auto-select en el form principal de inventario.
    setDb({ ...db, piezas: [...db.piezas, nueva] })
    setForm({
      ...form,
      Pieza: nombre,
      Categoria: nueva.Categoria || form.Categoria,
      Observaciones: form.Observaciones || nueva.Funcion || "",
    })
    // Persistir en Supabase via Apps Script (mismo action que catalogo-page).
    const normalized = normalizeApiUrl(apiUrl)
    if (normalized) {
      try {
        await apiJsonp(normalized, {
          action: "savePieza",
          pieza: nombre,
          categoria: nueva.Categoria || "",
          prioridad: nueva.Prioridad,
          tipo: nueva.Tipo,
          funcion: nueva.Funcion || "",
          fallasComunes: nueva.FallasComunes || "",
          activa: "Sí",
        })
        showToast(`Pieza "${nombre}" agregada al catálogo`, "success")
      } catch (error) {
        showToast(`Pieza guardada localmente (Supabase: ${error instanceof Error ? error.message : "sin conexión"})`, "info")
      }
    } else {
      showToast(`Pieza "${nombre}" guardada localmente`, "info")
    }
    setSavingNuevaPieza(false)
    setShowNuevaPieza(false)
    setNuevaPiezaForm(emptyPiezaCatalogo)
    setNuevaPiezaCustomCat(false)
  }

  const guardarEnSupabase = async (item: InventarioItem, action = "updateInventario") => {
    const normalized = normalizeApiUrl(apiUrl)
    try {
      await apiJsonp(normalized, { action, data: JSON.stringify(item) })
      return true
    } catch (error) {
      console.warn("No se pudo guardar en Supabase:", error)
    }
    return false
  }

  const handleDelete = (item: InventarioItem) => {
    if (!confirm("¿Eliminar " + item.Pieza + " del inventario?")) return
    setDb({...db, inventario: inventario.filter(i => i.ItemID !== item.ItemID)})
    
    // Eliminar de Supabase
    void eliminarDeSupabase(item.ItemID)
    
    showToast("Item eliminado", "success")
  }

  const eliminarDeSupabase = async (itemID: string) => {
    const normalized = normalizeApiUrl(apiUrl)
    try {
      await apiJsonp(normalized, { action: "deleteInventario", id: itemID })
    } catch (error) {
      console.warn("No se pudo eliminar en Supabase:", error)
    }
  }

  const adjustStock = async (item: InventarioItem, suc: "Rafael Vidal"|"Los Jardines"|"Villa Olga"|"La Vega", delta: number) => {
    const key = suc === "Rafael Vidal" ? "StockRafaelVidal" :
                suc === "Los Jardines" ? "StockLosJardines" :
                suc === "Villa Olga" ? "StockVillaOlga" : "StockLaVega"
    const nuevo = {...item, [key]: Math.max(0, (Number(item[key as keyof InventarioItem] as number)||0) + delta)}
    setDb({...db, inventario: inventario.map(i => i.ItemID === item.ItemID ? nuevo : i)})
    
    await guardarEnSupabase(nuevo)
  }

  // Agregar piezas del catálogo automáticamente
  const importarDesdeCatalogo = () => {
    const existentes = new Set(inventario.map(i => i.Pieza.toLowerCase()))
    const nuevas = db.piezas
      .filter(p => p.Pieza && !existentes.has(p.Pieza.toLowerCase()))
      .map((p, idx): InventarioItem => ({
        ItemID: "inv_cat_" + Date.now() + "_" + idx,
        CodigoBarras: "",
        Pieza: p.Pieza,
        Categoria: p.Categoria || "Sin categoría",
        Marca: "", Modelo: "", NumeroParte: "",
        PrecioCompra: 0, PrecioCompraMercado: 0, PrecioVenta: 0,
        StockRafaelVidal: 0, StockLosJardines: 0, StockVillaOlga: 0, StockLaVega: 0,
        StockMinimo: p.Prioridad === "Alta" ? 5 : p.Prioridad === "Media" ? 3 : 1,
        Proveedor: "", Estado: "Activo", Observaciones: p.Funcion || ""
      }))
    if (nuevas.length === 0) {
      showToast("Todas las piezas del catálogo ya están en el inventario", "info")
      return
    }
    setDb({...db, inventario: [...inventario, ...nuevas]})
    void Promise.all(nuevas.map(item => guardarEnSupabase(item, "addInventario")))
    showToast(nuevas.length + " piezas importadas desde el catálogo", "success")
  }

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    let XLSX: any
    try {
      XLSX = await loadXLSX()
    } catch (err) {
      showToast("No se pudo cargar la librería XLSX. Revisa tu conexión.", "error")
      e.target.value = ""
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, {type:"binary"})
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[] = XLSX.utils.sheet_to_json(ws, {defval:""})
        const nuevos: InventarioItem[] = rows.filter(r => r.Pieza || r.Nombre).map((r, i): InventarioItem => ({
          ItemID: "inv_xl_" + Date.now() + "_" + i,
          CodigoBarras: String(r.CodigoBarras || r["Codigo de barras"] || r.Codigo || ""),
          Pieza: String(r.Pieza || r.Nombre || "").trim(),
          Categoria: String(r.Categoria || r.Categoría || "Sin categoría"),
          Marca: String(r.Marca || ""),
          Modelo: String(r.Modelo || ""),
          NumeroParte: String(r.NumeroParte || r["Numero de parte"] || r["Número de parte"] || ""),
          PrecioCompra: Number(r.PrecioCompra || r["Precio compra"] || r["Precio compra Cibao"] || r.PrecioCompraCibao || 0),
          PrecioCompraMercado: Number(r.PrecioCompraMercado || r["Precio compra mercado"] || 0),
          PrecioVenta: Number(r.PrecioVenta || r["Precio venta"] || r.Precio || 0),
          StockRafaelVidal: Number(r.StockRafaelVidal || r["Stock Rafael Vidal"] || 0),
          StockLosJardines: Number(r.StockLosJardines || r["Stock Los Jardines"] || 0),
          StockVillaOlga: Number(r.StockVillaOlga || r["Stock Villa Olga"] || 0),
          StockLaVega: Number(r.StockLaVega || r["Stock La Vega"] || 0),
          StockMinimo: Number(r.StockMinimo || r["Stock minimo"] || 3),
          Proveedor: String(r.Proveedor || ""),
          Estado: (r.Estado === "Inactivo" ? "Inactivo" : "Activo") as "Activo"|"Inactivo",
          Observaciones: String(r.Observaciones || ""),
        }))
        if (nuevos.length > 0) {
          setDb({...db, inventario: [...inventario, ...nuevos]})
          void Promise.all(nuevos.map(item => guardarEnSupabase(item, "addInventario")))
          showToast(nuevos.length + " items importados", "success")
          setShowImport(false)
        } else {
          showToast("No se encontraron items válidos", "error")
        }
      } catch(err) {
        showToast("Error: " + String(err), "error")
      }
    }
    reader.readAsBinaryString(file)
    e.target.value = ""
  }

  const exportCSV = () => {
    const headers = ["CodigoBarras","Pieza","Categoria","Marca","Modelo","NumeroParte",
      "PrecioCompra","PrecioCompraMercado","PrecioVenta","StockRafaelVidal","StockLosJardines","StockVillaOlga","StockLaVega",
      "StockMinimo","Proveedor","Estado","Observaciones"]
    const lines = [headers.join(",")]
    filtered.forEach(i => {
      lines.push(headers.map(h => {
        const v = String((i as any)[h] ?? "").replace(/"/g, '""')
        return v.includes(",") ? '"' + v + '"' : v
      }).join(","))
    })
    const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"})
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "Inventario_CSL_" + new Date().toISOString().slice(0,10) + ".csv"
    a.click()
  }

  const stockStatus = (item: InventarioItem) => {
    const s = filterSuc === "todas" ? stockTotal(item) : stockBySuc(item, filterSuc)
    const min = item.StockMinimo || 0
    if (s === 0) return {label:"Agotado", color:"bg-red-500/20 text-red-400 border-red-500/30"}
    if (s <= min) return {label:"Bajo", color:"bg-yellow-500/20 text-yellow-400 border-yellow-500/30"}
    return {label:"OK", color:"bg-green-500/20 text-green-400 border-green-500/30"}
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Package className="h-5 w-5 text-primary" />Inventario de Piezas</h2>
          <p className="text-sm text-muted-foreground">Stock, precios y alertas por sucursal</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={importarDesdeCatalogo}>
            <Boxes className="h-4 w-4 mr-2" />Importar Catálogo
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4 mr-2" />Carga masiva
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-2" />Exportar CSV
          </Button>
          <Button onClick={openNew} size="sm">
            <Plus className="h-4 w-4 mr-2" />Nuevo
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Card className="border-primary/20"><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-muted-foreground uppercase">Total items</p>
          <p className="text-2xl font-bold text-primary">{kpis.total}</p>
        </CardContent></Card>
        <Card className="border-green-500/20"><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-muted-foreground uppercase">Activos</p>
          <p className="text-2xl font-bold text-green-500">{kpis.activos}</p>
        </CardContent></Card>
        <Card className="border-yellow-500/20"><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><TrendingDown className="h-3 w-3" />Stock bajo</p>
          <p className="text-2xl font-bold text-yellow-500">{kpis.bajoStock}</p>
        </CardContent></Card>
        <Card className="border-red-500/20"><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Agotados</p>
          <p className="text-2xl font-bold text-red-500">{kpis.agotado}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-muted-foreground uppercase">Valor inventario</p>
          <p className="text-lg font-bold font-mono">{money(kpis.valorTotal)}</p>
        </CardContent></Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-[220px]">
              <Label className="text-xs text-muted-foreground">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Nombre, código, marca, número de parte..." className="pl-8" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Sucursal</Label>
              <Select value={filterSuc} onValueChange={setFilterSuc}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas (total)</SelectItem>
                  <SelectItem value="Rafael Vidal">Rafael Vidal</SelectItem>
                  <SelectItem value="Los Jardines">Los Jardines</SelectItem>
                  <SelectItem value="Villa Olga">Villa Olga</SelectItem>
                  <SelectItem value="La Vega">La Vega</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Categoría</Label>
              <Select value={filterCat} onValueChange={setFilterCat}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {categorias.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Estado</Label>
              <Select value={filterEstado} onValueChange={setFilterEstado}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="Activo">Activo</SelectItem>
                  <SelectItem value="Inactivo">Inactivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Alarma</Label>
              <Select value={filterAlerta} onValueChange={setFilterAlerta}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="bajo">Stock bajo</SelectItem>
                  <SelectItem value="agotado">Agotados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>{filterSuc === "todas" ? "Todos los locales" : filterSuc}</span>
            <span className="text-xs font-normal text-muted-foreground">Mostrando {filtered.length} de {inventario.length} items</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="w-12 px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground">#</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-semibold cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("CodigoBarras")}>Código<SortIcon col="CodigoBarras" /></th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-semibold cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Pieza")}>Nombre<SortIcon col="Pieza" /></th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-semibold cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Categoria")}>Categoría<SortIcon col="Categoria" /></th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-semibold cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Marca")}>Marca<SortIcon col="Marca" /></th>
                <th className="px-3 py-2 text-right text-xs text-muted-foreground font-semibold cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("PrecioVenta")}>Precio<SortIcon col="PrecioVenta" /></th>
                <th className="px-3 py-2 text-right text-xs text-muted-foreground font-semibold cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Stock")}>Stock<SortIcon col="Stock" /></th>
                <th className="px-3 py-2 text-center text-xs text-muted-foreground font-semibold">Estado</th>
                <th className="px-3 py-2 text-right text-xs text-muted-foreground font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">
                  {inventario.length === 0
                    ? <div className="space-y-2">
                        <p>Inventario vacío</p>
                        <p className="text-xs">Haz clic en <strong>Importar Catálogo</strong> para agregar las 29 piezas del GentleYAG, o <strong>Nuevo</strong> para agregar manualmente</p>
                      </div>
                    : "Sin resultados con los filtros aplicados"}
                </td></tr>
              ) : filtered.map((i, seqIndex) => {
                const stock = filterSuc === "todas" ? stockTotal(i) : stockBySuc(i, filterSuc)
                const status = stockStatus(i)
                return (
                  <tr key={i.ItemID} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-2 text-center"><SeqBadge n={seqIndex + 1} /></td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{i.CodigoBarras || "-"}</td>
                    <td className="px-3 py-2 font-semibold">{i.Pieza}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{i.Categoria}</td>
                    <td className="px-3 py-2 text-xs">{i.Marca || "-"}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{i.PrecioVenta ? money(i.PrecioVenta) : "-"}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{fmt(stock)}</td>
                    <td className="px-3 py-2 text-center"><Badge className={status.color + " text-xs"}>{status.label}</Badge></td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 justify-end items-center">
                        <div className="flex gap-0.5 bg-muted/50 rounded px-1.5 py-1">
                          <button 
                            className="h-6 w-6 p-0 text-xs font-bold hover:bg-destructive/20 rounded cursor-pointer transition-colors"
                            onClick={() => { setAdjustItem(i); setAdjustType("remove"); setAdjustQuantity(0); setShowAdjustStock(true) }}
                            title="Disminuir stock"
                          >
                            −
                          </button>
                          <span className="px-1 text-xs font-semibold min-w-[20px] text-center">{fmt(stock)}</span>
                          <button 
                            className="h-6 w-6 p-0 text-xs font-bold hover:bg-green-500/20 rounded cursor-pointer transition-colors"
                            onClick={() => { setAdjustItem(i); setAdjustType("add"); setAdjustQuantity(0); setShowAdjustStock(true) }}
                            title="Aumentar stock"
                          >
                            +
                          </button>
                        </div>
                        <RecordActions
                          title={`Inventario: ${i.Pieza}`}
                          record={i as unknown as Record<string, unknown>}
                          onEdit={() => openEdit(i)}
                          onDelete={() => handleDelete(i)}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Form Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{isEditing ? "Editar item" : "Nuevo item de inventario"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {/* Info general */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Información general</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <Label>Pieza del catálogo *</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 self-start gap-1 text-xs sm:self-auto"
                      onClick={() => {
                        // Pre-cargar categoría si el usuario ya escribió una en el form principal.
                        const preCat = form.Categoria || ""
                        setNuevaPiezaForm({ ...emptyPiezaCatalogo, Categoria: preCat })
                        // Si la categoría pre-cargada no existe en el catálogo, abrir
                        // el modo de input libre directamente.
                        setNuevaPiezaCustomCat(Boolean(preCat) && !categorias.includes(preCat))
                        setShowNuevaPieza(true)
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Nueva pieza
                    </Button>
                  </div>
                  <Select
                    value={form.Pieza}
                    onValueChange={(v) => {
                      // Auto-fill categoría desde el catálogo
                      const pieza = db.piezas.find(p => p.Pieza === v)
                      setForm({
                        ...form,
                        Pieza: v,
                        Categoria: pieza?.Categoria || form.Categoria,
                        Observaciones: form.Observaciones || pieza?.Funcion || ""
                      })
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecciona una pieza del catálogo" /></SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {db.piezas.length === 0 ? (
                        <SelectItem value="__none__" disabled>No hay piezas en el catálogo — usa &quot;+ Nueva pieza&quot;</SelectItem>
                      ) : (
                        db.piezas
                          .filter(p => p.Pieza)
                          .sort((a, b) => a.Pieza.localeCompare(b.Pieza))
                          .map(p => (
                            <SelectItem key={p.Pieza} value={p.Pieza}>
                              {p.Pieza} {p.Categoria ? `— ${p.Categoria}` : ""}
                            </SelectItem>
                          ))
                      )}
                    </SelectContent>
                  </Select>
                  {form.Pieza && !db.piezas.some(p => p.Pieza === form.Pieza) && (
                    <p className="text-xs text-yellow-400">⚠️ Esta pieza no está en el catálogo</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Código de barras</Label>
                  <Input value={form.CodigoBarras || ""} onChange={e => setForm({...form, CodigoBarras: e.target.value})} placeholder="Ej: 8436574360677" />
                </div>
                <div className="space-y-1.5">
                  <Label>Categoría</Label>
                  <Input value={form.Categoria} onChange={e => setForm({...form, Categoria: e.target.value})} placeholder="Auto-rellena según pieza" readOnly={!!db.piezas.find(p => p.Pieza === form.Pieza)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Marca</Label>
                  <Input value={form.Marca || ""} onChange={e => setForm({...form, Marca: e.target.value})} placeholder="Candela, Syneron..." />
                </div>
                <div className="space-y-1.5">
                  <Label>Modelo</Label>
                  <Input value={form.Modelo || ""} onChange={e => setForm({...form, Modelo: e.target.value})} placeholder="GentleYAG" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Número de parte</Label>
                  <Input value={form.NumeroParte || ""} onChange={e => setForm({...form, NumeroParte: e.target.value})} placeholder="P/N 1234" />
                </div>
              </div>
            </div>

            {/* Precios */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Precios (RD$)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Precio compra Cibao</Label>
                  <Input type="number" value={form.PrecioCompra} onChange={e => setForm({...form, PrecioCompra: Number(e.target.value)})} min={0} step="0.01" placeholder="Precio al que compra Cibao" />
                </div>
                <div className="space-y-1.5">
                  <Label>Precio compra mercado</Label>
                  <Input type="number" value={form.PrecioCompraMercado || 0} onChange={e => setForm({...form, PrecioCompraMercado: Number(e.target.value)})} min={0} step="0.01" placeholder="Precio referencia del mercado" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Precio de venta</Label>
                  <Input type="number" value={form.PrecioVenta || 0} onChange={e => setForm({...form, PrecioVenta: Number(e.target.value)})} min={0} step="0.01" />
                </div>
              </div>
            </div>

            {/* Stock por sucursal */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Stock por sucursal</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Rafael Vidal</Label>
                  <Input type="number" value={form.StockRafaelVidal} onChange={e => setForm({...form, StockRafaelVidal: Number(e.target.value)})} min={0} />
                </div>
                <div className="space-y-1.5">
                  <Label>Los Jardines</Label>
                  <Input type="number" value={form.StockLosJardines} onChange={e => setForm({...form, StockLosJardines: Number(e.target.value)})} min={0} />
                </div>
                <div className="space-y-1.5">
                  <Label>Villa Olga</Label>
                  <Input type="number" value={form.StockVillaOlga} onChange={e => setForm({...form, StockVillaOlga: Number(e.target.value)})} min={0} />
                </div>
                <div className="space-y-1.5">
                  <Label>La Vega</Label>
                  <Input type="number" value={form.StockLaVega} onChange={e => setForm({...form, StockLaVega: Number(e.target.value)})} min={0} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Stock mínimo (alerta cuando el total sea menor o igual)</Label>
                  <Input type="number" value={form.StockMinimo} onChange={e => setForm({...form, StockMinimo: Number(e.target.value)})} min={0} />
                </div>
              </div>
            </div>

            {/* Otros */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Otros</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Proveedor</Label>
                  <Input value={form.Proveedor || ""} onChange={e => setForm({...form, Proveedor: e.target.value})} />
                </div>
                <div className="space-y-1.5">
                  <Label>Estado</Label>
                  <Select value={form.Estado} onValueChange={v => setForm({...form, Estado: v as "Activo"|"Inactivo"})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Activo">Activo</SelectItem>
                      <SelectItem value="Inactivo">Inactivo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Observaciones</Label>
                  <Input value={form.Observaciones || ""} onChange={e => setForm({...form, Observaciones: e.target.value})} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}><X className="h-4 w-4 mr-2" />Cancelar</Button>
            <Button onClick={handleSave}><Save className="h-4 w-4 mr-2" />Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nueva pieza del catálogo (secundario, abierto desde el modal de Nuevo item) */}
      <Dialog
        open={showNuevaPieza}
        onOpenChange={(v) => {
          if (savingNuevaPieza) return
          setShowNuevaPieza(v)
          if (!v) {
            // Al cerrar (cancelar o click fuera) reseteamos el sub-form.
            setNuevaPiezaForm(emptyPiezaCatalogo)
            setNuevaPiezaCustomCat(false)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Nueva pieza del catálogo
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Nombre de la pieza *</Label>
              <Input
                value={nuevaPiezaForm.Pieza}
                onChange={e => setNuevaPiezaForm({ ...nuevaPiezaForm, Pieza: e.target.value })}
                placeholder="Ej: Lámpara Xenon GentleYAG"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              {categorias.length === 0 ? (
                <>
                  <div className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    No hay categorías disponibles. Escribe una nueva.
                  </div>
                  <Input
                    value={nuevaPiezaForm.Categoria}
                    onChange={e => setNuevaPiezaForm({ ...nuevaPiezaForm, Categoria: e.target.value })}
                    placeholder="Nombre de la categoría"
                  />
                </>
              ) : nuevaPiezaCustomCat ? (
                <div className="flex w-full gap-2">
                  <Input
                    value={nuevaPiezaForm.Categoria}
                    onChange={e => setNuevaPiezaForm({ ...nuevaPiezaForm, Categoria: e.target.value })}
                    placeholder="Nombre de la nueva categoría"
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 flex-shrink-0 text-xs"
                    onClick={() => {
                      setNuevaPiezaCustomCat(false)
                      setNuevaPiezaForm({ ...nuevaPiezaForm, Categoria: "" })
                    }}
                  >
                    ← Lista
                  </Button>
                </div>
              ) : (
                <Select
                  value={nuevaPiezaForm.Categoria || undefined}
                  onValueChange={(v) => {
                    if (v === "__custom__") {
                      setNuevaPiezaCustomCat(true)
                      setNuevaPiezaForm({ ...nuevaPiezaForm, Categoria: "" })
                    } else {
                      setNuevaPiezaForm({ ...nuevaPiezaForm, Categoria: v })
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecciona una categoría" /></SelectTrigger>
                  <SelectContent className="max-h-[260px]">
                    {categorias.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                    <SelectItem value="__custom__">
                      <span className="flex items-center gap-1 text-primary">
                        <Plus className="h-3 w-3" /> Nueva categoría
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Prioridad</Label>
                <Select value={nuevaPiezaForm.Prioridad} onValueChange={v => setNuevaPiezaForm({ ...nuevaPiezaForm, Prioridad: v as PiezaCatalogo["Prioridad"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Alta">Alta</SelectItem>
                    <SelectItem value="Media-Alta">Media-Alta</SelectItem>
                    <SelectItem value="Media">Media</SelectItem>
                    <SelectItem value="Baja">Baja</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={nuevaPiezaForm.Tipo} onValueChange={v => setNuevaPiezaForm({ ...nuevaPiezaForm, Tipo: v as PiezaCatalogo["Tipo"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Consumible">Consumible</SelectItem>
                    <SelectItem value="Consumible técnico">Consumible técnico</SelectItem>
                    <SelectItem value="Consumible operativo">Consumible operativo</SelectItem>
                    <SelectItem value="No consumible">No consumible</SelectItem>
                    <SelectItem value="No consumible crítico">No consumible crítico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción / Función</Label>
              <Input
                value={nuevaPiezaForm.Funcion || ""}
                onChange={e => setNuevaPiezaForm({ ...nuevaPiezaForm, Funcion: e.target.value })}
                placeholder="¿Para qué sirve la pieza?"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fallas comunes</Label>
              <Input
                value={nuevaPiezaForm.FallasComunes || ""}
                onChange={e => setNuevaPiezaForm({ ...nuevaPiezaForm, FallasComunes: e.target.value })}
                placeholder="Opcional"
              />
            </div>
            <p className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              💡 Marca, Modelo, Número de parte y Código de barras se llenan en el item de inventario, no en el catálogo.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNuevaPieza(false)} disabled={savingNuevaPieza}>
              <X className="h-4 w-4 mr-2" /> Cancelar
            </Button>
            <Button onClick={handleSaveNuevaPieza} disabled={savingNuevaPieza || !nuevaPiezaForm.Pieza.trim()}>
              <Save className="h-4 w-4 mr-2" />
              {savingNuevaPieza ? "Guardando..." : "Guardar pieza"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Carga masiva de inventario</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-sm font-semibold mb-1">Selecciona el Excel</p>
              <p className="text-xs text-muted-foreground mb-4">Formato .xlsx con columnas: Pieza, Categoria, Marca, PrecioCompra, PrecioCompraMercado, PrecioVenta, StockRafaelVidal, StockLosJardines, StockVillaOlga, StockLaVega, StockMinimo</p>
              <label className="cursor-pointer">
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpload} />
                <span className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:bg-primary/90 cursor-pointer">
                  <Upload className="h-4 w-4" /> Subir Excel
                </span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImport(false)}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de ajuste de stock */}
      <Dialog open={showAdjustStock} onOpenChange={setShowAdjustStock}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {adjustType === "add" ? "Agregar" : "Disminuir"} stock: {adjustItem?.Pieza}
            </DialogTitle>
          </DialogHeader>
          
          {adjustItem && (
            <div className="space-y-6 py-4">
              <div className="bg-blue-500/10 border border-blue-500/30 rounded p-4">
                <p className="text-sm text-blue-400">
                  ℹ️ Especifica la cantidad a {adjustType === "add" ? "agregar" : "disminuir"} y selecciona la sucursal.
                </p>
              </div>

              {/* Input de cantidad */}
              <div className="space-y-3 bg-muted/30 p-4 rounded-lg border border-border">
                <Label className="text-sm font-semibold">¿Cuántas unidades deseas {adjustType === "add" ? "agregar" : "disminuir"}?</Label>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setAdjustQuantity(Math.max(0, adjustQuantity - 1))}
                    className="h-10 w-10 rounded-lg bg-destructive/20 hover:bg-destructive/30 font-bold text-lg transition-colors"
                  >
                    −
                  </button>
                  <Input
                    type="number"
                    min="1"
                    max="9999"
                    value={adjustQuantity}
                    onChange={(e) => setAdjustQuantity(Math.max(0, parseInt(e.target.value) || 0))}
                    className="text-center text-2xl font-bold h-12 w-24"
                  />
                  <button
                    onClick={() => setAdjustQuantity(adjustQuantity + 1)}
                    className="h-10 w-10 rounded-lg bg-green-500/20 hover:bg-green-500/30 font-bold text-lg transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Selección de sucursal */}
              <div className="space-y-4">
                <Label className="text-sm font-semibold">Selecciona la sucursal:</Label>
                
                <div className="grid gap-3">
                  {(["Rafael Vidal", "Los Jardines", "Villa Olga", "La Vega"] as const).map(suc => {
                    const currentStock = (adjustItem as any)[
                      suc === "Rafael Vidal" ? "StockRafaelVidal" :
                      suc === "Los Jardines" ? "StockLosJardines" :
                      suc === "Villa Olga" ? "StockVillaOlga" : "StockLaVega"
                    ] || 0
                    // Solo aplicar delta a la sucursal seleccionada
                    const delta = adjustSucursal === suc && adjustType === "add" ? adjustQuantity : adjustSucursal === suc && adjustType === "remove" ? -adjustQuantity : 0
                    const newStock = Math.max(0, currentStock + delta)
                    
                    return (
                      <div
                        key={suc}
                        onClick={() => setAdjustSucursal(suc)}
                        className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                          adjustSucursal === suc
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="flex justify-between items-center mb-3">
                          <span className="font-semibold text-base">{suc}</span>
                          <span className="text-xs text-muted-foreground">Cibao Spa Laser</span>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-primary">{fmt(currentStock)}</span>
                            {adjustSucursal === suc && (
                              <>
                                <span className="text-xl font-semibold text-muted-foreground">{adjustType === "add" ? '+' : '−'}</span>
                                <span className="text-3xl font-bold text-orange-500">{fmt(adjustQuantity)}</span>
                              </>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="text-xs text-muted-foreground">Nuevo stock</span>
                            <div className={`text-3xl font-bold ${newStock === 0 ? 'text-red-500' : newStock <= (adjustItem.StockMinimo || 5) ? 'text-yellow-500' : 'text-green-500'}`}>
                              {fmt(newStock)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Comentarios */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Comentarios (opcional)</Label>
                  <textarea
                    placeholder="Ej: Compra a Candela Inc | Devolución de cliente | Ajuste por daño"
                    className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    rows={2}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjustStock(false)}>Cancelar</Button>
            <Button
              disabled={adjustQuantity === 0}
              onClick={async () => {
                if (adjustItem && adjustQuantity > 0) {
                  const delta = adjustType === "add" ? adjustQuantity : -adjustQuantity
                  await adjustStock(adjustItem, adjustSucursal, delta)
                  setShowAdjustStock(false)
                  setAdjustItem(null)
                  showToast(
                    adjustType === "add"
                      ? `✓ Se agregaron ${adjustQuantity} unidades a ${adjustSucursal}`
                      : `✓ Se disminuyeron ${adjustQuantity} unidades en ${adjustSucursal}`,
                    "success"
                  )
                } else if (adjustQuantity === 0) {
                  showToast("Debes ingresar una cantidad mayor a 0", "error")
                }
              }}
            >
              {adjustType === "add" ? '✓ Agregar stock' : '✓ Disminuir stock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
