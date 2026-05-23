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
import type { ClienteCosmiatria } from "@/lib/types"

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
  motivoConsulta: "",
  servicio: "",
}

function clienteNombre(cliente: ClienteCosmiatria) {
  return `${cliente.Nombre || ""} ${cliente.Apellido || ""}`.trim()
}

function clienteDireccion(cliente: ClienteCosmiatria) {
  return [cliente.Direccion, cliente.Localidad, cliente.Ciudad, cliente.Region]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ")
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
  const [clientSearch, setClientSearch] = useState("")
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // ─── Estado del prefill (después de seleccionar o captura manual) ────────
  const [prefill, setPrefill] = useState<PrefillState>(emptyPrefill)
  const [manualMode, setManualMode] = useState(false) // true = se acepta editar sin cliente seleccionado

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

  // Reset + carga al abrir.
  useEffect(() => {
    if (open) {
      setPrefill(emptyPrefill)
      setClientSearch("")
      setDropdownOpen(false)
      setManualMode(false)
      setError("")
      setResult(null)
      setCopied(false)
      setGenerating(false)
      if (clientes.length === 0) {
        void loadClientes()
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
      if (formType === "ficha_dermatologica") include("motivoConsulta")
      else include("servicio")

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Busca el cliente en el sistema; sus datos se cargan automáticamente.
            El enlace es válido por <b>12 horas</b> y de <b>un solo uso</b>.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3 py-2">
            {/* 1) Picker de cliente — visible si no hay selección ni captura manual */}
            {!hasSelectedOrManual ? (
              <div ref={pickerRef} className="relative space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3">
                <Label className="text-xs font-bold">Buscar cliente registrado</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={clientSearch}
                    onChange={(e) => { setClientSearch(e.target.value); setDropdownOpen(true) }}
                    onFocus={() => setDropdownOpen(true)}
                    placeholder="Buscar por nombre, teléfono, cédula o correo..."
                    className="pl-8"
                    autoFocus
                  />
                </div>
                {dropdownOpen && clientSearch.trim() ? (
                  <div className="absolute left-3 right-3 top-[88px] z-30 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 shadow-xl">
                    {loadingClientes ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Cargando clientes...
                      </div>
                    ) : matchedClientes.length === 0 ? (
                      <div className="space-y-1 p-2">
                        <div className="rounded-lg px-2 py-1.5 text-xs text-muted-foreground">
                          No se encontró ningún cliente con ese dato.
                        </div>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={enterManualMode}
                          className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-primary/5"
                        >
                          <UserPlus className="h-4 w-4" />
                          Captura manual sin vincular
                        </button>
                      </div>
                    ) : (
                      <>
                        {matchedClientes.map((c) => (
                          <button
                            key={c.ClienteID}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => selectCliente(c)}
                            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                          >
                            <span className="font-semibold">{clienteNombre(c)}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{c.Telefono || "Sin teléfono"}</span>
                            <span className="block text-xs text-muted-foreground">
                              {c.Sucursal || "Sin sucursal"} · {c.DocumentoIdentidad || c.Email || "Sin documento"}
                            </span>
                          </button>
                        ))}
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={enterManualMode}
                          className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs font-semibold text-primary/80 hover:bg-primary/5"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          ¿No está? Captura manual sin vincular
                        </button>
                      </>
                    )}
                  </div>
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

                {/* Editables (recepción puede corregir antes de enviar) */}
                <div className="grid gap-3 sm:grid-cols-2">
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
                  <div>
                    <Label className="text-xs">Correo</Label>
                    <Input type="email" value={prefill.correo} onChange={(e) => update({ correo: e.target.value })} className="mt-1" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Dirección</Label>
                    <Input value={prefill.direccion} onChange={(e) => update({ direccion: e.target.value })} className="mt-1" />
                  </div>
                  <div className={isFicha ? "" : "sm:col-span-2"}>
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
                  {isFicha ? (
                    <div>
                      <Label className="text-xs">Motivo de consulta</Label>
                      <Input
                        value={prefill.motivoConsulta}
                        onChange={(e) => update({ motivoConsulta: e.target.value })}
                        placeholder="Ej. Manchas, acné..."
                        className="mt-1"
                      />
                    </div>
                  ) : (
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Servicio / Procedimiento</Label>
                      <Input
                        value={prefill.servicio}
                        onChange={(e) => update({ servicio: e.target.value })}
                        placeholder="Tipo de masaje, eliminación de tatuaje, etc."
                        className="mt-1"
                      />
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
              <Button onClick={generate} disabled={generating || !prefill.nombre.trim()} className="gap-2">
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
