"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, FileSignature, Loader2, MessageCircle, RefreshCcw, Send, UserRound } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  antecedentesMedicosOpciones,
  biotipoOpciones,
  calidadSuenoOpciones,
  colorPielOpciones,
  emptyFichaDermo,
  fototipoOpciones,
  grasaOpciones,
  estadoGeneralPielOpciones,
  hidratacionOpciones,
  involucionOpciones,
  lentigoOpciones,
  lipidizacionOpciones,
  pigmentariasOpciones,
  secaOpciones,
  seObservaOpciones,
  sensibilidadOpciones,
  sucursalesCosmiatria,
  tipoPielOpciones,
  texturaAlteracionesOpciones,
  texturaOpciones,
  tratamientosPreviosOpciones,
  type FichaDermoCosmiatrica,
} from "@/lib/dermo-cosmiatria"
import type { ClienteCosmiatria } from "@/lib/types"
import { searchClients } from "@/lib/cliente-search"
import { formatPhone, formatCedula, displayPhone, displayDocumento } from "@/lib/formatters"
import { SignaturePad } from "@/components/signature-pad"
import { SiNoButtons, SiNoConDetalle, EMBARAZO_WARNING_MESSAGE } from "@/components/si-no-buttons"

interface Props {
  initialValue?: FichaDermoCosmiatrica
  operadoras?: string[]
  clientes?: ClienteCosmiatria[]
  submitLabel?: string
  onCancel?: () => void
  onSubmit: (value: FichaDermoCosmiatrica) => Promise<void>
  /**
   * "internal" (default) muestra el form completo para el personal.
   * "public" muestra solo lo que el cliente debe completar/revisar desde
   * el link de WhatsApp: cliente vinculado, antecedentes médicos, alergias,
   * condiciones especiales, declaración + firma. Las secciones clínicas
   * (datos generales internos, evaluación dermatológica, observación
   * cutánea, firma del especialista) quedan ocultas — la especialista
   * las completa después en interno.
   */
  mode?: "internal" | "public"
}

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

// Helpers centralizados en lib/formatters.ts.

function clienteNombre(cliente: ClienteCosmiatria) {
  return `${cliente.Nombre || ""} ${cliente.Apellido || ""}`.trim()
}

function clienteDireccion(cliente: ClienteCosmiatria) {
  return [cliente.Direccion, cliente.Localidad, cliente.Ciudad, cliente.Region].map((value) => String(value || "").trim()).filter(Boolean).join(", ")
}

// Display read-only para modo público: muestra label + valor como texto,
// no como Input. El cliente NO puede editar — los datos vienen pre-cargados
// por el operador al generar el link.
function ReadOnlyDisplay({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs font-bold text-muted-foreground">{label}</Label>
      <div className="mt-1 min-h-[40px] rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        {value && value.trim() ? value : <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  )
}

function CheckboxGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-bold">{label}</Label>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-2">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 rounded-lg border bg-muted/35 px-3 py-2 text-sm">
            <input type="checkbox" checked={value.includes(option)} onChange={() => onChange(toggle(value, option))} />
            {option}
          </label>
        ))}
      </div>
    </div>
  )
}

// Thin wrapper: delega al SiNoButtons compartido manteniendo la API
// histórica (label/value/onChange). Forzamos options=["Si","No"] porque
// las columnas DB de la ficha ya guardan "Si" sin tilde — cambiarlo
// rompería ediciones y filtros.
function YesNoField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <SiNoButtons
      label={label}
      value={value}
      onChange={onChange}
      options={["Si", "No"] as const}
    />
  )
}

function SelectField({ label, value, options, placeholder = "Seleccionar", onChange }: { label: string; value: string; options: readonly string[]; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>{options.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

// 10 motivos predefinidos según pedido del equipo. Si el cliente tiene un
// motivo distinto, usar el botón "Agregar otro motivo" (input libre).
const MOTIVOS_CONSULTA_PREDEFINIDOS = [
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

function MotivoConsultaPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const motivos = value ? value.split(",").map((m) => m.trim()).filter(Boolean) : []
  const [extra, setExtra] = useState("")
  const [adding, setAdding] = useState(false)
  const available = MOTIVOS_CONSULTA_PREDEFINIDOS.filter((m) => !motivos.includes(m))
  const add = (motivo: string) => {
    if (!motivo || motivos.includes(motivo)) return
    onChange([...motivos, motivo].join(", "))
  }
  const remove = (motivo: string) => {
    onChange(motivos.filter((m) => m !== motivo).join(", "))
  }
  const commitOtro = () => {
    const trimmed = extra.trim()
    if (trimmed && !motivos.includes(trimmed)) {
      onChange([...motivos, trimmed].join(", "))
    }
    setExtra("")
    setAdding(false)
  }
  return (
    <div className="space-y-2">
      {motivos.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {motivos.map((m) => (
            <span key={m} className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
              {m}
              <button type="button" onClick={() => remove(m)} aria-label={`Quitar ${m}`} className="rounded-full text-primary/70 hover:text-primary">×</button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Selecciona uno o más motivos. Puedes agregar uno personalizado.</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select
          value=""
          onValueChange={(v) => v && add(v)}
        >
          <SelectTrigger className="sm:flex-1">
            <SelectValue placeholder={available.length ? "Selecciona un motivo..." : "Todos agregados"} />
          </SelectTrigger>
          <SelectContent>
            {available.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        {!adding ? (
          <Button type="button" variant="outline" onClick={() => setAdding(true)} className="shrink-0">
            + Agregar otro motivo
          </Button>
        ) : null}
      </div>
      {adding ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="Escribir motivo personalizado..."
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitOtro() } }}
            autoFocus
            className="sm:flex-1"
          />
          <div className="flex gap-2">
            <Button type="button" onClick={commitOtro} disabled={!extra.trim()}>Agregar</Button>
            <Button type="button" variant="ghost" onClick={() => { setExtra(""); setAdding(false) }}>Cancelar</Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// Thin wrapper sobre SiNoConDetalle: mantiene la API histórica
// (label/value/notes/onChange/onNotesChange) usada por ~16 call sites.
// Acepta warningWhenYes para casos especiales (¿Embarazada?).
function ConditionalYesNo({
  label,
  value,
  notes,
  notesLabel,
  onChange,
  onNotesChange,
  warningWhenYes,
}: {
  label: string
  value: string
  notes: string
  notesLabel?: string
  onChange: (value: string) => void
  onNotesChange: (value: string) => void
  warningWhenYes?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border bg-white p-3 shadow-sm">
      <SiNoConDetalle
        label={label}
        options={["Si", "No"] as const}
        value={value}
        onChange={onChange}
        detailLabel={notesLabel || "Notas"}
        detailPlaceholder="Especificar..."
        detailValue={notes}
        onDetailChange={onNotesChange}
        warningWhenYes={warningWhenYes}
      />
    </div>
  )
}

export function FichaDermatologiaForm({ initialValue, operadoras = [], clientes = [], submitLabel = "Enviar ficha", onCancel, onSubmit, mode = "internal" }: Props) {
  const isPublic = mode === "public"
  const [form, setForm] = useState<FichaDermoCosmiatrica>(initialValue || { ...emptyFichaDermo, id: `dermo_${Date.now()}` })
  const [clientSearch, setClientSearch] = useState("")
  // Estado explícito del dropdown — antes el render se derivaba de
  // `clientSearch.trim() && matchedClientes.length`, pero como setClientSearch
  // tras seleccionar dejaba el texto = nombre del cliente, el cliente seguía
  // matcheando consigo mismo y el dropdown nunca se cerraba.
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const progress = useMemo(() => {
    const required = [form.fecha, form.sucursal, form.nombre, form.telefono, form.motivoConsulta, form.firma, form.declaracionAceptada]
    return Math.round((required.filter(Boolean).length / required.length) * 100)
  }, [form])

  // Búsqueda en vivo — usa el helper único `searchClients` (lib/cliente-search).
  const matchedClientes = useMemo(
    () =>
      searchClients(clientes, clientSearch, {
        limit: 8,
        filter: (cliente) => cliente.Estado !== "Inactivo",
      }),
    [clientes, clientSearch],
  )

  // Cerrar dropdown al hacer click fuera (la lista flota absoluta y antes
  // tapaba la "tarjeta de cliente vinculado", dando la falsa sensación de
  // que la selección no había funcionado).
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

  const update = (patch: Partial<FichaDermoCosmiatrica>) => setForm((current) => ({ ...current, ...patch }))

  const selectCliente = (cliente: ClienteCosmiatria) => {
    update({
      clienteId: cliente.ClienteID,
      nombre: clienteNombre(cliente),
      telefono: cliente.Telefono,
      cedula: cliente.DocumentoIdentidad,
      documento: cliente.DocumentoIdentidad,
      email: cliente.Email,
      ciudad: cliente.Ciudad,
      sucursal: cliente.Sucursal || form.sucursal,
      edad: cliente.Edad ? String(cliente.Edad) : form.edad,
      fechaNacimiento: cliente.FechaNacimiento || form.fechaNacimiento,
      direccion: clienteDireccion(cliente) || form.direccion,
    })
    // Limpiamos la búsqueda y cerramos el dropdown explícitamente para que
    // la tarjeta "Cliente vinculado" quede visible y el usuario pueda seguir
    // llenando la ficha sin que el popover tape el resto del formulario.
    setClientSearch("")
    setDropdownOpen(false)
  }

  const handleCambiarCliente = () => {
    update({
      clienteId: undefined,
      nombre: "",
      telefono: "",
      cedula: "",
      documento: "",
      email: "",
      ciudad: "",
      edad: "",
      fechaNacimiento: "",
      direccion: "",
    })
    setClientSearch("")
    setDropdownOpen(true)
  }

  const submit = async () => {
    setError("")
    if (!form.sucursal || !form.nombre || !form.telefono || !form.motivoConsulta || !form.firma || !form.declaracionAceptada) {
      setError("Completa sucursal, cliente, teléfono, motivo, declaración y firma del cliente.")
      return
    }
    try {
      setIsLoading(true)
      // En modo público forzamos estado="Pendiente de revisión": el especialista
      // debe abrirla en interno y completar (Evaluación, Observación cutánea,
      // firma profesional, etc.) antes de marcarla como Completada.
      // En modo interno respetamos el estado actual o cae a "Completada".
      const finalEstado = isPublic
        ? "Pendiente de revisión"
        : (form.estado || "Completada")
      await onSubmit({ ...form, estado: finalEstado, fechaRegistro: form.fechaRegistro || new Date().toISOString() })
      setForm({ ...emptyFichaDermo, id: `dermo_${Date.now()}`, fecha: new Date().toISOString().slice(0, 10) })
      setClientSearch("")
      setDropdownOpen(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo guardar la ficha")
    } finally {
      setIsLoading(false)
    }
  }

  const showPendingBanner = !isPublic && form.estado === "Pendiente de revisión"
  const finalizar = () => {
    update({ estado: "Completada" })
    // Hace scroll suave hacia abajo, donde está el botón submit.
    if (typeof window !== "undefined") {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-4 text-sm [&_[role=combobox]]:border-primary/25 [&_[role=combobox]]:bg-primary/10 [&_input]:border-primary/25 [&_input]:bg-primary/10 [&_textarea]:border-primary/25 [&_textarea]:bg-primary/10">
      {showPendingBanner ? (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-bold text-amber-900">Formulario enviado por cliente</p>
                <p className="mt-0.5 text-xs text-amber-800">
                  El cliente completó y firmó su parte desde un enlace público. Revisa la
                  información, completa los datos pendientes (evaluación, observación
                  cutánea, firma del especialista) y finaliza el consentimiento.
                </p>
              </div>
            </div>
            <Button type="button" onClick={finalizar} className="shrink-0 gap-2 bg-amber-600 text-white hover:bg-amber-700">
              <CheckCircle2 className="h-4 w-4" /> Marcar como completada
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold">Ficha Dermo-Cosmiátrica</h2>
              <p className="text-sm text-muted-foreground">Cibao Spa Laser · completar y firmar digitalmente</p>
            </div>
            <div className="text-right text-sm">
              <div className="font-semibold">{progress}%</div>
              <div className="h-2 w-32 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${progress}%` }} /></div>
            </div>
          </div>
        </CardContent>
      </Card>

      {isPublic ? null : <Card>
        <CardHeader><CardTitle className="text-base">Datos generales</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
          <div><Label>ID de ficha</Label><Input value={form.id} readOnly className="bg-muted/40 font-mono text-xs" /></div>
          <div><Label>Fecha</Label><Input type="date" value={form.fecha} onChange={(event) => update({ fecha: event.target.value })} /></div>
          <div><Label>Sucursal *</Label><Select value={form.sucursal} onValueChange={(value) => update({ sucursal: value })}><SelectTrigger><SelectValue placeholder="Seleccionar sucursal" /></SelectTrigger><SelectContent>{sucursalesCosmiatria.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
          <div>
            <Label>Especialista</Label>
            {operadoras.length ? (
              <Select value={form.operadora} onValueChange={(value) => update({ operadora: value, nombreEspecialista: value, especialista: value })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar especialista" /></SelectTrigger>
                <SelectContent>{operadoras.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input value={form.operadora} onChange={(event) => update({ operadora: event.target.value, nombreEspecialista: event.target.value, especialista: event.target.value })} placeholder="Nombre del especialista" />
            )}
          </div>
          {/* Estado: oculto del UI del cliente. Internamente se default-ea a
              "Pendiente" y al submit se eleva a "Completada" automáticamente. */}
        </CardContent>
      </Card>}

      {/* En público este Card es redundante (no hay picker porque no hay
          auth, y la tarjeta resumen duplica los campos editables de abajo).
          La sección de campos editables abajo cambia su título a "Cliente
          vinculado" en público — ver más abajo. */}
      {isPublic ? null : <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-4 w-4" />Cliente vinculado</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {clientes.length ? (
            <div ref={pickerRef} className="relative rounded-xl border border-primary/25 bg-primary/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label>Buscar cliente registrado</Label>
                {form.clienteId ? (
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={handleCambiarCliente}>
                    <RefreshCcw className="mr-1 h-3 w-3" /> Cambiar cliente
                  </Button>
                ) : null}
              </div>
              <Input
                value={clientSearch}
                onChange={(event) => {
                  setClientSearch(event.target.value)
                  setDropdownOpen(true)
                }}
                onFocus={() => setDropdownOpen(true)}
                placeholder="Buscar por nombre, teléfono, documento, correo o sucursal..."
                className="mt-1"
              />
              {dropdownOpen && clientSearch.trim() && matchedClientes.length ? (
                <div className="absolute left-3 right-3 top-[88px] z-30 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 shadow-xl">
                  {matchedClientes.map((cliente) => (
                    <button
                      key={cliente.ClienteID}
                      type="button"
                      // onMouseDown preventDefault evita que el blur del Input
                      // robe el evento y cancele el onClick en algunos browsers.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectCliente(cliente)}
                      className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                    >
                      <span className="font-semibold">{clienteNombre(cliente)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{cliente.Telefono || "Sin teléfono"}</span>
                      <span className="block text-xs text-muted-foreground">{cliente.Sucursal || "Sin sucursal"} · {cliente.DocumentoIdentidad || cliente.Email || "Sin documento"}</span>
                    </button>
                  ))}
                </div>
              ) : dropdownOpen && clientSearch.trim() ? (
                <div className="mt-2 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground">No se encontró en Clientes</div>
              ) : null}
            </div>
          ) : null}
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Cliente vinculado</p>
                <p className="mt-1 text-lg font-bold text-primary">{form.nombre || "Sin cliente seleccionado"}</p>
                <p className="text-sm text-muted-foreground">{form.telefono || "Sin teléfono"} {form.cedula || form.documento ? `· ${form.cedula || form.documento}` : ""}</p>
              </div>
              {form.clienteId ? (
                <Button type="button" variant="ghost" size="sm" className="shrink-0 text-xs" onClick={handleCambiarCliente}>
                  <RefreshCcw className="mr-1 h-3 w-3" /> Cambiar
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>}

      {/* Datos del cliente — formato unificado en TODO el sistema:
          Nombre, Teléfono, Cédula/Documento, Correo, Dirección, Sucursal.
          Fecha nacimiento, Edad, Ciudad, Ocupación se removieron del UI
          pero quedan en el shape (state) para no romper edición de fichas
          antiguas que los tengan.
          Título dinámico: en modo público se llama "Cliente vinculado"
          (el cliente ve sus datos pre-cargados para revisar), en interno
          sigue "Datos del cliente" para captura. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {isPublic ? <UserRound className="h-4 w-4" /> : null}
            {isPublic ? "Cliente vinculado" : "Datos del cliente"}
          </CardTitle>
          {isPublic ? (
            <p className="text-xs text-muted-foreground">
              Estos datos fueron cargados por el personal. Si algún dato es
              incorrecto, comuníquese con recepción.
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
          {isPublic ? (
            <>
              <ReadOnlyDisplay label="Nombre" value={form.nombre} />
              <ReadOnlyDisplay label="Teléfono" value={displayPhone(form.telefono)} />
              <ReadOnlyDisplay label="Cédula / Documento" value={displayDocumento(form.cedula || form.documento)} />
              <ReadOnlyDisplay label="Correo" value={form.email} />
              <ReadOnlyDisplay label="Dirección" value={form.direccion} className="col-span-full" />
              <ReadOnlyDisplay label="Sucursal" value={form.sucursal} />
              <ReadOnlyDisplay
                label="Motivo de la consulta"
                value={form.motivoConsulta}
                className="col-span-full"
              />
            </>
          ) : (<>
          <div><Label>Nombre *</Label><Input value={form.nombre} onChange={(event) => update({ nombre: event.target.value })} /></div>
          <div><Label>Teléfono *</Label><Input value={form.telefono} onChange={(event) => update({ telefono: formatPhone(event.target.value) })} /></div>
          <div><Label>Cédula / Documento</Label><Input value={form.cedula || form.documento} onChange={(event) => { const v = formatCedula(event.target.value); update({ cedula: v, documento: v }) }} placeholder="031-0327422-2" /></div>
          <div><Label>Correo</Label><Input type="email" value={form.email} onChange={(event) => update({ email: event.target.value })} /></div>
          <div className="col-span-full"><Label>Dirección</Label><Input value={form.direccion} onChange={(event) => update({ direccion: event.target.value })} /></div>
          <div>
            <Label>Sucursal *</Label>
            <Select value={form.sucursal} onValueChange={(value) => update({ sucursal: value })}>
              <SelectTrigger><SelectValue placeholder="Seleccionar sucursal" /></SelectTrigger>
              <SelectContent>{sucursalesCosmiatria.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-full">
            <Label>Motivo de la consulta *</Label>
            <div className="mt-2">
              <MotivoConsultaPicker value={form.motivoConsulta} onChange={(v) => update({ motivoConsulta: v })} />
            </div>
          </div>
          </>)}
        </CardContent>
      </Card>

      {isPublic ? null : <Card>
        <CardHeader><CardTitle className="text-base">Evaluación Dermatológica</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))] gap-3">
          <SelectField label="Tipo de piel" value={form.tipoPiel} options={tipoPielOpciones} onChange={(value) => update({ tipoPiel: value })} />
          <SelectField label="Fototipo" value={form.fototipo} options={fototipoOpciones} onChange={(value) => update({ fototipo: value })} />
          <SelectField label="Estado general" value={form.estadoGeneralPiel} options={estadoGeneralPielOpciones} onChange={(value) => update({ estadoGeneralPiel: value })} />
          <SelectField label="Sensibilidad" value={form.sensibilidad} options={sensibilidadOpciones} onChange={(value) => update({ sensibilidad: value })} />
          <SelectField label="Hidratación" value={form.hidratacion} options={hidratacionOpciones} onChange={(value) => update({ hidratacion: value })} />
          <YesNoField label="Manchas" value={form.manchas} onChange={(value) => update({ manchas: value })} />
          <YesNoField label="Acné" value={form.acne} onChange={(value) => update({ acne: value })} />
          <YesNoField label="Rosácea" value={form.rosacea} onChange={(value) => update({ rosacea: value })} />
          <YesNoField label="Melasma" value={form.melasma} onChange={(value) => update({ melasma: value })} />
          <YesNoField label="Cicatrices" value={form.cicatrices} onChange={(value) => update({ cicatrices: value })} />
          <YesNoField label="Lesiones visibles" value={form.lesionesVisibles} onChange={(value) => update({ lesionesVisibles: value })} />
          <YesNoField label="Irritación" value={form.irritacion} onChange={(value) => update({ irritacion: value })} />
          <YesNoField label="Alcohol" value={form.alcohol} onChange={(value) => update({ alcohol: value })} />
          <YesNoField label="Cigarrillos" value={form.cigarrillos} onChange={(value) => update({ cigarrillos: value })} />
          <YesNoField label="Café" value={form.cafe} onChange={(value) => update({ cafe: value })} />
          <div><Label>Calidad de sueño</Label><Select value={form.calidadSueno} onValueChange={(value) => update({ calidadSueno: value })}><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent>{calidadSuenoOpciones.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Vasos de agua al día</Label><Input value={form.vasosAgua} onChange={(event) => update({ vasosAgua: event.target.value })} /></div>
          <div><Label>Biotipo</Label><Select value={form.biotipo} onValueChange={(value) => update({ biotipo: value })}><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent>{biotipoOpciones.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Grasa</Label><Select value={form.grasa} onValueChange={(value) => update({ grasa: value })}><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent>{grasaOpciones.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Seca</Label><Select value={form.seca} onValueChange={(value) => update({ seca: value })}><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent>{secaOpciones.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Textura</Label><Select value={form.textura} onValueChange={(value) => update({ textura: value })}><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent>{texturaOpciones.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Color de la piel</Label><Select value={form.colorPiel} onValueChange={(value) => update({ colorPiel: value })}><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent>{colorPielOpciones.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
          <div className="col-span-full"><Label>Observaciones de la piel</Label><Textarea className="min-h-24" value={form.observacionesPiel} onChange={(event) => update({ observacionesPiel: event.target.value })} /></div>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader><CardTitle className="text-base">Antecedentes Médicos</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-3">
          <div className="col-span-full">
            <CheckboxGroup label="Antecedentes médicos" options={[...antecedentesMedicosOpciones]} value={form.antecedentesMedicos} onChange={(value) => update({ antecedentesMedicos: value })} />
          </div>
          <div className="col-span-full"><Label>Notas de antecedentes médicos</Label><Textarea className="min-h-24" value={form.antecedentesMedicosNotas} onChange={(event) => update({ antecedentesMedicosNotas: event.target.value })} /></div>
          {/* Sí/No con campo "¿Cuáles?" CONDICIONAL — solo aparece si Sí.
              Al pasar a No, el componente limpia el detalle automático. */}
          {([
            ["medicamentos", "¿Toma algún medicamento?", "medicamentosCuales", "¿Cuáles?"],
            ["medicamentoTopico", "¿Usa medicamento tópico?", "medicamentoTopicoCuales", "¿Cuáles?"],
            ["alergias", "¿Alergias?", "alergiasCuales", "¿A qué?"],
            ["cirugias", "¿Cirugías?", "cirugiasCuales", "¿Cuáles?"],
            ["cancerPiel", "¿Cáncer de la piel?", "cancerPielCuales", "¿Cuáles?"],
            ["cosmeticoActual", "¿Usa cosmético actual?", "cosmeticoActualCuales", "¿Cuáles?"],
          ] as const).map(([key, label, detailKey, detailLabel]) => (
            <div key={key} className="rounded-xl border bg-muted/25 p-3">
              <SiNoConDetalle
                label={label}
                options={["Si", "No"] as const}
                value={String(form[key as keyof FichaDermoCosmiatrica] || "")}
                onChange={(value) => update({ [key]: value } as Partial<FichaDermoCosmiatrica>)}
                detailLabel={detailLabel}
                detailValue={String(form[detailKey as keyof FichaDermoCosmiatrica] || "")}
                onDetailChange={(value) => update({ [detailKey]: value } as Partial<FichaDermoCosmiatrica>)}
              />
            </div>
          ))}
          <div className="rounded-xl border bg-muted/25 p-4"><YesNoField label="¿Herpes?" value={form.herpes} onChange={(value) => update({ herpes: value })} /></div>
          <div className="rounded-xl border bg-muted/25 p-4">
            <SiNoConDetalle
              label="¿Está embarazada?"
              options={["Si", "No"] as const}
              value={form.embarazada}
              onChange={(value) => update({ embarazada: value })}
              warningWhenYes={EMBARAZO_WARNING_MESSAGE}
            />
          </div>
          <div className="col-span-full"><Label>¿Tolera jabones, perfumes, cremas?</Label><Textarea className="min-h-24" value={form.toleraCosmeticos} onChange={(event) => update({ toleraCosmeticos: event.target.value })} /></div>
          <YesNoField label="¿Se depila a láser?" value={form.depilaLaser} onChange={(value) => update({ depilaLaser: value })} />
          <div><Label>¿Cómo reacciona?</Label><Input value={form.reaccionLaser} onChange={(event) => update({ reaccionLaser: event.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Alergias y Medicamentos</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <ConditionalYesNo label="¿Tiene alergias?" value={form.alergias} notes={form.alergiasNotas || form.alergiasCuales} onChange={(value) => update({ alergias: value })} onNotesChange={(value) => update({ alergiasNotas: value, alergiasCuales: value })} />
          <ConditionalYesNo label="¿Está tomando medicamentos?" value={form.medicamentos} notes={form.medicamentosNotas || form.medicamentosCuales} onChange={(value) => update({ medicamentos: value })} onNotesChange={(value) => update({ medicamentosNotas: value, medicamentosCuales: value })} />
          <ConditionalYesNo label="¿Usa fotosensibilizantes?" value={form.medicamentosFotosensibilizantes} notes={form.medicamentosFotosensibilizantesNotas} onChange={(value) => update({ medicamentosFotosensibilizantes: value })} onNotesChange={(value) => update({ medicamentosFotosensibilizantesNotas: value })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Condiciones Especiales</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ConditionalYesNo label="¿Está embarazada?" value={form.embarazo || form.embarazada} notes={form.embarazoNotas} onChange={(value) => update({ embarazo: value, embarazada: value })} onNotesChange={(value) => update({ embarazoNotas: value })} warningWhenYes={EMBARAZO_WARNING_MESSAGE} />
          <ConditionalYesNo label="¿Está en lactancia?" value={form.lactancia} notes={form.lactanciaNotas} onChange={(value) => update({ lactancia: value })} onNotesChange={(value) => update({ lactanciaNotas: value })} />
          <ConditionalYesNo label="¿Tiene piel sensible?" value={form.pielSensible} notes={form.pielSensibleNotas} onChange={(value) => update({ pielSensible: value })} onNotesChange={(value) => update({ pielSensibleNotas: value })} />
          <ConditionalYesNo label="¿Tendencia a queloides?" value={form.queloides} notes={form.queloidesNotas} onChange={(value) => update({ queloides: value })} onNotesChange={(value) => update({ queloidesNotas: value })} />
          <ConditionalYesNo label="¿Heridas o lesiones activas?" value={form.heridasActivas} notes={form.heridasActivasNotas} onChange={(value) => update({ heridasActivas: value })} onNotesChange={(value) => update({ heridasActivasNotas: value })} />
          <ConditionalYesNo label="¿Exposición solar reciente?" value={form.exposicionSolar} notes={form.exposicionSolarNotas} onChange={(value) => update({ exposicionSolar: value })} onNotesChange={(value) => update({ exposicionSolarNotas: value })} />
          <ConditionalYesNo label="¿Usa retinoides, ácidos o exfoliantes fuertes?" value={form.retinoidesAcidos} notes={form.retinoidesAcidosNotas} onChange={(value) => update({ retinoidesAcidos: value })} onNotesChange={(value) => update({ retinoidesAcidosNotas: value })} />
        </CardContent>
      </Card>

      {isPublic ? null : <Card>
        <CardHeader><CardTitle className="text-base">Observación y envejecimiento cutáneo</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,390px),1fr))] gap-4">
          <CheckboxGroup label="Se observa" options={seObservaOpciones} value={form.seObserva} onChange={(value) => update({ seObserva: value })} />
          <CheckboxGroup label="Tratamientos previos" options={tratamientosPreviosOpciones} value={form.tratamientosPrevios} onChange={(value) => update({ tratamientosPrevios: value })} />
          <CheckboxGroup label="Modificaciones pigmentarias" options={pigmentariasOpciones} value={form.modificacionesPigmentarias} onChange={(value) => update({ modificacionesPigmentarias: value })} />
          <CheckboxGroup label="Lentigo solar" options={lentigoOpciones} value={form.lentigoSolar} onChange={(value) => update({ lentigoSolar: value })} />
          <CheckboxGroup label="Involución cutánea" options={involucionOpciones} value={form.involucionCutanea} onChange={(value) => update({ involucionCutanea: value })} />
          <CheckboxGroup label="Modificaciones en la textura" options={texturaAlteracionesOpciones} value={form.texturaAlteraciones} onChange={(value) => update({ texturaAlteraciones: value })} />
          <CheckboxGroup label="Lipidización cutánea" options={lipidizacionOpciones} value={form.lipidizacionCutanea} onChange={(value) => update({ lipidizacionCutanea: value })} />
          <div className="col-span-full grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-3">
            <ConditionalYesNo label="Tratamientos faciales previos" value={form.tratamientosFacialesPrevios} notes={form.tratamientosPreviosNotas} onChange={(value) => update({ tratamientosFacialesPrevios: value })} onNotesChange={(value) => update({ tratamientosPreviosNotas: value })} />
            <YesNoField label="Láser previo" value={form.laserPrevio} onChange={(value) => update({ laserPrevio: value })} />
            <YesNoField label="Peeling previo" value={form.peelingPrevio} onChange={(value) => update({ peelingPrevio: value })} />
            <YesNoField label="Limpieza facial previa" value={form.limpiezaFacialPrevia} onChange={(value) => update({ limpiezaFacialPrevia: value })} />
            <YesNoField label="Rellenos o botox recientes" value={form.rellenosBotoxRecientes} onChange={(value) => update({ rellenosBotoxRecientes: value })} />
            <YesNoField label="Cirugías estéticas recientes" value={form.cirugiasEsteticasRecientes} onChange={(value) => update({ cirugiasEsteticasRecientes: value })} />
            <YesNoField label="Uso de ácidos/retinoides" value={form.usoAcidosRetinoides} onChange={(value) => update({ usoAcidosRetinoides: value })} />
            <div><Label>Fecha último tratamiento</Label><Input type="date" value={form.fechaUltimoTratamiento} onChange={(event) => update({ fechaUltimoTratamiento: event.target.value })} /></div>
          </div>
          <div className="col-span-full"><Label>Observaciones generales</Label><Textarea className="min-h-28" value={form.observaciones} onChange={(event) => update({ observaciones: event.target.value })} /></div>
          <div className="col-span-full"><Label>Observaciones profesionales</Label><Textarea className="min-h-28" value={form.observacionesProfesionales} onChange={(event) => update({ observacionesProfesionales: event.target.value })} /></div>
          <div className="col-span-full"><Label>Recomendaciones</Label><Textarea className="min-h-28" value={form.recomendaciones} onChange={(event) => update({ recomendaciones: event.target.value })} /></div>
          <div><Label>Cuidados sugeridos</Label><Input value={form.cuidadosSugeridos} onChange={(event) => update({ cuidadosSugeridos: event.target.value })} /></div>
          <div><Label>¿Recomienda procedimiento?</Label><Select value={form.recomiendaProcedimiento} onValueChange={(value) => update({ recomiendaProcedimiento: value })}><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent><SelectItem value="Si">Si</SelectItem><SelectItem value="No">No</SelectItem><SelectItem value="Evaluar">Evaluar</SelectItem></SelectContent></Select></div>
          <div><Label>Próxima evaluación</Label><Input type="date" value={form.proximaEvaluacion} onChange={(event) => update({ proximaEvaluacion: event.target.value })} /></div>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="h-4 w-4" />Declaración y firma
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-2xl border bg-primary/5 p-4 text-sm leading-relaxed text-muted-foreground">
            <p>
              Declaro que la información suministrada en esta ficha dermatológica
              es verdadera y completa. Entiendo que Cibao Spa Laser y su personal
              utilizarán esta información para evaluar mi piel, mis antecedentes y
              las condiciones necesarias antes de realizar cualquier procedimiento
              estético o dermatológico. Entiendo que omitir información puede
              afectar la seguridad y los resultados del tratamiento.
            </p>
            <p className="mt-2 font-semibold text-foreground">
              Autorizo a Cibao Spa Laser y a su personal a realizar el procedimiento descrito.
            </p>
          </div>
          <label className="flex items-start gap-3 rounded-2xl border bg-white p-3 text-sm">
            <Checkbox checked={form.declaracionAceptada} onCheckedChange={(checked) => update({ declaracionAceptada: checked === true })} />
            <span>
              Declaro que la información suministrada es verdadera y completa,
              y autorizo el procedimiento descrito.
            </span>
          </label>
          <div className={isPublic ? "" : "grid gap-4 md:grid-cols-2"}>
            <SignaturePad label="Firma del cliente" value={form.firma} onChange={(value) => update({ firma: value })} />
            {isPublic ? null : (
              <SignaturePad label="Firma del especialista" value={form.firmaEspecialista} onChange={(value) => update({ firmaEspecialista: value })} />
            )}
          </div>
          {isPublic ? (
            <p className="text-[11px] text-muted-foreground">
              La firma del especialista la completa el personal al finalizar tu consentimiento.
            </p>
          ) : (
            <div><Label>Nombre del especialista</Label><Input value={form.nombreEspecialista || form.especialista} onChange={(event) => update({ nombreEspecialista: event.target.value, especialista: event.target.value })} /></div>
          )}
          <div className="flex justify-between gap-2">
            <div />
            <div className="flex gap-2">
              {onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button> : null}
              <Button type="button" onClick={submit} disabled={isLoading}>{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{submitLabel}</Button>
            </div>
          </div>
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}

