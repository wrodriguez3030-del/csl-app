"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, Copy, Loader2, MessageCircle, RefreshCcw, Search, Send, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiJsonp, normalizeApiUrl, useAppStore } from "@/lib/store"
import { supabaseBrowser } from "@/lib/supabase-client"
import { normalizeAddress } from "@/lib/address"
import type { ClienteCosmiatria } from "@/lib/types"
import { MASSAGE_SPECIALISTS } from "@/components/consentimientos-page"

// 10 motivos canónicos para Ficha Dermatológica. Espejo de
// MOTIVOS_CONSULTA_PREDEFINIDOS en ficha-dermatologia-form.tsx — mantener
// en sync si se agregan/cambian (lista corta, drift improbable).
const MOTIVOS_CONSULTA = [
  "Acné",
  "Manchas",
  "Melasma",
  "Hidratación facial",
  "Rejuvenecimiento",
  "Control de grasa",
  "Poros dilatados",
  "Sensibilidad / irritación",
  "Limpieza profunda",
  "Evaluación general de la piel",
] as const

const MOTIVO_OTRO = "__otro__"

// Servicios/procedimientos por tipo de consent — espejo de lo que el
// equipo clínico usa internamente. La opción "Otro" abre un input libre.
const SERVICIOS_MASAJES = [
  "Masaje relajante",
  "Masaje terapéutico",
  "Masaje descontracturante",
  "Masaje reductivo",
  "Masaje postquirúrgico",
  "Drenaje linfático",
  "Maderoterapia",
  "Masaje deportivo",
  "Masaje de espalda",
] as const

const SERVICIOS_TATUAJES = [
  "Eliminación de tatuaje",
  "Eliminación de cejas",
  "Remoción parcial",
  "Remoción completa",
  "Retoque / seguimiento",
  "Evaluación previa",
] as const

const SERVICIO_OTRO = "__servicio_otro__"

type FormType =
  | "ficha_dermatologica"
  | "consentimiento_masajes"
  | "consentimiento_tatuajes_cejas"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  formType: FormType
  title: string
}

interface GeneratedLink {
  url: string
  whatsappUrl: string
  expiraEn: string
}

interface PrefillState {
  clienteId: string
  nombre: string
  telefono: string
  documento: string
  correo: string
  direccion: string
  sucursal: string
  especialista: string
  motivoConsulta: string
  servicio: string
}

const emptyPrefill: PrefillState = {
  clienteId: "",
  nombre: "",
  telefono: "",
  documento: "",
  correo: "",
  direccion: "",
  sucursal: "",
  especialista: "",
  motivoConsulta: "",
  servicio: "",
}

function clienteNombre(cliente: ClienteCosmiatria) {
  return `${cliente.Nombre || ""} ${cliente.Apellido || ""}`.trim()
}

function clienteDireccion(cliente: ClienteCosmiatria) {
  // Concatenamos las 4 partes y luego normalizeAddress remueve duplicados +
  // corrige typos conocidos. Ej: dirección/localidad/ciudad que vienen como
  // "santiago, santiago, santaigo, santiago" → "Santiago".
  const raw = [cliente.Direccion, cliente.Localidad, cliente.Ciudad, cliente.Region]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ")
  return normalizeAddress(raw)
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "")
}

function clienteSearchText(cliente: ClienteCosmiatria) {
  return [
    clienteNombre(cliente),
    cliente.Telefono,
    cliente.Telefono2,
    cliente.DocumentoIdentidad,
    cliente.Email,
    cliente.Sucursal,
  ]
    .join(" ")
    .toLowerCase()
}

function normalizeCliente(raw: Record<string, unknown>): ClienteCosmiatria {
  return {
    ClienteID: String(raw.ClienteID ?? raw.cliente_id ?? raw.id ?? ""),
    NumeroCliente: String(raw.NumeroCliente ?? raw.numero_cliente ?? ""),
    DocumentoIdentidad: String(raw.DocumentoIdentidad ?? raw.documento_identidad ?? ""),
    Email: String(raw.Email ?? raw.email ?? ""),
    Nombre: String(raw.Nombre ?? raw.nombre ?? ""),
    Apellido: String(raw.Apellido ?? raw.apellido ?? ""),
    Telefono: String(raw.Telefono ?? raw.telefono ?? ""),
    Telefono2: String(raw.Telefono2 ?? raw.telefono2 ?? ""),
    Direccion: String(raw.Direccion ?? raw.direccion ?? ""),
    Localidad: String(raw.Localidad ?? raw.localidad ?? ""),
    Ciudad: String(raw.Ciudad ?? raw.ciudad ?? ""),
    Region: String(raw.Region ?? raw.region ?? ""),
    FechaNacimiento: String(raw.FechaNacimiento ?? raw.fecha_nacimiento ?? ""),
    Edad: Number(raw.Edad ?? raw.edad ?? 0),
    Genero: String(raw.Genero ?? raw.genero ?? ""),
    Sucursal: String(raw.Sucursal ?? raw.sucursal ?? ""),
    PuedeAgendar: Boolean(raw.PuedeAgendar ?? raw.puede_agendar ?? true),
    ClienteDesde: String(raw.ClienteDesde ?? raw.cliente_desde ?? ""),
    Estado: (String(raw.Estado ?? raw.estado ?? "Activo") === "Inactivo" ? "Inactivo" : "Activo") as ClienteCosmiatria["Estado"],
    Notas: String(raw.Notas ?? raw.notas ?? ""),
  }
}

export function LinkGeneratorDialog({ open, onOpenChange, formType, title }: Props) {
  const apiUrl = useAppStore((state) => state.apiUrl)
  const sucursalesDb = useAppStore((state) => state.db.sucursales)
  const sucursalesOptions = useMemo(
    () => (sucursalesDb || []).map((s) => s.Nombre).filter(Boolean),
    [sucursalesDb],
  )

  // ─── Búsqueda de cliente (fuente real: csl_cosmiatria_clientes) ──────────
  const [clientes, setClientes] = useState<ClienteCosmiatria[]>([])
  const [loadingClientes, setLoadingClientes] = useState(false)
  // ─── Especialistas/Operadoras (fuente real: csl_operadoras vía getAllPulsosData) ─
  const [especialistas, setEspecialistas] = useState<string[]>([])
  const [clientSearch, setClientSearch] = useState("")
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // ─── Estado del prefill (después de seleccionar o captura manual) ────────
  const [prefill, setPrefill] = useState<PrefillState>(emptyPrefill)
  const [manualMode, setManualMode] = useState(false) // true = se acepta editar sin cliente seleccionado

  // Motivo de consulta (solo ficha_dermatologica): dropdown con 10 motivos
  // canónicos + opción "Otro motivo" que muestra input libre.
  // motivoSelected = "" | uno de MOTIVOS_CONSULTA | MOTIVO_OTRO
  const [motivoSelected, setMotivoSelected] = useState<string>("")
  const [motivoOtroText, setMotivoOtroText] = useState("")
  // Servicio / procedimiento (solo consents): dropdown según el kind +
  // "+ Otro" que abre input libre. Required para consents.
  const [servicioSelected, setServicioSelected] = useState<string>("")
  const [servicioOtroText, setServicioOtroText] = useState("")

  // ─── Generación del link ─────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<GeneratedLink | null>(null)
  const [copied, setCopied] = useState(false)

  // Carga inicial de clientes — usa el mismo endpoint autenticado que las
  // pantallas internas de Cosmiatría y Consentimientos. Multi-tenant lo
  // resuelve el backend vía AsyncLocalStorage (CSL no ve Depicenter, etc.).
  const loadClientes = useCallback(async () => {
    setLoadingClientes(true)
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getClientesCosmiatria" })
      const items = Array.isArray(result.records) ? (result.records as Record<string, unknown>[]) : []
      setClientes(items.map(normalizeCliente))
    } catch {
      // Si falla la carga, el modal sigue siendo usable en modo manual.
    } finally {
      setLoadingClientes(false)
    }
  }, [apiUrl])

  // Carga inicial de especialistas — misma fuente que usa Cosmiatría:
  // getAllPulsosData devuelve el array operadoras (activas). Multi-tenant
  // resuelto en el backend.
  const loadEspecialistas = useCallback(async () => {
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getAllPulsosData" })
      const ops = (result as { operadoras?: Record<string, unknown>[] }).operadoras || []
      const names = Array.from(
        new Set(
          ops
            .map((o) => String(o.Nombre || o.nombre || "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, "es"))
      setEspecialistas(names)
    } catch {
      // sin lista: el operador puede dejarlo vacío y rellenar después en interno
    }
  }, [apiUrl])

  // Reset + carga al abrir.
  useEffect(() => {
    if (open) {
      setPrefill(emptyPrefill)
      setClientSearch("")
      setDropdownOpen(false)
      setManualMode(false)
      setMotivoSelected("")
      setMotivoOtroText("")
      setServicioSelected("")
      setServicioOtroText("")
      setError("")
      setResult(null)
      setCopied(false)
      setGenerating(false)
      if (clientes.length === 0) {
        void loadClientes()
      }
      if (especialistas.length === 0) {
        void loadEspecialistas()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Click fuera → cerrar dropdown.
  useEffect(() => {
    if (!dropdownOpen) return
    const onDocPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current) return
      if (!pickerRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown)
    return () => document.removeEventListener("pointerdown", onDocPointerDown)
  }, [dropdownOpen])

  const matchedClientes = useMemo(() => {
    const query = clientSearch.trim().toLowerCase()
    if (!query) return []
    return clientes
      .filter((c) => c.Estado !== "Inactivo")
      .filter((c) => {
        const text = clienteSearchText(c)
        return text.includes(query) || onlyDigits(text).includes(onlyDigits(query))
      })
      .slice(0, 10)
  }, [clientes, clientSearch])

  const selectCliente = (cliente: ClienteCosmiatria) => {
    setPrefill((current) => ({
      ...current,
      clienteId: cliente.ClienteID,
      nombre: clienteNombre(cliente),
      telefono: cliente.Telefono || "",
      documento: cliente.DocumentoIdentidad || "",
      correo: cliente.Email || "",
      direccion: clienteDireccion(cliente),
      sucursal: cliente.Sucursal || current.sucursal,
    }))
    setManualMode(false)
    setClientSearch("")
    setDropdownOpen(false)
  }

  const cambiarCliente = () => {
    setPrefill(emptyPrefill)
    setManualMode(false)
    setClientSearch("")
    setDropdownOpen(true)
  }

  const enterManualMode = () => {
    setPrefill({ ...emptyPrefill, nombre: clientSearch.trim() })
    setManualMode(true)
    setDropdownOpen(false)
  }

  const update = (patch: Partial<PrefillState>) => setPrefill((c) => ({ ...c, ...patch }))

  const hasSelectedOrManual = Boolean(prefill.clienteId) || manualMode

  const generate = async () => {
    setError("")
    if (!prefill.nombre.trim()) {
      setError("Selecciona o ingresa el nombre del cliente antes de generar el link.")
      return
    }

    // Especialista: requerido para ficha_dermatologica + masajes (recepción
    // debe dejar definido quién atiende antes de enviar al cliente).
    if (especialistaRequerido && !prefill.especialista.trim()) {
      setError(
        isMasajes
          ? "Selecciona la especialista en masajes antes de generar el link."
          : "Selecciona el especialista antes de generar el link.",
      )
      return
    }
    // Resolver servicio final (solo consents): seleccionado de la lista o
    // texto manual si eligió "+ Otro". Required.
    let servicioFinal = ""
    if (formType !== "ficha_dermatologica") {
      if (servicioSelected === SERVICIO_OTRO) {
        servicioFinal = servicioOtroText.trim()
        if (!servicioFinal) {
          setError("Escribe el servicio o procedimiento o elige uno de la lista.")
          return
        }
      } else if (servicioSelected) {
        servicioFinal = servicioSelected
      }
      if (!servicioFinal) {
        setError("Selecciona el servicio o procedimiento.")
        return
      }
    }

    // Resolver motivoConsulta final (solo ficha): seleccionado de la lista
    // o el texto manual si eligió "Otro motivo".
    let motivoConsultaFinal = ""
    if (formType === "ficha_dermatologica") {
      if (motivoSelected === MOTIVO_OTRO) {
        motivoConsultaFinal = motivoOtroText.trim()
        if (!motivoConsultaFinal) {
          setError("Escribe el motivo de consulta o elige uno de la lista.")
          return
        }
      } else if (motivoSelected) {
        motivoConsultaFinal = motivoSelected
      }
      if (!motivoConsultaFinal) {
        setError("Selecciona un motivo de consulta de la lista.")
        return
      }
    }

    setGenerating(true)
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession()
      if (!session?.access_token) throw new Error("Sesión no válida — vuelve a iniciar sesión")

      // Construir prefillPayload con solo los campos relevantes para el tipo.
      const prefillPayload: Record<string, string> = {}
      const include = (key: keyof PrefillState) => {
        const v = String(prefill[key] || "").trim()
        if (v) prefillPayload[key] = v
      }
      if (prefill.clienteId) include("clienteId")
      include("nombre")
      include("telefono")
      include("documento")
      include("correo")
      include("direccion")
      include("sucursal")
      include("especialista")
      if (formType === "ficha_dermatologica") {
        // Sobrescribimos motivoConsulta con el valor resuelto (lista u Otro).
        if (motivoConsultaFinal) prefillPayload.motivoConsulta = motivoConsultaFinal
      } else {
        // Servicio resuelto (lista u Otro) — viaja como prefill.servicio
        // que el form público mapea a observaciones del procedimiento.
        if (servicioFinal) prefillPayload.servicio = servicioFinal
      }

      const response = await fetch("/api/public-form-links", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          formType,
          clienteNombre: prefill.nombre.trim() || undefined,
          clienteTelefono: prefill.telefono.trim() || undefined,
          prefillPayload: Object.keys(prefillPayload).length > 0 ? prefillPayload : undefined,
        }),
      })
      const raw = await response.text()
      let parsed: { ok?: boolean; url?: string; whatsappUrl?: string; expiraEn?: string; error?: string } = {}
      try { parsed = raw ? JSON.parse(raw) : {} } catch { parsed = { error: raw } }
      if (!response.ok || !parsed.ok || !parsed.url || !parsed.whatsappUrl || !parsed.expiraEn) {
        throw new Error(parsed.error || `Error ${response.status}`)
      }
      setResult({ url: parsed.url, whatsappUrl: parsed.whatsappUrl, expiraEn: parsed.expiraEn })
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Error al generar el link")
    } finally {
      setGenerating(false)
    }
  }

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const el = document.getElementById("public-link-input") as HTMLInputElement | null
      if (el) {
        el.select()
        try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ }
      }
    }
  }

  const fmtExpires = (iso: string) => {
    try {
      const date = new Date(iso)
      return date.toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" })
    } catch { return iso }
  }

  const isFicha = formType === "ficha_dermatologica"
  const isMasajes = formType === "consentimiento_masajes"
  // Masajes usa lista canónica cerrada (DAYHANA / Benita) — ignora
  // csl_operadoras que mezcla operadoras de otros servicios. Para los demás
  // tipos seguimos usando la lista del backend.
  const especialistasOptions: string[] = isMasajes ? [...MASSAGE_SPECIALISTS] : especialistas
  // Especialista obligatorio para ficha + masajes; opcional para tatuajes/cejas.
  const especialistaRequerido = isFicha || isMasajes

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[94vw] max-w-[900px] max-h-[90vh] overflow-y-auto p-5 sm:p-6"
        style={{ width: "min(900px, 94vw)" }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription>
            Busca el cliente en el sistema; sus datos se cargan automáticamente.
            El enlace es válido por <b>12 horas</b> y de <b>un solo uso</b>.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4 py-2">
            {/* 1) Picker de cliente — visible si no hay selección ni captura manual.
                Layout STATIC (no dropdown absolute) para que la lista respire
                a lo ancho del modal y no quede cortada por el contenedor. */}
            {!hasSelectedOrManual ? (
              <div ref={pickerRef} className="space-y-3 rounded-2xl border-2 border-primary/25 bg-primary/5 p-4">
                <Label className="text-sm font-bold">Buscar cliente registrado</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={clientSearch}
                    onChange={(e) => { setClientSearch(e.target.value); setDropdownOpen(true) }}
                    onFocus={() => setDropdownOpen(true)}
                    placeholder="Buscar por nombre, teléfono, cédula o correo..."
                    className="h-[52px] pl-11 text-base"
                    autoFocus
                  />
                </div>
                {dropdownOpen && clientSearch.trim() ? (
                  <div className="overflow-hidden rounded-xl border-2 bg-white shadow-md">
                    {loadingClientes ? (
                      <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Cargando clientes...
                      </div>
                    ) : matchedClientes.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        No se encontró ningún cliente con ese dato.
                      </div>
                    ) : (
                      <div className="max-h-[360px] divide-y overflow-y-auto">
                        {matchedClientes.map((c) => {
                          const direccionLine = [c.Sucursal || "Sin sucursal", c.Email].filter(Boolean).join(" · ")
                          return (
                            <button
                              key={c.ClienteID}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => selectCliente(c)}
                              className="flex w-full min-h-[72px] flex-col justify-center gap-1 px-4 py-3 text-left transition-colors hover:bg-primary/5 focus:bg-primary/10 focus:outline-none"
                            >
                              <div className="text-base font-bold leading-tight text-foreground">
                                {clienteNombre(c) || "Cliente sin nombre"}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {c.Telefono || "Sin teléfono"}
                                {c.DocumentoIdentidad ? ` · ${c.DocumentoIdentidad}` : ""}
                              </div>
                              {direccionLine ? (
                                <div className="truncate text-xs text-muted-foreground">{direccionLine}</div>
                              ) : null}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Opción secundaria, discreta, fuera del dropdown principal. */}
                {dropdownOpen && clientSearch.trim() ? (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={enterManualMode}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/40 bg-transparent px-3 py-2 text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    ¿No está? Captura manual sin vincular
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* 2) Tarjeta "Cliente seleccionado" + datos editables */}
            {hasSelectedOrManual ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                      {prefill.clienteId ? "Cliente seleccionado" : "Captura manual"}
                    </p>
                    <p className="mt-0.5 truncate text-base font-bold text-primary">
                      {prefill.nombre || "Sin nombre"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {prefill.telefono || "Sin teléfono"}
                      {prefill.documento ? ` · ${prefill.documento}` : ""}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={cambiarCliente} className="shrink-0 gap-1 text-xs">
                    <RefreshCcw className="h-3 w-3" /> Cambiar cliente
                  </Button>
                </div>

                {/* Editables (recepción puede corregir antes de enviar).
                    3 columnas en desktop para aprovechar el modal ancho. */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label className="text-xs">Nombre</Label>
                    <Input value={prefill.nombre} onChange={(e) => update({ nombre: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Teléfono</Label>
                    <Input value={prefill.telefono} onChange={(e) => update({ telefono: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Cédula / Documento</Label>
                    <Input value={prefill.documento} onChange={(e) => update({ documento: e.target.value })} className="mt-1" />
                  </div>
                  <div className="lg:col-span-2">
                    <Label className="text-xs">Correo</Label>
                    <Input type="email" value={prefill.correo} onChange={(e) => update({ correo: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Sucursal</Label>
                    {sucursalesOptions.length ? (
                      <Select value={prefill.sucursal || "_none"} onValueChange={(value) => update({ sucursal: value === "_none" ? "" : value })}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Opcional" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Sin sucursal</SelectItem>
                          {sucursalesOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input value={prefill.sucursal} onChange={(e) => update({ sucursal: e.target.value })} placeholder="Opcional" className="mt-1" />
                    )}
                  </div>
                  <div className="sm:col-span-2 lg:col-span-2">
                    <Label className="text-xs">Dirección</Label>
                    <Input value={prefill.direccion} onChange={(e) => update({ direccion: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">
                      {isMasajes ? "Especialista en masajes" : "Especialista"}{especialistaRequerido ? " *" : ""}
                    </Label>
                    {especialistasOptions.length ? (
                      <Select value={prefill.especialista || "_none"} onValueChange={(value) => update({ especialista: value === "_none" ? "" : value })}>
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder={especialistaRequerido ? "Seleccionar especialista" : "Opcional"} />
                        </SelectTrigger>
                        <SelectContent>
                          {/* "Sin asignar" solo aparece cuando el campo es opcional
                              (tatuajes/cejas). Ficha y masajes lo requieren. */}
                          {!especialistaRequerido ? <SelectItem value="_none">Sin asignar</SelectItem> : null}
                          {especialistasOptions.map((esp) => <SelectItem key={esp} value={esp}>{esp}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={prefill.especialista}
                        onChange={(e) => update({ especialista: e.target.value })}
                        placeholder={especialistaRequerido ? "Nombre del especialista" : "Opcional"}
                        className="mt-1"
                      />
                    )}
                  </div>
                  {isFicha ? (
                    <div className="sm:col-span-2 lg:col-span-3">
                      <Label className="text-xs">Motivo de consulta *</Label>
                      <Select value={motivoSelected} onValueChange={setMotivoSelected}>
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Selecciona un motivo..." />
                        </SelectTrigger>
                        <SelectContent>
                          {MOTIVOS_CONSULTA.map((m) => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                          <SelectItem value={MOTIVO_OTRO}>+ Otro motivo</SelectItem>
                        </SelectContent>
                      </Select>
                      {motivoSelected === MOTIVO_OTRO ? (
                        <Input
                          value={motivoOtroText}
                          onChange={(e) => setMotivoOtroText(e.target.value)}
                          placeholder="Escribir motivo personalizado..."
                          className="mt-2"
                          autoFocus
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="sm:col-span-2 lg:col-span-3">
                      <Label className="text-xs">Servicio / Procedimiento *</Label>
                      <Select value={servicioSelected} onValueChange={setServicioSelected}>
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Seleccionar servicio" />
                        </SelectTrigger>
                        <SelectContent>
                          {(formType === "consentimiento_masajes" ? SERVICIOS_MASAJES : SERVICIOS_TATUAJES).map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                          <SelectItem value={SERVICIO_OTRO}>+ Otro</SelectItem>
                        </SelectContent>
                      </Select>
                      {servicioSelected === SERVICIO_OTRO ? (
                        <Input
                          value={servicioOtroText}
                          onChange={(e) => setServicioOtroText(e.target.value)}
                          placeholder="Especificar servicio / procedimiento..."
                          className="mt-2"
                          autoFocus
                        />
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs font-semibold text-rose-700">
                ⚠ {error}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              <div className="flex items-center gap-1.5 font-semibold">
                <Check className="h-3.5 w-3.5" /> Link creado para <b>{prefill.nombre}</b>
              </div>
              <div className="mt-1">
                Este enlace vence en 12 horas (<b>{fmtExpires(result.expiraEn)}</b>) y solo puede usarse una vez.
              </div>
            </div>
            <div>
              <Label className="text-xs">Enlace público</Label>
              <div className="mt-1 flex gap-1">
                <Input id="public-link-input" value={result.url} readOnly className="font-mono text-xs" />
                <Button type="button" variant="outline" size="icon" onClick={copy} title="Copiar">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <a
              href={result.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1ebe57]"
            >
              <MessageCircle className="h-4 w-4" />
              Enviar por WhatsApp
            </a>
            <p className="text-[11px] text-muted-foreground">
              El botón abre WhatsApp Web (escritorio) o la app (móvil) — el mensaje empieza con
              "Hola {prefill.nombre.split(/\s+/)[0] || "[nombre]"},…".
            </p>
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>Cancelar</Button>
              <Button
                onClick={generate}
                disabled={
                  generating
                  || !prefill.nombre.trim()
                  || (isFicha && !motivoSelected)
                  || (!isFicha && !servicioSelected)
                  || (especialistaRequerido && !prefill.especialista.trim())
                }
                className="gap-2"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {generating ? "Generando..." : "Generar link"}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">Cerrar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
