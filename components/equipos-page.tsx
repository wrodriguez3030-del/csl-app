"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { SuperadminBusinessFilter, filterValueToBusinessId, type BusinessFilterValue } from "@/components/superadmin-business-filter"
import { loadXLSX } from "@/lib/load-xlsx"
import { fmtN, parseN } from "@/lib/fmt"
import { detectExcelType } from "@/lib/excel-type-detector"
import { parseEquiposBaseWorkbook, type ParsedEquipoBaseRow, type ParseEquiposBaseResult } from "@/lib/equipos-base-parser"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Plus, Power, PowerOff, Save, Trash2, Upload, X } from "lucide-react"
import { RecordActions } from "@/components/record-actions"
import { RecordViewDialog } from "@/components/record-view-dialog"
import type { Equipo } from "@/lib/types"

// Empresa queda vacía por defecto — la rellena el handleSubmit usando
// business.name del tenant activo (CSL → "CIBAO SPA LASER, CSL, S.R.L.",
// Depicenter → "Depicenter Skin Láser", o el equivalente del tenant futuro).
const emptyEquipo: Equipo = {
  EquipoID: "", Sucursal: "", Empresa: "",
  Domicilio: "", Modelo: "", Serie: "", Numero: "",
  P_Cabeza: 0, P_Totales: 0, Max_Cabeza: 6000000,
  Estado: "Activo", Observaciones: "",
  Cabina: "", Operadora: "", OperadoraID: "",
}

const CABINA_OPTIONS = [
  "Cabina 1", "Cabina 2", "Cabina 3", "Cabina 4", "Cabina 5",
  "Cabina 6", "Cabina 7", "Cabina 8", "Cabina 9", "Cabina 10",
  "Backup", "Taller", "Sin asignar",
] as const

// Operadoras conocidas por tenant — respaldo del dropdown cuando el catálogo
// real (dbPulsos.operadoras) no está cargado. Siempre en MAYÚSCULA.
const FALLBACK_OPERADORAS: Record<string, string[]> = {
  // Nombres OFICIALES (tabla de equipos): KATHERIN / EMELI / ROQUELMI.
  csl: ["NAYELI", "LILIAN", "YAMILKA", "KATHERIN", "DIANA", "EMELI", "ROQUELMI", "MADELIN", "ROSA", "SAHOMY", "YESSICA"],
  depicenter: ["SELENIA", "CLARIBEL", "NOELIA", "EVELINA"],
}

/** Si la cabina viene legacy en Observaciones (texto libre tipo "CABINA 1 -
 *  YAMILKA"), intentamos detectar el valor canonical para pre-llenar el
 *  dropdown al editar. */
function detectarCabinaLegacy(observaciones: string | undefined): string {
  if (!observaciones) return ""
  const s = observaciones.toUpperCase()
  for (let i = 10; i >= 1; i -= 1) {
    if (s.includes(`CABINA ${i}`)) return `Cabina ${i}`
  }
  if (s.includes("BACKUP")) return "Backup"
  if (s.includes("TALLER")) return "Taller"
  return ""
}

export function EquiposPage() {
  const { db, setDb, dbPulsos, apiUrl, showToast, editingEquipo, setEditingEquipo } = useAppStore()
  // Business activo — usado para defaultear Empresa al crear equipo nuevo.
  const business = useCurrentBusiness()
  // Filtro superadmin: si el user no es superadmin, el banner no se
  // renderiza y este state queda sin uso. Si es superadmin, controla
  // qué subset de db.equipos se muestra en la tabla.
  const [adminFilter, setAdminFilter] = useState<BusinessFilterValue>("all")

  const [formData, setFormData] = useState<Equipo>(emptyEquipo)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<Equipo | null>(null)
  const [viewEquipo, setViewEquipo] = useState<Equipo | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<{ filename: string; parsed: ParseEquiposBaseResult } | null>(null)
  const [importing, setImporting] = useState(false)
  const [parsingFile, setParsingFile] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Lista de operadoras desde dbPulsos — usada por el dropdown del modal.
  const operadorasActivas = useMemo(() => {
    return dbPulsos.operadoras
      .filter((o) => (o.Estado || "Activa") !== "Inactiva")
      .sort((a, b) => (a.Nombre || "").localeCompare(b.Nombre || "", "es"))
  }, [dbPulsos.operadoras])

  // Opciones del dropdown de operadora (SIEMPRE en MAYÚSCULA): catálogo real del
  // tenant + lista conocida de respaldo (por si dbPulsos.operadoras no está
  // cargado) + la operadora actual del equipo. Garantiza poder asignarla.
  const operadoraOptions = useMemo(() => {
    const set = new Set<string>()
    for (const o of operadorasActivas) { const n = (o.Nombre || "").trim().toUpperCase(); if (n) set.add(n) }
    for (const n of (FALLBACK_OPERADORAS[business.slug] || [])) set.add(n)
    if (formData.Operadora) set.add(formData.Operadora.trim().toUpperCase())
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"))
  }, [operadorasActivas, business.slug, formData.Operadora])

  // Reportes relacionados al equipo abierto (mostrados como extraSlot del dialog).
  const reportesEquipo = viewEquipo
    ? db.reportes
        .filter((r) => r.EquipoID === viewEquipo.EquipoID)
        .sort((a, b) => String(b.Fecha || "").localeCompare(String(a.Fecha || "")))
    : []
  const [sortCol, setSortCol] = useState<string>("EquipoID")
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc")

  const activeSucursales = db.sucursales.filter(s => s.Estado === "Activa")

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }

  const sortIcon = (col: string) => {
    if (sortCol !== col) return <span className="text-muted-foreground/30 ml-1">⇅</span>
    return <span className="ml-1 text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>
  }

  // Aplicar el filtro superadmin ANTES del sort. Si el user no es
  // superadmin, adminFilter queda en "all" sin efecto (el banner no se
  // renderiza). Si es superadmin, filtra a CSL o Depicenter según selección.
  const adminFilterBizId = filterValueToBusinessId(adminFilter)
  const filteredEquipos = adminFilterBizId
    ? db.equipos.filter((e) => e.business_id === adminFilterBizId)
    : db.equipos
  const sortedEquipos = [...filteredEquipos].sort((a, b) => {
    let va: string | number = ""
    let vb: string | number = ""
    switch(sortCol) {
      case "EquipoID": va = Number(a.EquipoID) || 0; vb = Number(b.EquipoID) || 0; break
      case "Sucursal": va = a.Sucursal; vb = b.Sucursal; break
      case "Cabina": va = a.Cabina || ""; vb = b.Cabina || ""; break
      case "Operadora": va = a.Operadora || ""; vb = b.Operadora || ""; break
      case "Modelo": va = a.Modelo; vb = b.Modelo; break
      case "Serie": va = a.Serie || ""; vb = b.Serie || ""; break
      case "P_Cabeza": va = Number(a.P_Cabeza) || 0; vb = Number(b.P_Cabeza) || 0; break
      case "P_Totales": va = Number(a.P_Totales) || 0; vb = Number(b.P_Totales) || 0; break
      case "Estado": va = a.Estado; vb = b.Estado; break
      default: va = a.EquipoID; vb = b.EquipoID
    }
    if (typeof va === "string") { va = va.toLowerCase(); vb = (vb as string).toLowerCase() }
    if (va < vb) return sortDir === "asc" ? -1 : 1
    if (va > vb) return sortDir === "asc" ? 1 : -1
    return 0
  })

  useEffect(() => {
    if (editingEquipo) {
      // Pre-llenamos cabina desde Observaciones legacy si no estaba seteada.
      const cabinaLegacy = !editingEquipo.Cabina ? detectarCabinaLegacy(editingEquipo.Observaciones) : ""
      setFormData({
        ...editingEquipo,
        Cabina: editingEquipo.Cabina || cabinaLegacy || "",
        Operadora: editingEquipo.Operadora || "",
        OperadoraID: editingEquipo.OperadoraID || "",
      })
      setIsFormOpen(true)
    }
  }, [editingEquipo])

  const handleSubmit = async () => {
    if (!formData.EquipoID) { showToast("El ID del equipo es obligatorio", "error"); return }
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) { showToast("API no configurada", "error"); return }
    const exists = db.equipos.find(e => e.EquipoID === formData.EquipoID)
    const snapshot = formData

    let params: Record<string, string>
    if (exists) {
      // UPDATE PARCIAL — solo envía campos con valor no vacío (preserva en DB
      // lo no editado). Filtra por business_id + equipo_id en backend.
      params = { action: "updateEquipoCampos", equipoId: snapshot.EquipoID }
      const put = (key: string, val: string | number | null | undefined) => {
        if (val === null || val === undefined) return
        const s = String(val).trim()
        if (s) params[key] = s
      }
      put("sucursal", snapshot.Sucursal)
      put("empresa", snapshot.Empresa)
      put("domicilio", snapshot.Domicilio)
      put("modelo", snapshot.Modelo)
      put("serie", snapshot.Serie)
      put("numero", snapshot.Numero)
      put("pcabeza", snapshot.P_Cabeza)
      put("ptotales", snapshot.P_Totales)
      put("maxCabeza", snapshot.Max_Cabeza)
      put("estado", snapshot.Estado)
      put("observaciones", snapshot.Observaciones)
      // Dropdowns (cabina/operadora/operadoraId): SIEMPRE se envían — con el
      // sentinel "__CLEAR__" cuando quedan vacíos — para poder cambiarlos Y
      // poder dejarlos en "Sin asignar". Si se enviaran solo cuando no-vacíos
      // (como los demás campos), nunca se podrían limpiar y "volverían" al
      // valor viejo tras guardar.
      const CLEAR = "__CLEAR__"
      const dropdownOrClear = (val: string | null | undefined) => {
        const s = val == null ? "" : String(val).trim()
        return s ? s : CLEAR
      }
      params.cabina = dropdownOrClear(snapshot.Cabina)
      params.operadora = dropdownOrClear(snapshot.Operadora)
      params.operadoraId = dropdownOrClear(snapshot.OperadoraID)
      // business_id del registro: imprescindible para que el backend scopee el
      // UPDATE a UNA sola fila cuando el superadmin está en "Todos los negocios"
      // (los equipo_id colisionan entre CSL y Depicenter).
      if (snapshot.business_id) params.businessId = snapshot.business_id
    } else {
      params = {
        action: "saveEquipo",
        equipoId: snapshot.EquipoID,
        sucursal: snapshot.Sucursal,
        empresa: snapshot.Empresa || business.name,
        domicilio: snapshot.Domicilio || "",
        modelo: snapshot.Modelo,
        serie: snapshot.Serie || "",
        numero: snapshot.Numero || "",
        pcabeza: String(snapshot.P_Cabeza || 0),
        ptotales: String(snapshot.P_Totales || 0),
        maxCabeza: String(snapshot.Max_Cabeza || 6000000),
        estado: snapshot.Estado,
        observaciones: snapshot.Observaciones || "",
        cabina: snapshot.Cabina || "",
        operadora: snapshot.Operadora || "",
        operadoraId: snapshot.OperadoraID || "",
      }
      // Si el superadmin tiene un negocio seleccionado en el filtro, el equipo
      // nuevo se crea en ESE negocio (no en el del perfil). Para usuarios no
      // superadmin el backend lo fuerza a su propio tenant igual.
      if (adminFilterBizId) params.businessId = adminFilterBizId
    }

    // Guardado REAL: esperamos la respuesta y actualizamos el store con el
    // registro que devuelve el backend (verdad de la DB), no con optimista.
    // Si falla, mostramos el error y NO cerramos el modal (no se pierde el trabajo).
    try {
      const res = await apiJsonp(normalized, params) as { ok?: boolean; record?: Equipo; error?: string }
      // El backend SIEMPRE responde { ok }. Si no guardó (ej. error de tenant,
      // RLS, columna), NO fingimos éxito: lanzamos el error real para mostrarlo
      // y dejar el modal abierto (no se pierde el trabajo).
      if (!res?.ok) {
        throw new Error(res?.error || "No se pudo guardar el equipo")
      }
      // Verdad de la DB: usamos el registro que devuelve el backend (no optimista).
      const saved = (res.record as Equipo) || snapshot
      setDb({
        ...db,
        equipos: exists
          ? db.equipos.map(e => e.EquipoID === snapshot.EquipoID ? { ...e, ...saved } : e)
          : [...db.equipos, saved],
      })
      // Invalidar el dedup-cache de lecturas: garantiza que el próximo
      // getAllData traiga la verdad de la DB (no un snapshot viejo de <30s que
      // haría "revertir" el cambio recién guardado).
      invalidateReadCache("getAllData")
      setFormData(emptyEquipo); setEditingEquipo(null); setIsFormOpen(false)
      showToast(exists ? "Equipo actualizado correctamente" : "Equipo creado correctamente", "success")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo guardar el equipo", "error")
    }
  }

  // ── Importación masiva de base maestra de equipos ────────────────────────
  const handleImportFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setParsingFile(true)
    try {
      const XLSX = await loadXLSX() as { read: (data: ArrayBuffer | string, opts: { type: string }) => unknown; utils: { sheet_to_json: (ws: unknown, opts: { header: 1; defval: string }) => unknown[][] } }
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: "array" }) as { SheetNames: string[]; Sheets: Record<string, unknown> }
      // Validar tipo: solo aceptamos "base_equipos".
      const detection = detectExcelType(wb, XLSX)
      if (detection.type !== "base_equipos") {
        const label = detection.type === "agendapro" ? "reporte AgendaPro"
          : detection.type === "lecturas" ? "reporte de lecturas/pulsos"
          : "desconocido"
        showToast(`${file.name}: el archivo es de tipo "${label}", no una base maestra. Usa el archivo correcto.`, "error")
        return
      }
      const parsed = parseEquiposBaseWorkbook(wb, XLSX)
      setImportPreview({ filename: file.name, parsed })
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setParsingFile(false)
      if (importInputRef.current) importInputRef.current.value = ""
    }
  }

  const confirmImport = async () => {
    if (!importPreview) return
    const validRows = importPreview.parsed.rows.filter((r) => r.status !== "error" && r.equipo)
    if (!validRows.length) {
      showToast("No hay filas válidas para importar.", "error")
      return
    }
    setImporting(true)
    let upserted = 0
    let failed = 0
    try {
      // Construimos un mapa nombre → operadora_id desde dbPulsos para
      // resolver el OperadoraID cuando el archivo solo trae el nombre.
      const opByNombre = new Map<string, string>()
      for (const op of dbPulsos.operadoras) {
        if (op.Nombre && op.OperadoraID) opByNombre.set(op.Nombre.toLowerCase(), op.OperadoraID)
      }
      const newEquipos: Equipo[] = []
      for (const row of validRows) {
        const existing = db.equipos.find((e) => e.EquipoID === row.equipo)
        const opId = row.operadora ? (opByNombre.get(row.operadora.toLowerCase()) || "") : ""
        if (existing) {
          // Equipo YA EXISTE — UPDATE PARCIAL con solo los campos del
          // archivo. NO tocamos modelo / pulsos / observaciones / max_cabeza
          // / empresa porque el archivo de base maestra no los trae.
          const updateParams: Record<string, string> = {
            action: "updateEquipoCampos",
            equipoId: row.equipo,
          }
          if (row.sucursal) updateParams.sucursal = row.sucursal
          if (row.serial) updateParams.serie = row.serial
          if (row.cabina) updateParams.cabina = row.cabina
          if (row.operadora) updateParams.operadora = row.operadora
          if (opId) updateParams.operadoraId = opId
          try {
            await apiJsonp(normalizeApiUrl(apiUrl), updateParams)
            const merged: Equipo = {
              ...existing,
              Sucursal: row.sucursal || existing.Sucursal,
              Serie: row.serial || existing.Serie,
              Cabina: row.cabina || existing.Cabina,
              Operadora: row.operadora || existing.Operadora,
              OperadoraID: opId || existing.OperadoraID,
            }
            newEquipos.push(merged)
            upserted += 1
          } catch (err) {
            console.warn("updateEquipoCampos failed", row.equipo, err)
            failed += 1
          }
        } else {
          // Equipo NUEVO — INSERT full. Los campos no presentes en el
          // archivo quedan con defaults seguros (modelo vacío, pulsos 0).
          const nuevo: Equipo = {
            ...emptyEquipo,
            EquipoID: row.equipo,
            Sucursal: row.sucursal,
            Serie: row.serial,
            Cabina: row.cabina,
            Operadora: row.operadora,
            OperadoraID: opId,
            Estado: "Activo",
          }
          try {
            await apiJsonp(normalizeApiUrl(apiUrl), {
              action: "saveEquipo",
              equipoId: nuevo.EquipoID,
              sucursal: nuevo.Sucursal,
              empresa: nuevo.Empresa || business.name,
              domicilio: nuevo.Domicilio || "",
              modelo: nuevo.Modelo || "",
              serie: nuevo.Serie || "",
              numero: nuevo.Numero || "",
              pcabeza: String(nuevo.P_Cabeza || 0),
              ptotales: String(nuevo.P_Totales || 0),
              maxCabeza: String(nuevo.Max_Cabeza || 6000000),
              estado: nuevo.Estado,
              observaciones: nuevo.Observaciones || "",
              cabina: nuevo.Cabina || "",
              operadora: nuevo.Operadora || "",
              operadoraId: nuevo.OperadoraID || "",
            })
            newEquipos.push(nuevo)
            upserted += 1
          } catch (err) {
            console.warn("saveEquipo (nuevo) failed", row.equipo, err)
            failed += 1
          }
        }
      }
      // Actualizar store local: reemplazar o agregar.
      const newIds = new Set(newEquipos.map((e) => e.EquipoID))
      const otrosEquipos = db.equipos.filter((e) => !newIds.has(e.EquipoID))
      setDb({ ...db, equipos: [...otrosEquipos, ...newEquipos].sort((a, b) => (Number(a.EquipoID) || 0) - (Number(b.EquipoID) || 0)) })
      showToast(
        failed > 0
          ? `${upserted} equipos importados · ${failed} fallaron`
          : `${upserted} equipos importados correctamente`,
        failed > 0 ? "info" : "success",
      )
      setImportPreview(null)
      setImportOpen(false)
    } finally {
      setImporting(false)
    }
  }

  const handleToggleStatus = async (equipo: Equipo) => {
    const newStatus = equipo.Estado === "Activo" ? "Inactivo" : "Activo"
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) { showToast("API no configurada", "error"); return }
    // Optimista: refleja el cambio de inmediato.
    setDb({ ...db, equipos: db.equipos.map(e => e.EquipoID === equipo.EquipoID ? { ...e, Estado: newStatus as "Activo" | "Inactivo" } : e) })
    try {
      const params: Record<string, string> = { action: "setEquipoEstado", equipoId: equipo.EquipoID, estado: newStatus }
      if (equipo.business_id) params.businessId = equipo.business_id
      const res = await apiJsonp(normalized, params) as { ok?: boolean; error?: string }
      if (!res?.ok) throw new Error(res?.error || "No se pudo cambiar el estado")
      invalidateReadCache("getAllData")
      showToast(`Equipo ${newStatus === "Activo" ? "activado" : "desactivado"}`, "success")
    } catch (e) {
      // El server lo rechazó (0 filas / cross-tenant / RLS): revertir el optimista.
      setDb({ ...db, equipos: db.equipos.map(x => x.EquipoID === equipo.EquipoID ? { ...x, Estado: equipo.Estado } : x) })
      showToast(e instanceof Error ? e.message : "No se pudo cambiar el estado", "error")
    }
  }

  const handleDelete = async () => {
    if (!deleteDialog) return
    const target = deleteDialog
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) { showToast("API no configurada", "error"); return }
    setDeleteDialog(null)
    try {
      const params: Record<string, string> = { action: "deleteEquipo", equipoId: target.EquipoID }
      if (target.business_id) params.businessId = target.business_id
      const res = await apiJsonp(normalized, params) as { ok?: boolean; error?: string }
      if (!res?.ok) throw new Error(res?.error || "No se pudo eliminar el equipo")
      // Solo se quita del listado tras confirmar en la DB (no antes).
      setDb({ ...db, equipos: db.equipos.filter(e => e.EquipoID !== target.EquipoID) })
      invalidateReadCache("getAllData")
      showToast("Equipo eliminado", "success")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo eliminar el equipo", "error")
    }
  }

  const pct = (eq: Equipo) => {
    const max = Number(eq.Max_Cabeza) || 6000000
    const used = Number(eq.P_Cabeza) || 0
    return Math.min(Math.round((used / max) * 100), 100)
  }

  return (
    <div className="space-y-4">
      <SuperadminBusinessFilter value={adminFilter} onChange={setAdminFilter} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Nuevo Equipo</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" /> Importar base masiva
            </Button>
            <Button size="sm" onClick={() => { setFormData(emptyEquipo); setEditingEquipo(null); setIsFormOpen(true) }}>
              <Plus className="h-4 w-4 mr-2" /> Agregar
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Lista de equipos</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {/* Secuencial visual: refleja el orden actual de la tabla. No es el ID real del equipo. */}
                <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("EquipoID")}>No. Equipo{sortIcon("EquipoID")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("Sucursal")}>Sucursal{sortIcon("Sucursal")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("Cabina")}>Cabina{sortIcon("Cabina")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("Operadora")}>Operadora{sortIcon("Operadora")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("Modelo")}>Modelo{sortIcon("Modelo")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("Serie")}>Serie{sortIcon("Serie")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("P_Cabeza")}>Pulsos cabeza{sortIcon("P_Cabeza")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("P_Totales")}>Pulsos totales{sortIcon("P_Totales")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("Estado")}>Estado{sortIcon("Estado")}</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {db.equipos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                    No hay equipos registrados
                  </TableCell>
                </TableRow>
              ) : (
                sortedEquipos.map((eq, i) => {
                  // Cabina legacy: si no hay valor estructurado, intentamos
                  // detectarlo en Observaciones para mostrar algo razonable
                  // mientras el usuario migra cada row al editar.
                  const cabinaShow = eq.Cabina || detectarCabinaLegacy(eq.Observaciones) || "—"
                  const operadoraShow = eq.Operadora || "—"
                  return (
                  <TableRow
                    key={eq.EquipoID || i}
                    className="cursor-pointer"
                    onClick={() => setViewEquipo(eq)}
                  >
                    <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                    <TableCell className="font-medium">{eq.EquipoID}</TableCell>
                    <TableCell>{eq.Sucursal}</TableCell>
                    <TableCell className="text-xs">{cabinaShow}</TableCell>
                    <TableCell className="text-xs">{operadoraShow}</TableCell>
                    <TableCell>{eq.Modelo}</TableCell>
                    <TableCell className="text-muted-foreground">{eq.Serie || "-"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Progress value={pct(eq)} className="h-1.5 w-12 flex-shrink-0" />
                        <span className="text-[10px] font-bold text-muted-foreground tabular-nums">{pct(eq)}%</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {fmtN(eq.P_Cabeza)}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {fmtN(eq.P_Totales)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={eq.Estado === "Activo" ? "default" : "secondary"}
                        className={eq.Estado === "Activo" ? "bg-green-500/20 text-green-700 border-green-500/30" : ""}>
                        {eq.Estado || "Activo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-0.5 justify-end">
                        <RecordActions
                          title={`Equipo: ${eq.EquipoID}`}
                          record={eq as unknown as Record<string, unknown>}
                          onEdit={() => { setFormData(eq); setEditingEquipo(eq); setIsFormOpen(true) }}
                          onDelete={() => setDeleteDialog(eq)}
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleToggleStatus(eq)}>
                          {eq.Estado === "Activo"
                            ? <PowerOff className="h-3.5 w-3.5 text-orange-500" />
                            : <Power className="h-3.5 w-3.5 text-green-500" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RecordViewDialog
        record={viewEquipo as unknown as Record<string, unknown> | null}
        title={viewEquipo ? `Equipo ${viewEquipo.EquipoID} · ${viewEquipo.Modelo || ""}` : ""}
        onClose={() => setViewEquipo(null)}
        extraSlot={
          viewEquipo ? (
            <div className="mt-4 border-t pt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Reportes relacionados
                </p>
                <Badge variant="secondary" className="text-[10px]">
                  {reportesEquipo.length}
                </Badge>
              </div>
              {reportesEquipo.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Sin reportes registrados para este equipo.
                </p>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {reportesEquipo.slice(0, 20).map((r) => (
                    <div
                      key={r.ID}
                      className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {String(r.Fecha || "").slice(0, 10)}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">
                            {r.Tipo || "-"}
                          </Badge>
                          {r.Atendio ? (
                            <span className="text-[10px] text-muted-foreground">{r.Atendio}</span>
                          ) : null}
                        </div>
                        {r.Problema ? (
                          <p className="mt-1 text-[11px] text-foreground break-words">{r.Problema}</p>
                        ) : null}
                      </div>
                      {r.EstadoEquipo ? (
                        <Badge variant="outline" className="flex-shrink-0 text-[10px]">
                          {r.EstadoEquipo}
                        </Badge>
                      ) : null}
                    </div>
                  ))}
                  {reportesEquipo.length > 20 ? (
                    <p className="pt-1 text-center text-[10px] text-muted-foreground">
                      +{reportesEquipo.length - 20} más
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          ) : null
        }
      />

      {/* Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={(o) => { if (!o) { setIsFormOpen(false); setEditingEquipo(null) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingEquipo ? `Editar: ${editingEquipo.EquipoID}` : "Nuevo Equipo"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>ID Equipo / Serie *</Label>
              <Input value={formData.EquipoID} onChange={e => setFormData({ ...formData, EquipoID: e.target.value })}
                placeholder="Ej: 133" disabled={!!editingEquipo} />
            </div>
            <div className="space-y-1.5">
              <Label>Sucursal</Label>
              <Select value={formData.Sucursal} onValueChange={v => setFormData({ ...formData, Sucursal: v })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  {activeSucursales.length > 0
                    ? activeSucursales.map(s => <SelectItem key={s.Codigo} value={s.Nombre}>{s.Nombre}</SelectItem>)
                    : <>
                        <SelectItem value="Rafael Vidal">Rafael Vidal</SelectItem>
                        <SelectItem value="Los Jardines">Los Jardines</SelectItem>
                        <SelectItem value="Villa Olga">Villa Olga</SelectItem>
                        <SelectItem value="La Vega">La Vega</SelectItem>
                      </>
                  }
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cabina</Label>
              <Select value={formData.Cabina || ""} onValueChange={v => setFormData({ ...formData, Cabina: v })}>
                <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>
                  {CABINA_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Operadora</Label>
              <Select
                value={formData.Operadora ? formData.Operadora.toUpperCase() : "__none__"}
                onValueChange={(name) => {
                  if (name === "__none__") { setFormData({ ...formData, Operadora: "", OperadoraID: "" }); return }
                  // Resolver OperadoraID si la operadora existe en el catálogo real.
                  const op = operadorasActivas.find((o) => (o.Nombre || "").trim().toUpperCase() === name)
                  setFormData({ ...formData, Operadora: name, OperadoraID: op?.OperadoraID || "" })
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin asignar</SelectItem>
                  {operadoraOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Modelo</Label>
              <Input value={formData.Modelo} onChange={e => setFormData({ ...formData, Modelo: e.target.value })}
                placeholder="Ej: CANDELA GENTLEYAG" />
            </div>
            <div className="space-y-1.5">
              <Label>Serie</Label>
              <Input value={formData.Serie} onChange={e => setFormData({ ...formData, Serie: e.target.value })} placeholder="Serie" />
            </div>
            <div className="space-y-1.5">
              <Label>Número</Label>
              <Input value={formData.Numero} onChange={e => setFormData({ ...formData, Numero: e.target.value })} placeholder="Número" />
            </div>
            <div className="space-y-1.5">
              <Label>Pulsos cabeza</Label>
              <Input
                value={formData.P_Cabeza ? fmtN(formData.P_Cabeza) : ""}
                onChange={e => {
                  setFormData({ ...formData, P_Cabeza: parseN(e.target.value) })
                }}
                placeholder="Ej: 1,500,000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Pulsos totales</Label>
              <Input
                value={formData.P_Totales ? fmtN(formData.P_Totales) : ""}
                onChange={e => {
                  setFormData({ ...formData, P_Totales: parseN(e.target.value) })
                }}
                placeholder="Ej: 7,198,234"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Máx. cabeza</Label>
              <Input
                value={formData.Max_Cabeza ? fmtN(formData.Max_Cabeza) : ""}
                onChange={e => setFormData({ ...formData, Max_Cabeza: parseN(e.target.value) })}
                placeholder="Ej: 10,000,000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select value={formData.Estado} onValueChange={v => setFormData({ ...formData, Estado: v as "Activo" | "Inactivo" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Activo">Activo</SelectItem>
                  <SelectItem value="Inactivo">Inactivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Empresa</Label>
              <Input value={formData.Empresa} onChange={e => setFormData({ ...formData, Empresa: e.target.value })} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Observaciones</Label>
              <Input value={formData.Observaciones} onChange={e => setFormData({ ...formData, Observaciones: e.target.value })}
                placeholder="Notas opcionales" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsFormOpen(false); setEditingEquipo(null) }}>
              <X className="h-4 w-4 mr-2" /> Cancelar
            </Button>
            <Button onClick={handleSubmit}>
              <Save className="h-4 w-4 mr-2" /> Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>¿Eliminar equipo?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se eliminará el equipo <strong>{deleteDialog?.EquipoID}</strong> — {deleteDialog?.Modelo}. Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-2" /> Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Importación masiva — base maestra de equipos */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!o) { setImportOpen(false); setImportPreview(null) } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Importar base maestra de equipos</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {!importPreview ? (
              <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-6 text-center">
                <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-primary" />
                <p className="text-sm font-semibold">Sube el Excel con la base de equipos</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hoja con columnas <b>Sucursal · Cabina · Operadora · Equipo · Serial</b>. Cada fila se aplica como upsert sobre el equipo existente — los campos no presentes en el archivo conservan su valor actual (modelo, pulsos, observaciones, etc).
                </p>
                <input
                  ref={importInputRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={(e) => handleImportFile(e.target.files)}
                />
                <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => importInputRef.current?.click()} disabled={parsingFile}>
                  {parsingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {parsingFile ? "Leyendo..." : "Seleccionar Excel"}
                </Button>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{importPreview.filename}</div>
                    <div className="mt-0.5 text-muted-foreground">
                      Hoja: <b>{importPreview.parsed.sheet}</b> · Header fila: {importPreview.parsed.headerRow}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setImportPreview(null); importInputRef.current?.click() }} className="h-7 gap-1 text-[11px]">
                    <Upload className="h-3 w-3" /> Cambiar archivo
                  </Button>
                </div>
                {(() => {
                  const rows = importPreview.parsed.rows
                  const validas = rows.filter((r) => r.status === "valid").length
                  const advertencias = rows.filter((r) => r.status === "warning").length
                  const errores = rows.filter((r) => r.status === "error").length
                  return (
                    <div className="flex flex-wrap gap-2">
                      <Mini label="Filas leídas" value={rows.length} />
                      <Mini label="Válidas" value={validas} tone="ok" />
                      {advertencias > 0 ? <Mini label="Advertencias" value={advertencias} tone="warn" /> : null}
                      {errores > 0 ? <Mini label="Errores" value={errores} tone="error" /> : null}
                    </div>
                  )
                })()}
                <div className="max-h-80 overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Estado</TableHead>
                        <TableHead>Sucursal</TableHead>
                        <TableHead>Cabina</TableHead>
                        <TableHead>Operadora</TableHead>
                        <TableHead>Equipo</TableHead>
                        <TableHead>Serial</TableHead>
                        <TableHead>Obs.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreview.parsed.rows.map((r) => (
                        <TableRow key={r.filaOrigen}>
                          <TableCell>
                            {r.status === "error" ? <AlertTriangle className="h-3.5 w-3.5 text-rose-600" /> :
                             r.status === "warning" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> :
                             <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                          </TableCell>
                          <TableCell className="text-xs">{r.sucursal || "—"}</TableCell>
                          <TableCell className="text-xs">{r.cabina || "—"}</TableCell>
                          <TableCell className="text-xs">{r.operadora || "—"}</TableCell>
                          <TableCell className="text-xs font-bold">{r.equipo || "—"}</TableCell>
                          <TableCell className="text-[10px] text-muted-foreground">{r.serial || "—"}</TableCell>
                          <TableCell className="text-[10px] text-muted-foreground">{r.message || ""}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setImportPreview(null) }}>Cancelar</Button>
            {importPreview ? (
              <Button onClick={confirmImport} disabled={importing}>
                {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                {importing ? "Importando..." : `Importar ${importPreview.parsed.rows.filter((r) => r.status !== "error" && r.equipo).length} equipos`}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "error" | "info" }) {
  const cls = tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-700"
    : tone === "error" ? "border-rose-200 bg-rose-50 text-rose-700"
    : tone === "info" ? "border-sky-200 bg-sky-50 text-sky-700"
    : "border-slate-200 bg-white text-slate-700"
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {label}: <span className="font-mono">{fmtN(value)}</span>
    </span>
  )
}
