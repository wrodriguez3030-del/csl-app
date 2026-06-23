"use client"

import { useEffect, useMemo, useState } from "react"
import { useAppStore, apiJsonp, apiCallCached, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  ListChecks, Plus, Search, Trash2, Pencil, RotateCcw, ChevronDown, ChevronRight,
  PackageCheck, Circle, CheckCircle2, X, Save, Printer, PackagePlus, Paperclip, Loader2, FileText,
} from "lucide-react"
import type { PiezaPolizaLista, PiezaCatalogo, ReceivedStatus } from "@/lib/types"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { useSessionUser } from "@/hooks/use-session-user"
import { printPiezasPoliza } from "@/lib/piezas-poliza-pdf"
import { CATEGORIAS_TECNICAS, normalizeCategoria } from "@/lib/categorias"
import { supabaseBrowser } from "@/lib/supabase-client"

// ── Estados de recepción: etiquetas y colores de badge ────────────────────
const RECEPCION_LABEL: Record<ReceivedStatus, string> = {
  pendiente: "Pendiente",
  recibida_parcial: "Recibida parcial",
  recibida_completa: "Recibida completa",
  cancelada: "Cancelada",
}
const RECEPCION_BADGE: Record<ReceivedStatus, string> = {
  pendiente: "bg-amber-100 text-amber-700 border-amber-200",
  recibida_parcial: "bg-orange-100 text-orange-700 border-orange-200",
  recibida_completa: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelada: "bg-red-100 text-red-700 border-red-200",
}

type RecepcionForm = {
  receivedStatus: ReceivedStatus | "auto"
  receivedAt: string
  receivedQuantity: string
  receivedBy: string
  receivedNote: string
  receivedInvoiceNumber: string
  receivedCost: string
  receivedSupplier: string
  receivedAttachmentUrl: string
}

const emptyRecepcion: RecepcionForm = {
  receivedStatus: "auto",
  receivedAt: "",
  receivedQuantity: "",
  receivedBy: "",
  receivedNote: "",
  receivedInvoiceNumber: "",
  receivedCost: "",
  receivedSupplier: "",
  receivedAttachmentUrl: "",
}

type FormState = {
  id?: string
  piezaNombre: string
  categoriaSnapshot: string
  cantidad: number
  suplidor: string
  sucursal: string
  fechaSolicitada: string
  prioridad: "Baja" | "Media" | "Alta"
  nota: string
}

const emptyForm: FormState = {
  piezaNombre: "",
  categoriaSnapshot: "",
  cantidad: 1,
  suplidor: "",
  sucursal: "",
  fechaSolicitada: new Date().toISOString().slice(0, 10),
  prioridad: "Media",
  nota: "",
}

const emptyPieza: PiezaCatalogo = {
  Pieza: "", Categoria: "", Prioridad: "Media", Tipo: "Consumible",
  Funcion: "", FallasComunes: "", Activa: "Sí",
}

const prioBadge: Record<string, string> = {
  Alta: "bg-red-100 text-red-700 border-red-200",
  Media: "bg-blue-100 text-blue-700 border-blue-200",
  Baja: "bg-emerald-100 text-emerald-700 border-emerald-200",
}

export function PiezasPolizaPage() {
  const { db, setDb, apiUrl, showToast, incrementFormOpen, decrementFormOpen } = useAppStore()
  const business = useCurrentBusiness()
  const sessionUser = useSessionUser()

  const [items, setItems] = useState<PiezaPolizaLista[]>([])
  const [loading, setLoading] = useState(true)

  // Modal principal (agregar / editar item de la lista).
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)

  // Combobox del catálogo: query libre + dropdown filtrado.
  const [piezaQuery, setPiezaQuery] = useState("")
  const [piezaDropdownOpen, setPiezaDropdownOpen] = useState(false)

  // Modal anidado para crear pieza nueva en el catálogo cuando no existe.
  const [showNuevaPieza, setShowNuevaPieza] = useState(false)
  const [nuevaPiezaForm, setNuevaPiezaForm] = useState<PiezaCatalogo>(emptyPieza)
  const [savingNuevaPieza, setSavingNuevaPieza] = useState(false)

  // Filtros de la lista.
  const [search, setSearch] = useState("")
  const [filterSuplidor, setFilterSuplidor] = useState("todos")
  const [filterPrioridad, setFilterPrioridad] = useState("todas")
  const [filterRecepcion, setFilterRecepcion] = useState<"todas" | ReceivedStatus>("todas")
  const [filterSucursal, setFilterSucursal] = useState("todas")

  // Recepción de pieza (sección dentro del modal de edición).
  const [recepcion, setRecepcion] = useState<RecepcionForm>(emptyRecepcion)
  const [savingRecepcion, setSavingRecepcion] = useState(false)
  const [uploadingEvidencia, setUploadingEvidencia] = useState(false)
  const [recepcionAlreadyDone, setRecepcionAlreadyDone] = useState(false)

  // Recibidas colapsable (cerrado por defecto para que el foco sea pendientes).
  const [recibidasOpen, setRecibidasOpen] = useState(false)

  // Confirmar delete.
  const [deleteDialog, setDeleteDialog] = useState<PiezaPolizaLista | null>(null)

  const loadItems = async () => {
    const endpoint = normalizeApiUrl(apiUrl)
    try {
      const result = await apiCallCached(endpoint, { action: "getPiezasPolizaLista" })
      if (result && result.ok) {
        setItems(((result.records as PiezaPolizaLista[]) || []))
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al cargar la lista", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadItems()
    // El catálogo de piezas y sucursales vienen del db global.
    // No re-disparamos getAllData acá: el shell ya lo hizo al login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl])

  // Cuando se abre un modal, levantamos el guard para que el auto-refresh
  // del shell no recargue el db por debajo y haga jumping del select.
  useEffect(() => {
    if (showAddModal || showNuevaPieza) {
      incrementFormOpen()
      return () => decrementFormOpen()
    }
  }, [showAddModal, showNuevaPieza, incrementFormOpen, decrementFormOpen])

  // ─── Listas derivadas para filtros ──────────────────────────────────────

  const suplidoresExistentes = useMemo(() => {
    const set = new Set<string>()
    items.forEach((i) => { if (i.Suplidor) set.add(i.Suplidor) })
    return Array.from(set).sort()
  }, [items])

  const sucursalesNombres = useMemo(
    () => (db.sucursales || []).map((s) => s.Nombre).filter(Boolean).sort(),
    [db.sucursales]
  )

  // ─── Combobox del catálogo de piezas ───────────────────────────────────

  const piezasCatalogo = db.piezas || []
  const piezaMatches = useMemo(() => {
    const q = piezaQuery.trim().toLowerCase()
    if (!q) return piezasCatalogo.slice(0, 20)
    return piezasCatalogo
      .filter((p) => `${p.Pieza} ${p.Categoria}`.toLowerCase().includes(q))
      .slice(0, 20)
  }, [piezaQuery, piezasCatalogo])

  const piezaExactMatch = useMemo(
    () => piezasCatalogo.find((p) => p.Pieza.toLowerCase() === piezaQuery.trim().toLowerCase()),
    [piezaQuery, piezasCatalogo]
  )

  const handleSelectPieza = (pieza: PiezaCatalogo) => {
    setForm((f) => ({ ...f, piezaNombre: pieza.Pieza, categoriaSnapshot: pieza.Categoria || "" }))
    setPiezaQuery(pieza.Pieza)
    setPiezaDropdownOpen(false)
  }

  // ─── Filtrado de la lista ──────────────────────────────────────────────

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (filterRecepcion !== "todas" && (i.ReceivedStatus || "pendiente") !== filterRecepcion) return false
      if (filterSuplidor !== "todos" && (i.Suplidor || "") !== filterSuplidor) return false
      if (filterPrioridad !== "todas" && i.Prioridad !== filterPrioridad) return false
      if (filterSucursal !== "todas" && (i.Sucursal || "") !== filterSucursal) return false
      if (search) {
        const q = search.toLowerCase()
        const txt = [i.PiezaNombre, i.CategoriaSnapshot, i.Suplidor, i.Nota, i.Sucursal].filter(Boolean).join(" ").toLowerCase()
        if (!txt.includes(q)) return false
      }
      return true
    })
  }, [items, search, filterSuplidor, filterPrioridad, filterRecepcion, filterSucursal])

  const pendientes = filtered.filter((i) => i.Estado === "pendiente")
  const recibidas = filtered.filter((i) => i.Estado === "recibida")

  // Estado de recepción que se aplicaría con los valores actuales del form
  // (modo "auto": derivado de la cantidad recibida vs la solicitada).
  const recepcionQty = Number(recepcion.receivedQuantity) || 0
  const recepcionDerivedStatus: ReceivedStatus =
    recepcion.receivedStatus !== "auto"
      ? recepcion.receivedStatus
      : recepcionQty <= 0
        ? "pendiente"
        : recepcionQty < (form.cantidad || 0)
          ? "recibida_parcial"
          : "recibida_completa"

  const handlePrintPdf = () => {
    printPiezasPoliza({
      business,
      pendientes,
      recibidas,
      filtros: {
        busqueda: search,
        estado: filterRecepcion === "todas" ? "todas" : RECEPCION_LABEL[filterRecepcion],
        prioridad: filterPrioridad,
        suplidor: filterSuplidor,
        sucursal: filterSucursal,
      },
      generadoEn: new Date().toLocaleString("es-DO", { dateStyle: "long", timeStyle: "short" }),
      generadoPor: sessionUser?.nombre || sessionUser?.username || undefined,
      origin: window.location.origin,
    })
  }

  // ─── Save/delete/toggle handlers ───────────────────────────────────────

  const openNew = () => {
    setEditingId(null)
    setForm({ ...emptyForm, fechaSolicitada: new Date().toISOString().slice(0, 10) })
    setPiezaQuery("")
    setShowAddModal(true)
  }

  const openEdit = (item: PiezaPolizaLista) => {
    setEditingId(item.id)
    setForm({
      id: item.id,
      piezaNombre: item.PiezaNombre,
      categoriaSnapshot: item.CategoriaSnapshot || "",
      cantidad: item.Cantidad,
      suplidor: item.Suplidor || "",
      sucursal: item.Sucursal || "",
      fechaSolicitada: item.FechaSolicitada,
      prioridad: item.Prioridad,
      nota: item.Nota || "",
    })
    // Cargar la ficha de recepción existente (si la hay).
    const yaRecibida = !!item.ReceivedAt
    setRecepcionAlreadyDone(yaRecibida)
    setRecepcion({
      receivedStatus: yaRecibida && item.ReceivedStatus ? item.ReceivedStatus : "auto",
      receivedAt: item.ReceivedAt || "",
      receivedQuantity: item.ReceivedQuantity != null ? String(item.ReceivedQuantity) : "",
      receivedBy: item.ReceivedBy || sessionUser?.nombre || sessionUser?.username || "",
      receivedNote: item.ReceivedNote || "",
      receivedInvoiceNumber: item.ReceivedInvoiceNumber || "",
      receivedCost: item.ReceivedCost != null ? String(item.ReceivedCost) : "",
      receivedSupplier: item.ReceivedSupplier || item.Suplidor || "",
      receivedAttachmentUrl: item.ReceivedAttachmentUrl || "",
    })
    setPiezaQuery(item.PiezaNombre)
    setShowAddModal(true)
  }

  const handleSave = async () => {
    if (!form.piezaNombre.trim()) {
      showToast("Selecciona una pieza del catálogo", "error")
      return
    }
    if (form.cantidad < 1) {
      showToast("La cantidad debe ser al menos 1", "error")
      return
    }
    setSaving(true)
    try {
      const endpoint = normalizeApiUrl(apiUrl)
      const result = await apiJsonp(endpoint, {
        action: "savePiezaPolizaLista",
        id: form.id || "",
        piezaNombre: form.piezaNombre,
        categoriaSnapshot: form.categoriaSnapshot,
        cantidad: form.cantidad,
        suplidor: form.suplidor,
        sucursal: form.sucursal,
        prioridad: form.prioridad,
        fechaSolicitada: form.fechaSolicitada,
        nota: form.nota,
        estado: "pendiente",
      })
      if (!result?.ok) throw new Error((result as { error?: string })?.error || "Error al guardar")
      invalidateReadCache("getPiezasPolizaLista")
      await loadItems()
      showToast(editingId ? "Pieza actualizada" : "Pieza agregada a la lista", "success")
      setShowAddModal(false)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al guardar", "error")
    } finally {
      setSaving(false)
    }
  }

  // ─── Recepción de pieza ────────────────────────────────────────────────

  const handleUploadEvidencia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // permitir re-seleccionar el mismo archivo
    if (!file || !editingId) return
    setUploadingEvidencia(true)
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession()
      if (!session?.access_token) throw new Error("Sesión no válida — vuelve a iniciar sesión")
      const fd = new FormData()
      fd.append("file", file)
      fd.append("pieza_id", editingId)
      const response = await fetch("/api/maintenance/documents/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      })
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; path?: string; error?: string }
      if (!result.ok || !result.path) throw new Error(result.error || "No se pudo subir el archivo")
      setRecepcion((r) => ({ ...r, receivedAttachmentUrl: result.path as string }))
      showToast("Evidencia adjuntada", "success")
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al subir la evidencia", "error")
    } finally {
      setUploadingEvidencia(false)
    }
  }

  const handleSaveRecepcion = async () => {
    if (!editingId) return
    setSavingRecepcion(true)
    try {
      const endpoint = normalizeApiUrl(apiUrl)
      const result = await apiJsonp(endpoint, {
        action: "savePiezaPolizaRecepcion",
        id: editingId,
        receivedStatus: recepcion.receivedStatus === "auto" ? "" : recepcion.receivedStatus,
        receivedAt: recepcion.receivedAt,
        receivedQuantity: recepcion.receivedQuantity,
        receivedBy: recepcion.receivedBy,
        receivedNote: recepcion.receivedNote,
        receivedInvoiceNumber: recepcion.receivedInvoiceNumber,
        receivedCost: recepcion.receivedCost,
        receivedSupplier: recepcion.receivedSupplier,
        receivedAttachmentUrl: recepcion.receivedAttachmentUrl,
      })
      if (!result?.ok) throw new Error((result as { error?: string })?.error || "Error al guardar la recepción")
      invalidateReadCache("getPiezasPolizaLista")
      await loadItems()
      showToast(recepcionAlreadyDone ? "Recepción actualizada" : "Recepción registrada", "success")
      setShowAddModal(false)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al guardar la recepción", "error")
    } finally {
      setSavingRecepcion(false)
    }
  }

  const handleSaveNuevaPieza = async () => {
    const nombre = nuevaPiezaForm.Pieza.trim()
    if (!nombre) {
      showToast("Nombre de la pieza es obligatorio", "error")
      return
    }
    if (piezasCatalogo.some((p) => p.Pieza.toLowerCase() === nombre.toLowerCase())) {
      showToast("Ya existe una pieza con ese nombre en el catálogo", "error")
      return
    }
    setSavingNuevaPieza(true)
    try {
      const endpoint = normalizeApiUrl(apiUrl)
      const result = await apiJsonp(endpoint, {
        action: "savePieza",
        pieza: nombre,
        categoria: nuevaPiezaForm.Categoria || "",
        prioridad: nuevaPiezaForm.Prioridad,
        tipo: nuevaPiezaForm.Tipo,
        funcion: nuevaPiezaForm.Funcion || "",
        fallasComunes: nuevaPiezaForm.FallasComunes || "",
        activa: "Sí",
      })
      if (!result?.ok) throw new Error((result as { error?: string })?.error || "Error al guardar pieza")
      // Optimistic: añadir al db global para que el combobox la vea de inmediato.
      const nueva: PiezaCatalogo = { ...nuevaPiezaForm, Pieza: nombre, Activa: "Sí" }
      setDb({ ...db, piezas: [...piezasCatalogo, nueva] })
      // Auto-seleccionar en el form padre.
      setForm((f) => ({ ...f, piezaNombre: nombre, categoriaSnapshot: nueva.Categoria || "" }))
      setPiezaQuery(nombre)
      setShowNuevaPieza(false)
      setNuevaPiezaForm(emptyPieza)
      showToast(`Pieza "${nombre}" agregada al catálogo`, "success")
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al guardar pieza", "error")
    } finally {
      setSavingNuevaPieza(false)
    }
  }

  const handleToggleRecibida = async (item: PiezaPolizaLista) => {
    const next = item.Estado === "pendiente" ? "recibida" : "pendiente"
    // Optimistic update
    setItems((prev) => prev.map((p) => p.id === item.id ? { ...p, Estado: next, FechaRecibida: next === "recibida" ? new Date().toISOString().slice(0, 10) : null } : p))
    try {
      const endpoint = normalizeApiUrl(apiUrl)
      const result = await apiJsonp(endpoint, {
        action: next === "recibida" ? "markPiezaPolizaRecibida" : "markPiezaPolizaPendiente",
        id: item.id,
      })
      if (!result?.ok) throw new Error((result as { error?: string })?.error || "Error")
      invalidateReadCache("getPiezasPolizaLista")
      showToast(next === "recibida" ? "Marcada como recibida" : "Devuelta a pendientes", "success")
    } catch (error) {
      // Revertir
      setItems((prev) => prev.map((p) => p.id === item.id ? item : p))
      showToast(error instanceof Error ? error.message : "Error al actualizar", "error")
    }
  }

  const handleDelete = async (item: PiezaPolizaLista) => {
    try {
      const endpoint = normalizeApiUrl(apiUrl)
      const result = await apiJsonp(endpoint, { action: "deletePiezaPolizaLista", id: item.id })
      if (!result?.ok) throw new Error((result as { error?: string })?.error || "Error")
      setItems((prev) => prev.filter((p) => p.id !== item.id))
      invalidateReadCache("getPiezasPolizaLista")
      showToast("Pieza eliminada", "success")
      setDeleteDialog(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al eliminar", "error")
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Toolbar: filtros + botón agregar */}
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 flex-1">
              <div className="relative sm:col-span-2 lg:col-span-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8 h-9"
                  placeholder="Buscar pieza, suplidor, nota..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={filterRecepcion} onValueChange={(v) => setFilterRecepcion(v as typeof filterRecepcion)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Recepción" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  <SelectItem value="pendiente">Pendientes</SelectItem>
                  <SelectItem value="recibida_parcial">Recibida parcial</SelectItem>
                  <SelectItem value="recibida_completa">Recibida completa</SelectItem>
                  <SelectItem value="cancelada">Canceladas</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterPrioridad} onValueChange={setFilterPrioridad}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Prioridad" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas las prioridades</SelectItem>
                  <SelectItem value="Alta">Alta</SelectItem>
                  <SelectItem value="Media">Media</SelectItem>
                  <SelectItem value="Baja">Baja</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterSuplidor} onValueChange={setFilterSuplidor}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Suplidor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los suplidores</SelectItem>
                  {suplidoresExistentes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterSucursal} onValueChange={setFilterSucursal}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Sucursal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas las sucursales</SelectItem>
                  {sucursalesNombres.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button onClick={handlePrintPdf} variant="outline" className="h-9">
                <Printer className="mr-1.5 h-4 w-4" />
                Imprimir PDF
              </Button>
              <Button onClick={openNew} className="h-9">
                <Plus className="mr-1.5 h-4 w-4" />
                Agregar pieza
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Circle className="h-3 w-3" /> Pendientes: <b className="text-foreground">{items.filter((i) => i.Estado === "pendiente").length}</b></span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Recibidas: <b className="text-foreground">{items.filter((i) => i.Estado === "recibida").length}</b></span>
            <span>Total: <b className="text-foreground">{items.length}</b></span>
          </div>
        </CardContent>
      </Card>

      {/* Pendientes */}
      <Card className="border-[color:var(--brand-border)]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4 text-[color:var(--brand-primary)]" />
            Pendientes por recibir
            <Badge variant="secondary" className="ml-1">{pendientes.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Cargando lista...</div>
          ) : pendientes.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No hay piezas pendientes. Agrega una con el botón de arriba.
            </div>
          ) : (
            <div className="space-y-2">
              {pendientes.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onToggle={() => handleToggleRecibida(item)}
                  onEdit={() => openEdit(item)}
                  onDelete={() => setDeleteDialog(item)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recibidas (colapsable) */}
      <Card className="border-[color:var(--brand-border)]">
        <button
          type="button"
          onClick={() => setRecibidasOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50/60"
        >
          <span className="flex items-center gap-2 text-base font-semibold">
            <PackageCheck className="h-4 w-4 text-emerald-600" />
            Recibidas
            <Badge variant="secondary" className="ml-1">{recibidas.length}</Badge>
          </span>
          {recibidasOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        </button>
        {recibidasOpen ? (
          <CardContent className="pt-0">
            {recibidas.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Aún no hay piezas recibidas.</div>
            ) : (
              <div className="space-y-2">
                {recibidas.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onToggle={() => handleToggleRecibida(item)}
                    onEdit={() => openEdit(item)}
                    onDelete={() => setDeleteDialog(item)}
                    received
                  />
                ))}
              </div>
            )}
          </CardContent>
        ) : null}
      </Card>

      {/* Modal: agregar/editar pieza de la lista */}
      <Dialog open={showAddModal} onOpenChange={(o) => !o && setShowAddModal(false)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar pieza" : "Agregar pieza a la lista"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {/* Combobox catálogo: input + dropdown filtrado */}
            <div>
              <Label className="text-xs">Pieza del catálogo *</Label>
              <div className="relative mt-1">
                <Input
                  value={piezaQuery}
                  onFocus={() => setPiezaDropdownOpen(true)}
                  onChange={(e) => {
                    setPiezaQuery(e.target.value)
                    setPiezaDropdownOpen(true)
                    // Si el usuario está escribiendo libre, no auto-asociamos
                    // hasta que haga clic en el dropdown — evita guardar nombres
                    // que no están en catálogo.
                    if (!piezasCatalogo.some((p) => p.Pieza === e.target.value)) {
                      setForm((f) => ({ ...f, piezaNombre: "", categoriaSnapshot: "" }))
                    }
                  }}
                  placeholder="Escribe para buscar..."
                />
                {piezaDropdownOpen ? (
                  <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-white shadow-md">
                    {piezaMatches.length === 0 ? (
                      <div className="p-3 text-xs text-muted-foreground">
                        No hay coincidencias.
                      </div>
                    ) : (
                      piezaMatches.map((p) => (
                        <button
                          key={p.Pieza}
                          type="button"
                          onClick={() => handleSelectPieza(p)}
                          className="flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
                        >
                          <span className="flex-1 truncate font-medium">{p.Pieza}</span>
                          {p.Categoria ? <span className="text-[11px] text-muted-foreground">{p.Categoria}</span> : null}
                        </button>
                      ))
                    )}
                    {!piezaExactMatch && piezaQuery.trim() ? (
                      <button
                        type="button"
                        onClick={() => {
                          setNuevaPiezaForm({ ...emptyPieza, Pieza: piezaQuery.trim() })
                          setPiezaDropdownOpen(false)
                          setShowNuevaPieza(true)
                        }}
                        className="flex w-full items-center gap-2 border-t bg-slate-50 px-3 py-2 text-left text-sm font-semibold text-[color:var(--brand-primary)] hover:bg-slate-100"
                      >
                        <Plus className="h-4 w-4" />
                        Nueva pieza: "{piezaQuery.trim()}"
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {form.piezaNombre ? (
                <p className="mt-1 text-[11px] text-emerald-700">
                  Seleccionada: <b>{form.piezaNombre}</b>{form.categoriaSnapshot ? ` (${form.categoriaSnapshot})` : ""}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Debes elegir una pieza del catálogo. Si no existe, créala con "+ Nueva pieza".
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Cantidad *</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.cantidad}
                  onChange={(e) => setForm({ ...form, cantidad: Math.max(1, Number(e.target.value) || 1) })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Prioridad</Label>
                <Select value={form.prioridad} onValueChange={(v) => setForm({ ...form, prioridad: v as FormState["prioridad"] })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Baja">Baja</SelectItem>
                    <SelectItem value="Media">Media</SelectItem>
                    <SelectItem value="Alta">Alta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Suplidor</Label>
                <Input
                  value={form.suplidor}
                  onChange={(e) => setForm({ ...form, suplidor: e.target.value })}
                  placeholder="Ej. Candela, distribuidor..."
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Fecha solicitada</Label>
                <Input
                  type="date"
                  value={form.fechaSolicitada}
                  onChange={(e) => setForm({ ...form, fechaSolicitada: e.target.value })}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Sucursal</Label>
              <Select value={form.sucursal || "_none"} onValueChange={(v) => setForm({ ...form, sucursal: v === "_none" ? "" : v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Sin sucursal</SelectItem>
                  {sucursalesNombres.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Nota</Label>
              <Textarea
                value={form.nota}
                onChange={(e) => setForm({ ...form, nota: e.target.value })}
                placeholder="Opcional"
                className="mt-1 min-h-[60px]"
              />
            </div>

            {/* ── Recepción de pieza (solo al editar una pieza existente) ── */}
            {editingId ? (
              <div className="mt-2 rounded-lg border border-[color:var(--brand-border)] bg-slate-50/60 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <PackagePlus className="h-4 w-4 text-[color:var(--brand-primary)]" />
                  <span className="text-sm font-semibold">Recepción de pieza</span>
                  <Badge variant="outline" className={`ml-auto ${RECEPCION_BADGE[recepcionDerivedStatus]}`}>
                    {RECEPCION_LABEL[recepcionDerivedStatus]}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Estado de recepción</Label>
                    <Select
                      value={recepcion.receivedStatus}
                      onValueChange={(v) => setRecepcion({ ...recepcion, receivedStatus: v as RecepcionForm["receivedStatus"] })}
                    >
                      <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automático (por cantidad)</SelectItem>
                        <SelectItem value="recibida_parcial">Recibida parcial</SelectItem>
                        <SelectItem value="recibida_completa">Recibida completa</SelectItem>
                        <SelectItem value="cancelada">Cancelada</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Fecha de recepción</Label>
                    <Input
                      type="date"
                      value={recepcion.receivedAt}
                      onChange={(e) => setRecepcion({ ...recepcion, receivedAt: e.target.value })}
                      className="mt-1 h-9"
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Cantidad recibida</Label>
                    <Input
                      type="number"
                      min={0}
                      value={recepcion.receivedQuantity}
                      onChange={(e) => setRecepcion({ ...recepcion, receivedQuantity: e.target.value })}
                      placeholder={`de ${form.cantidad}`}
                      className="mt-1 h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Recibido por</Label>
                    <Input
                      value={recepcion.receivedBy}
                      onChange={(e) => setRecepcion({ ...recepcion, receivedBy: e.target.value })}
                      placeholder="Nombre"
                      className="mt-1 h-9"
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">N.º factura / comprobante</Label>
                    <Input
                      value={recepcion.receivedInvoiceNumber}
                      onChange={(e) => setRecepcion({ ...recepcion, receivedInvoiceNumber: e.target.value })}
                      placeholder="Opcional"
                      className="mt-1 h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Costo real</Label>
                    <Input
                      value={recepcion.receivedCost}
                      onChange={(e) => setRecepcion({ ...recepcion, receivedCost: e.target.value })}
                      placeholder="Opcional"
                      className="mt-1 h-9"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <Label className="text-xs">Suplidor final</Label>
                  <Input
                    value={recepcion.receivedSupplier}
                    onChange={(e) => setRecepcion({ ...recepcion, receivedSupplier: e.target.value })}
                    placeholder="Opcional"
                    className="mt-1 h-9"
                  />
                </div>

                <div className="mt-3">
                  <Label className="text-xs">Nota de recepción</Label>
                  <Textarea
                    value={recepcion.receivedNote}
                    onChange={(e) => setRecepcion({ ...recepcion, receivedNote: e.target.value })}
                    placeholder="Opcional"
                    className="mt-1 min-h-[50px]"
                  />
                </div>

                <div className="mt-3">
                  <Label className="text-xs">Evidencia / factura (PDF o imagen)</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
                      {uploadingEvidencia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                      {uploadingEvidencia ? "Subiendo..." : "Adjuntar archivo"}
                      <input
                        type="file"
                        accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"
                        className="hidden"
                        disabled={uploadingEvidencia}
                        onChange={handleUploadEvidencia}
                      />
                    </label>
                    {recepcion.receivedAttachmentUrl ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <FileText className="h-3.5 w-3.5" />
                        {recepcion.receivedAttachmentUrl.split("/").pop()}
                        <button
                          type="button"
                          onClick={() => setRecepcion({ ...recepcion, receivedAttachmentUrl: "" })}
                          className="ml-1 text-slate-400 hover:text-red-600"
                          title="Quitar"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <Button onClick={handleSaveRecepcion} disabled={savingRecepcion} className="h-9">
                    <PackageCheck className="mr-1.5 h-4 w-4" />
                    {savingRecepcion
                      ? "Guardando..."
                      : recepcionAlreadyDone
                        ? "Editar recepción"
                        : "Registrar recepción"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)} disabled={saving}>
              <X className="mr-1 h-4 w-4" /> Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.piezaNombre.trim()}>
              <Save className="mr-1 h-4 w-4" />
              {saving ? "Guardando..." : editingId ? "Actualizar solicitud" : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal anidado: crear pieza nueva en el catálogo */}
      <Dialog open={showNuevaPieza} onOpenChange={(o) => !o && setShowNuevaPieza(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva pieza en catálogo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Nombre de la pieza *</Label>
              <Input
                value={nuevaPiezaForm.Pieza}
                onChange={(e) => setNuevaPiezaForm({ ...nuevaPiezaForm, Pieza: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Categoría</Label>
              <Select
                value={normalizeCategoria(nuevaPiezaForm.Categoria)}
                onValueChange={(v) => setNuevaPiezaForm({ ...nuevaPiezaForm, Categoria: v })}
              >
                <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar categoría" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIAS_TECNICAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Prioridad</Label>
                <Select value={nuevaPiezaForm.Prioridad} onValueChange={(v) => setNuevaPiezaForm({ ...nuevaPiezaForm, Prioridad: v as PiezaCatalogo["Prioridad"] })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Alta">Alta</SelectItem>
                    <SelectItem value="Media-Alta">Media-Alta</SelectItem>
                    <SelectItem value="Media">Media</SelectItem>
                    <SelectItem value="Baja">Baja</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Tipo</Label>
                <Select value={nuevaPiezaForm.Tipo} onValueChange={(v) => setNuevaPiezaForm({ ...nuevaPiezaForm, Tipo: v as PiezaCatalogo["Tipo"] })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNuevaPieza(false)} disabled={savingNuevaPieza}>
              Cancelar
            </Button>
            <Button onClick={handleSaveNuevaPieza} disabled={savingNuevaPieza || !nuevaPiezaForm.Pieza.trim()}>
              {savingNuevaPieza ? "Guardando..." : "Crear y seleccionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar delete */}
      <Dialog open={!!deleteDialog} onOpenChange={(o) => !o && setDeleteDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar pieza</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            ¿Eliminar <b>{deleteDialog?.PiezaNombre}</b> de la lista? Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteDialog && handleDelete(deleteDialog)}>
              <Trash2 className="mr-1 h-4 w-4" /> Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ItemRow({
  item,
  onToggle,
  onEdit,
  onDelete,
  received = false,
}: {
  item: PiezaPolizaLista
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  received?: boolean
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-3 transition-colors sm:flex-row sm:items-center sm:gap-3 ${
        received ? "bg-emerald-50/40 border-emerald-100" : "bg-white hover:bg-slate-50/60"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={received ? "Devolver a pendientes" : "Marcar como recibida"}
        className="shrink-0 self-start sm:self-auto"
      >
        {received
          ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          : <Circle className="h-5 w-5 text-slate-400 hover:text-[color:var(--brand-primary)]" />
        }
      </button>

      <div className="min-w-0 flex-1">
        <div className={`flex flex-wrap items-center gap-2 ${received ? "opacity-70" : ""}`}>
          <span className={`font-semibold ${received ? "line-through" : ""}`}>{item.PiezaNombre}</span>
          {item.CategoriaSnapshot ? <span className="text-xs text-muted-foreground">· {item.CategoriaSnapshot}</span> : null}
          <Badge variant="outline" className={prioBadge[item.Prioridad] || ""}>{item.Prioridad}</Badge>
          {item.ReceivedStatus && item.ReceivedStatus !== "pendiente" ? (
            <Badge variant="outline" className={RECEPCION_BADGE[item.ReceivedStatus]}>
              {RECEPCION_LABEL[item.ReceivedStatus]}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>Cant: <b className="text-foreground">{item.Cantidad}</b></span>
          {item.ReceivedQuantity != null ? <span>Recibida: <b className="text-foreground">{item.ReceivedQuantity}</b></span> : null}
          {item.Suplidor ? <span>Suplidor: <b className="text-foreground">{item.Suplidor}</b></span> : null}
          {item.Sucursal ? <span>Sucursal: <b className="text-foreground">{item.Sucursal}</b></span> : null}
          <span>Solicitada: {item.FechaSolicitada}</span>
          {item.ReceivedAt ? <span className="text-emerald-700">Fecha recepción: {item.ReceivedAt}</span> : null}
        </div>
        {item.Nota ? <p className="mt-1 text-[12px] text-slate-600">{item.Nota}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
        {received ? (
          <Button variant="ghost" size="sm" onClick={onToggle} title="Devolver a pendientes">
            <RotateCcw className="h-4 w-4" />
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onEdit} title="Editar">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} title="Eliminar">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
