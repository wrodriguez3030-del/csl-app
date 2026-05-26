"use client"

import { useState, useMemo } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Search, Save, Trash2, Plus, X, ChevronDown, ChevronRight, AlertCircle, Wrench } from "lucide-react"
import type { PiezaCatalogo, Database } from "@/lib/types"
import { CATEGORIAS_TECNICAS, normalizeCategoria } from "@/lib/categorias"

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface CodigoError {
  id: string
  Codigo: string
  Descripcion: string
  Causa: string
  Solucion: string
  Prioridad: "Alta" | "Media" | "Baja"
  Equipo?: string
}

const emptyPieza: PiezaCatalogo = { Pieza: "", Categoria: "", Prioridad: "Media", Tipo: "Consumible", Funcion: "", FallasComunes: "", Activa: "Sí" }
const emptyError: CodigoError = { id: "", Codigo: "", Descripcion: "", Causa: "", Solucion: "", Prioridad: "Media", Equipo: "GentleYAG" }

const prioColors: Record<string, string> = {
  Alta: "bg-red-500/20 text-red-400 border-red-500/30",
  "Media-Alta": "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Media: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Baja: "bg-green-500/20 text-green-400 border-green-500/30",
}
const prioDot: Record<string, string> = {
  Alta: "bg-red-400", "Media-Alta": "bg-orange-400", Media: "bg-blue-400", Baja: "bg-green-400",
}

// Errores predefinidos del GentleYAG
const ERRORES_PREDEFINIDOS: CodigoError[] = [
  { id:"e1", Codigo:"3.1", Descripcion:"Shutter abierto - falla en obturador", Causa:"Obturador dañado o bloqueado", Solucion:"Verificar shutter mecánico, revisar conector y señal de control", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e2", Codigo:"3.2", Descripcion:"Shutter cerrado - falla en obturador", Causa:"Obturador no abre al comando", Solucion:"Revisar actuador del shutter, verificar cableado", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e3", Codigo:"6.4", Descripcion:"Falla de temperatura del cabezal", Causa:"Temperatura fuera de rango, sensor defectuoso", Solucion:"Verificar flujo de agua, limpiar radiador, revisar sensor de temperatura", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e4", Codigo:"7.1", Descripcion:"Falla de flujo de agua bajo", Causa:"Bomba débil, filtro obstruido, manguera doblada", Solucion:"Limpiar filtros, revisar bomba, verificar mangueras", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e5", Codigo:"7.2", Descripcion:"Falla de temperatura del agua alta", Causa:"Radiador sucio, temperatura ambiente alta", Solucion:"Limpiar radiador, verificar ventilación del equipo", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e6", Codigo:"7.3", Descripcion:"Falla de nivel de agua bajo", Causa:"Fuga en circuito hidráulico, evaporación", Solucion:"Reponer agua destilada, buscar fugas en mangueras y sellos", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e7", Codigo:"8.1", Descripcion:"Falla del sistema DCD / criostato", Causa:"Gas cryógeno vacío, válvula bloqueada, compresor falla", Solucion:"Verificar nivel de cryógeno, revisar válvula y compresor", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e8", Codigo:"9.1", Descripcion:"Falla del fusible Magnifor", Causa:"Sobrecarga eléctrica, fusible quemado", Solucion:"Reemplazar fusible Magnifor, verificar causa de sobrecarga", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e9", Codigo:"10.1", Descripcion:"Handpiece no detectado", Causa:"Conector flojo, slider dañado", Solucion:"Revisar conexión del handpiece, verificar slider y conector", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e10", Codigo:"10.4", Descripcion:"Falla calibración carport", Causa:"Puerto de calibración sucio o dañado", Solucion:"Limpiar carport, realizar calibración manual", Prioridad:"Media", Equipo:"GentleYAG" },
  { id:"e11", Codigo:"10.5", Descripcion:"Falla de slider del handpiece", Causa:"Slider desgastado o roto", Solucion:"Reemplazar slider del handpiece", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e12", Codigo:"12.1", Descripcion:"Falla HVPS - alto voltaje", Causa:"Fuente de alto voltaje defectuosa, capacitores", Solucion:"Revisar HVPS, verificar capacitores y conexiones de alto voltaje", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e13", Codigo:"13.1", Descripcion:"Falla del pedal / footswitch", Causa:"Pedal roto, manguera pinchada, conector defectuoso", Solucion:"Revisar manguera del pedal, verificar conector, reemplazar si necesario", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e14", Codigo:"14.0", Descripcion:"Falla de lámpara - fin de vida", Causa:"Lámpara agotada o quemada", Solucion:"Reemplazar lámparas, realizar break-in procedure", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e15", Codigo:"14.1", Descripcion:"Falla simmer supply", Causa:"Fuente simmer defectuosa", Solucion:"Revisar y reemplazar simmer supply", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e16", Codigo:"15.1", Descripcion:"Falla de fibra óptica", Causa:"Fibra rota o quemada, conector sucio", Solucion:"Limpiar conector de fibra, verificar integridad, reemplazar si necesario", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e17", Codigo:"19.1", Descripcion:"Falla tarjeta pequeña de alto voltaje", Causa:"Tarjeta HV pequeña defectuosa", Solucion:"Revisar y reemplazar tarjeta HV pequeña", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e18", Codigo:"19.2", Descripcion:"Falla tarjeta grande de alto voltaje", Causa:"Tarjeta HV grande defectuosa", Solucion:"Revisar y reemplazar tarjeta HV grande", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e19", Codigo:"19.4", Descripcion:"Falla control potencia HV", Causa:"Problema en circuito de potencia de alto voltaje", Solucion:"Revisar tarjeta grande HV, verificar conexiones", Prioridad:"Alta", Equipo:"GentleYAG" },
  { id:"e20", Codigo:"19.5", Descripcion:"Falla circuito HV secundario", Causa:"Componente del circuito HV secundario falla", Solucion:"Revisar tarjeta pequeña HV y conexiones asociadas", Prioridad:"Alta", Equipo:"GentleYAG" },
]

export function CatalogoPage() {
  const { db, setDb, apiUrl, showToast, setIsLoading, setLoadingMessage } = useAppStore()

  // Tab activo
  const [activeTab, setActiveTab] = useState<"piezas" | "errores">("piezas")

  // Estado piezas
  const [searchQuery, setSearchQuery] = useState("")
  const [filterCategoria, setFilterCategoria] = useState("todas")
  const [filterPrioridad, setFilterPrioridad] = useState("todas")
  const [piezaSort, setPiezaSort] = useState("Categoria")
  const [selectedPieza, setSelectedPieza] = useState<string>("")
  const [formData, setFormData] = useState<PiezaCatalogo>(emptyPieza)
  const [deleteDialog, setDeleteDialog] = useState<PiezaCatalogo | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  // Estado errores
  const [errores, setErrores] = useState<CodigoError[]>(ERRORES_PREDEFINIDOS)
  const [searchError, setSearchError] = useState("")
  const [errorSort, setErrorSort] = useState("Codigo")
  const [selectedError, setSelectedError] = useState<CodigoError | null>(null)
  const [showErrorForm, setShowErrorForm] = useState(false)
  const [errorForm, setErrorForm] = useState<CodigoError>(emptyError)
  const [deleteErrorDialog, setDeleteErrorDialog] = useState<CodigoError | null>(null)

  // Piezas filtradas
  // Lista oficial canónica — viene de lib/categorias.ts. Antes se construía
  // dinámicamente desde db.piezas y aparecían duplicados (ENERGIA/Energía, etc.).
  const categorias = useMemo(() => [...CATEGORIAS_TECNICAS], [])
  const filteredPiezas = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return db.piezas.filter((p) => {
      const mQ = !q || [p.Pieza, p.Categoria, p.Prioridad, p.Tipo, p.FallasComunes, p.Funcion].some((v) => (v || "").toLowerCase().includes(q))
      const mC = filterCategoria === "todas" || normalizeCategoria(p.Categoria) === filterCategoria
      const mP = filterPrioridad === "todas" || p.Prioridad === filterPrioridad
      return mQ && mC && mP
    }).sort((a, b) => String((a as any)[piezaSort] || "").localeCompare(String((b as any)[piezaSort] || ""), "es", { numeric: true }))
  }, [db.piezas, searchQuery, filterCategoria, filterPrioridad, piezaSort])
  const grouped = useMemo(() => {
    const map: Record<string, PiezaCatalogo[]> = {}
    filteredPiezas.forEach((p) => { const c = normalizeCategoria(p.Categoria); if (!map[c]) map[c] = []; map[c].push(p) })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredPiezas])
  const selectedPiezaData = useMemo(() => db.piezas.find((p) => p.Pieza === selectedPieza) || null, [db.piezas, selectedPieza])

  // Errores filtrados
  const filteredErrores = useMemo(() => {
    const q = searchError.toLowerCase()
    return errores
      .filter((e) => !q || [e.Codigo, e.Descripcion, e.Causa, e.Solucion].some((v) => (v||"").toLowerCase().includes(q)))
      .sort((a, b) => String((a as any)[errorSort] || "").localeCompare(String((b as any)[errorSort] || ""), "es", { numeric: true }))
  }, [errores, searchError, errorSort])

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => { const n = new Set(prev); if (n.has(cat)) n.delete(cat); else n.add(cat); return n })
  }

  const handleSavePieza = async () => {
    if (!formData.Pieza) { showToast("El nombre de la pieza es obligatorio", "error"); return }
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) {
      // Guardar local
      const exists = db.piezas.find(p => p.Pieza === formData.Pieza)
      if (exists) {
        setDb({ ...db, piezas: db.piezas.map(p => p.Pieza === formData.Pieza ? formData : p) })
      } else {
        setDb({ ...db, piezas: [...db.piezas, formData] })
      }
      showToast("Guardado localmente", "info"); setShowForm(false); return
    }
    setIsLoading(true); setLoadingMessage("Guardando pieza...")
    try {
      await apiJsonp(normalized, { action: "savePieza", pieza: formData.Pieza, categoria: formData.Categoria, prioridad: formData.Prioridad, tipo: formData.Tipo, funcion: formData.Funcion || "", fallasComunes: formData.FallasComunes || "", activa: "Sí" })
      const result = await apiJsonp(normalized, { action: "getAllData" })
      if (result?.ok && result.data) setDb(result.data as Database)
      showToast("Pieza guardada", "success"); setShowForm(false)
    } catch (e) { showToast("Error al guardar", "error") } finally { setIsLoading(false) }
  }

  const handleDeletePieza = async () => {
    if (!deleteDialog) return
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) {
      setDb({ ...db, piezas: db.piezas.filter(p => p.Pieza !== deleteDialog.Pieza) })
      setDeleteDialog(null); setSelectedPieza(""); setShowForm(false)
      showToast("Eliminada localmente", "info"); return
    }
    setIsLoading(true)
    try {
      await apiJsonp(normalized, { action: "deletePieza", pieza: deleteDialog.Pieza })
      const result = await apiJsonp(normalized, { action: "getAllData" })
      if (result?.ok && result.data) setDb(result.data as Database)
      setDeleteDialog(null); setSelectedPieza(""); setShowForm(false)
      showToast("Pieza eliminada", "success")
    } catch (e) { showToast("Error al eliminar", "error") } finally { setIsLoading(false) }
  }

  const handleSaveError = () => {
    if (!errorForm.Codigo || !errorForm.Descripcion) { showToast("Código y descripción son obligatorios", "error"); return }
    const record = { ...errorForm, id: errorForm.id || `e_${Date.now()}` }
    if (errorForm.id && errores.find(e => e.id === errorForm.id)) {
      setErrores(errores.map(e => e.id === errorForm.id ? record : e))
      showToast("Error actualizado", "success")
    } else {
      setErrores([...errores, record])
      showToast("Error registrado", "success")
    }
    setShowErrorForm(false); setSelectedError(record)
  }

  return (
    <div className="space-y-4">

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab("piezas")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "piezas" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Wrench className="h-4 w-4" />
          Catálogo de Piezas
          <Badge variant="secondary" className="ml-1">{db.piezas.length}</Badge>
        </button>
        <button
          onClick={() => setActiveTab("errores")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "errores" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <AlertCircle className="h-4 w-4" />
          Códigos de Error
          <Badge variant="secondary" className="ml-1">{errores.length}</Badge>
        </button>
      </div>

      {/* ── TAB PIEZAS ─────────────────────────────────────────────────────── */}
      {activeTab === "piezas" && (
        <>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Buscar por nombre, falla, función..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 pr-9" />
                  {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
                </div>
                <Select value={filterCategoria} onValueChange={setFilterCategoria}>
                  <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas las categorías</SelectItem>
                    {categorias.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filterPrioridad} onValueChange={setFilterPrioridad}>
                  <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    <SelectItem value="Alta">Alta</SelectItem>
                    <SelectItem value="Media-Alta">Media-Alta</SelectItem>
                    <SelectItem value="Media">Media</SelectItem>
                    <SelectItem value="Baja">Baja</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={piezaSort} onValueChange={setPiezaSort}>
                  <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Categoria">Orden: Categoría</SelectItem>
                    <SelectItem value="Pieza">Orden: Pieza</SelectItem>
                    <SelectItem value="Prioridad">Orden: Prioridad</SelectItem>
                    <SelectItem value="Tipo">Orden: Tipo</SelectItem>
                  </SelectContent>
                </Select>
                {(searchQuery || filterCategoria !== "todas" || filterPrioridad !== "todas") && (
                  <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(""); setFilterCategoria("todas"); setFilterPrioridad("todas") }}>
                    <X className="h-4 w-4 mr-1" /> Limpiar
                  </Button>
                )}
                <Button onClick={() => { setSelectedPieza(""); setFormData(emptyPieza); setShowForm(true) }} className="shrink-0">
                  <Plus className="h-4 w-4 mr-2" /> Nueva pieza
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{filteredPiezas.length} de {db.piezas.length} piezas{(searchQuery || filterCategoria !== "todas" || filterPrioridad !== "todas") ? " (filtrado)" : ""}</p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Lista piezas */}
            <div className="space-y-2">
              {grouped.length === 0 ? (
                <Card><CardContent className="py-16 text-center text-muted-foreground">
                  <Search className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>Sin resultados para tu búsqueda</p>
                  <button onClick={() => { setSearchQuery(""); setFilterCategoria("todas"); setFilterPrioridad("todas") }} className="text-primary text-sm mt-2 hover:underline">Limpiar filtros</button>
                </CardContent></Card>
              ) : grouped.map(([cat, piezas]) => (
                <Card key={cat}>
                  <button onClick={() => toggleCategory(cat)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/20 transition-colors">
                    <div className="flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{cat}</span>
                      <Badge variant="secondary" className="text-xs">{piezas.length}</Badge>
                    </div>
                    {collapsedCategories.has(cat) ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>
                  {!collapsedCategories.has(cat) && (
                    <div className="divide-y divide-border/50">
                      {piezas.map((p, idx) => (
                        <button key={`${p.Pieza}-${idx}`} onClick={() => { setSelectedPieza(p.Pieza); setFormData(p); setShowForm(false) }}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/30 ${selectedPieza === p.Pieza ? "bg-primary/10 border-l-2 border-primary" : ""}`}>
                          <span className="w-7 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground/70">{idx + 1}.</span>
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${prioDot[p.Prioridad] || "bg-gray-400"}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{p.Pieza}</p>
                            {p.FallasComunes && <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5"><AlertCircle className="h-3 w-3 flex-shrink-0" />{p.FallasComunes}</p>}
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <Badge variant="outline" className={`text-xs ${prioColors[p.Prioridad] || ""}`}>{p.Prioridad}</Badge>
                            <Badge variant="secondary" className="text-xs hidden sm:flex">{(p.Tipo || "").replace("No consumible", "No cons.").replace("Consumible", "Cons.")}</Badge>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>

            {/* Detalle / Formulario pieza */}
            <div>
              {showForm ? (
                <Card>
                  <CardContent className="pt-4 space-y-4">
                    <h3 className="font-semibold">{formData.Pieza ? `Editando: ${formData.Pieza}` : "Nueva pieza"}</h3>
                    <div className="space-y-1.5">
                      <Label>Nombre pieza *</Label>
                      <Input value={formData.Pieza} onChange={(e) => setFormData({...formData, Pieza: e.target.value})} placeholder="Ej: Lámparas" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Categoría</Label>
                      <Select
                        value={normalizeCategoria(formData.Categoria)}
                        onValueChange={(v) => setFormData({ ...formData, Categoria: v })}
                      >
                        <SelectTrigger><SelectValue placeholder="Seleccionar categoría" /></SelectTrigger>
                        <SelectContent>
                          {CATEGORIAS_TECNICAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Prioridad</Label>
                        <Select value={formData.Prioridad} onValueChange={(v) => setFormData({...formData, Prioridad: v as PiezaCatalogo["Prioridad"]})}>
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
                        <Select value={formData.Tipo} onValueChange={(v) => setFormData({...formData, Tipo: v as PiezaCatalogo["Tipo"]})}>
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
                      <Label>Función</Label>
                      <Input value={formData.Funcion} onChange={(e) => setFormData({...formData, Funcion: e.target.value})} placeholder="¿Para qué sirve?" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Fallas comunes</Label>
                      <Input value={formData.FallasComunes} onChange={(e) => setFormData({...formData, FallasComunes: e.target.value})} placeholder="Ej: Error 12.1, bajo flujo" />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button onClick={handleSavePieza} className="flex-1"><Save className="h-4 w-4 mr-2" />Guardar</Button>
                      <Button variant="outline" onClick={() => setShowForm(false)}><X className="h-4 w-4" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ) : selectedPiezaData ? (
                <Card>
                  <CardContent className="pt-4 space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-lg">{selectedPiezaData.Pieza}</h3>
                        <p className="text-sm text-muted-foreground">{normalizeCategoria(selectedPiezaData.Categoria)}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => { setFormData(selectedPiezaData); setShowForm(true) }}><Wrench className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleteDialog(selectedPiezaData)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Badge className={prioColors[selectedPiezaData.Prioridad] || ""}>{selectedPiezaData.Prioridad}</Badge>
                      <Badge variant="outline">{selectedPiezaData.Tipo}</Badge>
                    </div>
                    {selectedPiezaData.Funcion && <div><p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Función</p><p className="text-sm">{selectedPiezaData.Funcion}</p></div>}
                    {selectedPiezaData.FallasComunes && (
                      <div className="bg-destructive/10 rounded-lg p-3">
                        <p className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1"><AlertCircle className="h-3 w-3" />Fallas comunes</p>
                        <p className="text-sm">{selectedPiezaData.FallasComunes}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card><CardContent className="py-16 text-center text-muted-foreground">
                  <Wrench className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>Selecciona una pieza para ver sus detalles</p>
                </CardContent></Card>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── TAB ERRORES ────────────────────────────────────────────────────── */}
      {activeTab === "errores" && (
        <>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Buscar por código, descripción, solución..." value={searchError} onChange={(e) => setSearchError(e.target.value)} className="pl-9 pr-9" />
                  {searchError && <button onClick={() => setSearchError("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
                </div>
                <Select value={errorSort} onValueChange={setErrorSort}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Codigo">Orden: Código</SelectItem>
                    <SelectItem value="Prioridad">Orden: Prioridad</SelectItem>
                    <SelectItem value="Descripcion">Orden: Descripción</SelectItem>
                    <SelectItem value="Equipo">Orden: Equipo</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={() => { setErrorForm(emptyError); setShowErrorForm(true); setSelectedError(null) }}>
                  <Plus className="h-4 w-4 mr-2" /> Nuevo error
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{filteredErrores.length} de {errores.length} códigos de error</p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Lista errores */}
            <div className="space-y-2">
              {filteredErrores.length === 0 ? (
                <Card><CardContent className="py-16 text-center text-muted-foreground">
                  <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>Sin resultados</p>
                </CardContent></Card>
              ) : filteredErrores.map((err, errIndex) => (
                <button key={err.id} onClick={() => { setSelectedError(err); setShowErrorForm(false) }}
                  className={`w-full text-left rounded-lg border transition-colors p-3 flex items-start gap-3 ${selectedError?.id === err.id ? "bg-primary/10 border-primary/40" : "bg-card border-border hover:bg-secondary/20"}`}>
                  <span className="mt-0.5 w-7 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground/70">{errIndex + 1}.</span>
                  <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${prioDot[err.Prioridad] || "bg-gray-400"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-primary text-sm">Error {err.Codigo}</span>
                      <Badge variant="outline" className={`text-xs ${prioColors[err.Prioridad] || ""}`}>{err.Prioridad}</Badge>
                    </div>
                    <p className="text-sm font-medium truncate mt-0.5">{err.Descripcion}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{err.Causa}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Detalle / Form error */}
            <div>
              {showErrorForm ? (
                <Card>
                  <CardContent className="pt-4 space-y-4">
                    <h3 className="font-semibold">{errorForm.id && errores.find(e=>e.id===errorForm.id) ? "Editar código de error" : "Nuevo código de error"}</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Código *</Label>
                        <Input value={errorForm.Codigo} onChange={(e) => setErrorForm({...errorForm, Codigo: e.target.value})} placeholder="Ej: 12.1" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Prioridad</Label>
                        <Select value={errorForm.Prioridad} onValueChange={(v) => setErrorForm({...errorForm, Prioridad: v as CodigoError["Prioridad"]})}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Alta">Alta</SelectItem>
                            <SelectItem value="Media">Media</SelectItem>
                            <SelectItem value="Baja">Baja</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Descripción *</Label>
                      <Input value={errorForm.Descripcion} onChange={(e) => setErrorForm({...errorForm, Descripcion: e.target.value})} placeholder="¿Qué indica este error?" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Causa probable</Label>
                      <Input value={errorForm.Causa} onChange={(e) => setErrorForm({...errorForm, Causa: e.target.value})} placeholder="¿Por qué ocurre?" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Solución / Acción</Label>
                      <Input value={errorForm.Solucion} onChange={(e) => setErrorForm({...errorForm, Solucion: e.target.value})} placeholder="¿Cómo resolverlo?" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Equipo</Label>
                      <Input value={errorForm.Equipo} onChange={(e) => setErrorForm({...errorForm, Equipo: e.target.value})} placeholder="Ej: GentleYAG" />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button onClick={handleSaveError} className="flex-1"><Save className="h-4 w-4 mr-2" />Guardar</Button>
                      <Button variant="outline" onClick={() => setShowErrorForm(false)}><X className="h-4 w-4" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ) : selectedError ? (
                <Card>
                  <CardContent className="pt-4 space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono font-bold text-primary text-xl">Error {selectedError.Codigo}</span>
                        <p className="text-sm text-muted-foreground mt-0.5">{selectedError.Equipo}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => { setErrorForm(selectedError); setShowErrorForm(true) }}><Wrench className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleteErrorDialog(selectedError)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </div>
                    <Badge className={prioColors[selectedError.Prioridad] || ""}>{selectedError.Prioridad}</Badge>
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Descripción</p>
                      <p className="text-sm font-medium">{selectedError.Descripcion}</p>
                    </div>
                    {selectedError.Causa && (
                      <div className="bg-orange-500/10 rounded-lg p-3">
                        <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Causa probable</p>
                        <p className="text-sm">{selectedError.Causa}</p>
                      </div>
                    )}
                    {selectedError.Solucion && (
                      <div className="bg-green-500/10 rounded-lg p-3">
                        <p className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1">✓ Solución</p>
                        <p className="text-sm">{selectedError.Solucion}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card><CardContent className="py-16 text-center text-muted-foreground">
                  <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>Selecciona un código de error para ver su solución</p>
                </CardContent></Card>
              )}
            </div>
          </div>
        </>
      )}

      {/* Dialog eliminar pieza */}
      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>¿Eliminar pieza?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Se eliminará <strong>{deleteDialog?.Pieza}</strong> del catálogo.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeletePieza}><Trash2 className="h-4 w-4 mr-2" />Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog eliminar error */}
      <Dialog open={!!deleteErrorDialog} onOpenChange={() => setDeleteErrorDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>¿Eliminar código de error?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Se eliminará el error <strong>{deleteErrorDialog?.Codigo}</strong>.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteErrorDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => { setErrores(errores.filter(e => e.id !== deleteErrorDialog?.id)); setDeleteErrorDialog(null); setSelectedError(null); showToast("Error eliminado", "success") }}>
              <Trash2 className="h-4 w-4 mr-2" />Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
