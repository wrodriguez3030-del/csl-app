"use client"

import { useMemo, useState } from "react"
import { FileSignature, Loader2, Send, UserRound } from "lucide-react"
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
  siNoOpciones,
  sensibilidadOpciones,
  sucursalesCosmiatria,
  tipoPielOpciones,
  texturaAlteracionesOpciones,
  texturaOpciones,
  tratamientosPreviosOpciones,
  type FichaDermoCosmiatrica,
} from "@/lib/dermo-cosmiatria"
import type { ClienteCosmiatria } from "@/lib/types"
import { SignaturePad } from "@/components/signature-pad"

interface Props {
  initialValue?: FichaDermoCosmiatrica
  operadoras?: string[]
  clientes?: ClienteCosmiatria[]
  submitLabel?: string
  onCancel?: () => void
  onSubmit: (value: FichaDermoCosmiatrica) => Promise<void>
}

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "")
}

function formatPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

function clienteNombre(cliente: ClienteCosmiatria) {
  return `${cliente.Nombre || ""} ${cliente.Apellido || ""}`.trim()
}

function clienteDireccion(cliente: ClienteCosmiatria) {
  return [cliente.Direccion, cliente.Localidad, cliente.Ciudad, cliente.Region].map((value) => String(value || "").trim()).filter(Boolean).join(", ")
}

function clienteSearchText(cliente: ClienteCosmiatria) {
  return [
    clienteNombre(cliente),
    cliente.Telefono,
    cliente.Telefono2,
    cliente.DocumentoIdentidad,
    cliente.Email,
    cliente.Sucursal,
  ].join(" ").toLowerCase()
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

function YesNoField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-1.5">
        {siNoOpciones.map((option) => {
          const isSelected = value === option
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={`flex items-center justify-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                isSelected ? "border-primary bg-primary/15 text-primary" : "border-border bg-muted/25 text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <span className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50"}`}>
                {isSelected ? "✓" : ""}
              </span>
              {option}
            </button>
          )
        })}
      </div>
    </div>
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

function ConditionalYesNo({ label, value, notes, notesLabel, onChange, onNotesChange }: { label: string; value: string; notes: string; notesLabel?: string; onChange: (value: string) => void; onNotesChange: (value: string) => void }) {
  return (
    <div className="rounded-2xl border bg-white p-3 shadow-sm">
      <YesNoField label={label} value={value} onChange={(next) => { onChange(next); if (next === "No") onNotesChange("") }} />
      {value === "Si" || value === "Sí" ? (
        <div className="mt-3">
          <Label>{notesLabel || "Notas"}</Label>
          <Input value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder="Especificar..." />
        </div>
      ) : null}
    </div>
  )
}

export function FichaDermatologiaForm({ initialValue, operadoras = [], clientes = [], submitLabel = "Enviar ficha", onCancel, onSubmit }: Props) {
  const [form, setForm] = useState<FichaDermoCosmiatrica>(initialValue || { ...emptyFichaDermo, id: `dermo_${Date.now()}` })
  const [clientSearch, setClientSearch] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const progress = useMemo(() => {
    const required = [form.fecha, form.sucursal, form.nombre, form.telefono, form.motivoConsulta, form.firma, form.declaracionAceptada]
    return Math.round((required.filter(Boolean).length / required.length) * 100)
  }, [form])

  const matchedClientes = useMemo(() => {
    const query = clientSearch.trim().toLowerCase()
    if (!query) return []
    return clientes
      .filter((cliente) => cliente.Estado !== "Inactivo")
      .filter((cliente) => clienteSearchText(cliente).includes(query) || onlyDigits(clienteSearchText(cliente)).includes(onlyDigits(query)))
      .slice(0, 8)
  }, [clientes, clientSearch])

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
    setClientSearch(clienteNombre(cliente))
  }

  const submit = async () => {
    setError("")
    if (!form.sucursal || !form.nombre || !form.telefono || !form.motivoConsulta || !form.firma || !form.declaracionAceptada) {
      setError("Completa sucursal, cliente, teléfono, motivo, declaración y firma del cliente.")
      return
    }
    try {
      setIsLoading(true)
      await onSubmit({ ...form, estado: form.estado || "Completada", fechaRegistro: form.fechaRegistro || new Date().toISOString() })
      setForm({ ...emptyFichaDermo, id: `dermo_${Date.now()}`, fecha: new Date().toISOString().slice(0, 10) })
      setClientSearch("")
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo guardar la ficha")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-4 text-sm [&_[role=combobox]]:border-primary/25 [&_[role=combobox]]:bg-primary/10 [&_input]:border-primary/25 [&_input]:bg-primary/10 [&_textarea]:border-primary/25 [&_textarea]:bg-primary/10">
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

      <Card>
        <CardHeader><CardTitle className="text-base">Datos generales</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
          <div><Label>ID de ficha</Label><Input value={form.id} readOnly className="bg-muted/40 font-mono text-xs" /></div>
          <div><Label>Fecha</Label><Input type="date" value={form.fecha} onChange={(event) => update({ fecha: event.target.value })} /></div>
          <div><Label>Sucursal *</Label><Select value={form.sucursal} onValueChange={(value) => update({ sucursal: value })}><SelectTrigger><SelectValue placeholder="Seleccionar sucursal" /></SelectTrigger><SelectContent>{sucursalesCosmiatria.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
          <div>
            <Label>Operadora</Label>
            {operadoras.length ? (
              <Select value={form.operadora} onValueChange={(value) => update({ operadora: value })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar operadora" /></SelectTrigger>
                <SelectContent>{operadoras.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input value={form.operadora} onChange={(event) => update({ operadora: event.target.value })} placeholder="Nombre de operadora" />
            )}
          </div>
          <div><Label>Especialista</Label><Input value={form.nombreEspecialista || form.especialista} onChange={(event) => update({ nombreEspecialista: event.target.value, especialista: event.target.value })} placeholder="Nombre del especialista" /></div>
          <div><Label>Estado</Label><Select value={form.estado} onValueChange={(value) => update({ estado: value as FichaDermoCosmiatrica["estado"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Pendiente">Pendiente</SelectItem><SelectItem value="Completada">Completada</SelectItem><SelectItem value="Archivada">Archivada</SelectItem></SelectContent></Select></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-4 w-4" />Cliente vinculado</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {clientes.length ? (
            <div className="relative rounded-xl border border-primary/25 bg-primary/10 p-3">
              <Label>Buscar cliente registrado</Label>
              <Input
                value={clientSearch}
                onChange={(event) => setClientSearch(event.target.value)}
                placeholder="Buscar por nombre, teléfono, documento, correo o sucursal..."
                className="mt-1"
              />
              {clientSearch.trim() && matchedClientes.length ? (
                <div className="absolute left-3 right-3 top-[76px] z-20 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 shadow-xl">
                  {matchedClientes.map((cliente) => (
                    <button key={cliente.ClienteID} type="button" onClick={() => selectCliente(cliente)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                      <span className="font-semibold">{clienteNombre(cliente)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{cliente.Telefono || "Sin teléfono"}</span>
                      <span className="block text-xs text-muted-foreground">{cliente.Sucursal || "Sin sucursal"} · {cliente.DocumentoIdentidad || cliente.Email || "Sin documento"}</span>
                    </button>
                  ))}
                </div>
              ) : clientSearch.trim() ? (
                <div className="mt-2 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground">No se encontró en Clientes</div>
              ) : null}
            </div>
          ) : null}
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Cliente vinculado</p>
            <p className="mt-1 text-lg font-bold text-primary">{form.nombre || "Sin cliente seleccionado"}</p>
            <p className="text-sm text-muted-foreground">{form.telefono || "Sin teléfono"} {form.cedula || form.documento ? `· ${form.cedula || form.documento}` : ""}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Datos del cliente</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
          <div><Label>Nombre *</Label><Input value={form.nombre} onChange={(event) => update({ nombre: event.target.value })} /></div>
          <div><Label>Cédula / Documento</Label><Input value={form.cedula || form.documento} onChange={(event) => update({ cedula: event.target.value, documento: event.target.value })} /></div>
          <div><Label>Teléfono *</Label><Input value={form.telefono} onChange={(event) => update({ telefono: formatPhone(event.target.value) })} /></div>
          <div><Label>Correo</Label><Input type="email" value={form.email} onChange={(event) => update({ email: event.target.value })} /></div>
          <div><Label>Fecha nacimiento</Label><Input type="date" value={form.fechaNacimiento} onChange={(event) => update({ fechaNacimiento: event.target.value })} /></div>
          <div><Label>Edad</Label><Input value={form.edad} onChange={(event) => update({ edad: event.target.value })} /></div>
          <div><Label>Ciudad</Label><Input value={form.ciudad} onChange={(event) => update({ ciudad: event.target.value })} /></div>
          <div><Label>Ocupación</Label><Input value={form.ocupacion} onChange={(event) => update({ ocupacion: event.target.value })} /></div>
          <div className="col-span-full"><Label>Dirección</Label><Input value={form.direccion} onChange={(event) => update({ direccion: event.target.value })} /></div>
          <div className="col-span-full"><Label>Motivo de la consulta *</Label><Input value={form.motivoConsulta} onChange={(event) => update({ motivoConsulta: event.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
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
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Antecedentes Médicos</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-3">
          <div className="col-span-full">
            <CheckboxGroup label="Antecedentes médicos" options={[...antecedentesMedicosOpciones]} value={form.antecedentesMedicos} onChange={(value) => update({ antecedentesMedicos: value })} />
          </div>
          <div className="col-span-full"><Label>Notas de antecedentes médicos</Label><Textarea className="min-h-24" value={form.antecedentesMedicosNotas} onChange={(event) => update({ antecedentesMedicosNotas: event.target.value })} /></div>
          {[
            ["medicamentos", "¿Toma algún medicamento?", "medicamentosCuales", "¿Cuáles?"],
            ["medicamentoTopico", "¿Usa medicamento tópico?", "medicamentoTopicoCuales", "¿Cuáles?"],
            ["alergias", "¿Alergias?", "alergiasCuales", "¿A qué?"],
            ["cirugias", "¿Cirugías?", "cirugiasCuales", "¿Cuáles?"],
            ["cancerPiel", "¿Cáncer de la piel?", "cancerPielCuales", "¿Cuáles?"],
            ["cosmeticoActual", "¿Usa cosmético actual?", "cosmeticoActualCuales", "¿Cuáles?"],
          ].map(([key, label, detailKey, detailLabel]) => (
            <div key={key} className="grid gap-3 rounded-xl border bg-muted/25 p-3 xl:grid-cols-[minmax(170px,0.8fr)_minmax(190px,1.2fr)]">
              <YesNoField label={label} value={String(form[key as keyof FichaDermoCosmiatrica] || "")} onChange={(value) => update({ [key]: value } as Partial<FichaDermoCosmiatrica>)} />
              <div><Label>{detailLabel}</Label><Input value={String(form[detailKey as keyof FichaDermoCosmiatrica] || "")} onChange={(event) => update({ [detailKey]: event.target.value } as Partial<FichaDermoCosmiatrica>)} /></div>
            </div>
          ))}
          <div className="rounded-xl border bg-muted/25 p-4"><YesNoField label="¿Herpes?" value={form.herpes} onChange={(value) => update({ herpes: value })} /></div>
          <div className="rounded-xl border bg-muted/25 p-4"><YesNoField label="¿Está embarazada?" value={form.embarazada} onChange={(value) => update({ embarazada: value })} /></div>
          <div className="col-span-full"><Label>¿Tolera jabones, perfumes, cremas?</Label><Textarea className="min-h-24" value={form.toleraCosmeticos} onChange={(event) => update({ toleraCosmeticos: event.target.value })} /></div>
          <YesNoField label="¿Se depila a láser?" value={form.depilaLaser} onChange={(value) => update({ depilaLaser: value })} />
          <div><Label>¿Cómo reacciona?</Label><Input value={form.reaccionLaser} onChange={(event) => update({ reaccionLaser: event.target.value })} /></div>
          <div className="col-span-full"><Label>Reacción al frío, viento o estufas</Label><Textarea className="min-h-24" value={form.reaccionClima} onChange={(event) => update({ reaccionClima: event.target.value })} /></div>
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
          <ConditionalYesNo label="¿Está embarazada?" value={form.embarazo || form.embarazada} notes={form.embarazoNotas} onChange={(value) => update({ embarazo: value, embarazada: value })} onNotesChange={(value) => update({ embarazoNotas: value })} />
          <ConditionalYesNo label="¿Está en lactancia?" value={form.lactancia} notes={form.lactanciaNotas} onChange={(value) => update({ lactancia: value })} onNotesChange={(value) => update({ lactanciaNotas: value })} />
          <ConditionalYesNo label="¿Tiene piel sensible?" value={form.pielSensible} notes={form.pielSensibleNotas} onChange={(value) => update({ pielSensible: value })} onNotesChange={(value) => update({ pielSensibleNotas: value })} />
          <ConditionalYesNo label="¿Tendencia a queloides?" value={form.queloides} notes={form.queloidesNotas} onChange={(value) => update({ queloides: value })} onNotesChange={(value) => update({ queloidesNotas: value })} />
          <ConditionalYesNo label="¿Heridas o lesiones activas?" value={form.heridasActivas} notes={form.heridasActivasNotas} onChange={(value) => update({ heridasActivas: value })} onNotesChange={(value) => update({ heridasActivasNotas: value })} />
          <ConditionalYesNo label="¿Exposición solar reciente?" value={form.exposicionSolar} notes={form.exposicionSolarNotas} onChange={(value) => update({ exposicionSolar: value })} onNotesChange={(value) => update({ exposicionSolarNotas: value })} />
          <ConditionalYesNo label="¿Usa retinoides, ácidos o exfoliantes fuertes?" value={form.retinoidesAcidos} notes={form.retinoidesAcidosNotas} onChange={(value) => update({ retinoidesAcidos: value })} onNotesChange={(value) => update({ retinoidesAcidosNotas: value })} />
        </CardContent>
      </Card>

      <Card>
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
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileSignature className="h-4 w-4" />Declaración y firmas</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-2xl border bg-primary/5 p-4 text-sm leading-relaxed text-muted-foreground">
            Declaro que la información suministrada en esta ficha dermatológica es verdadera y completa. Entiendo que Cibao Spa Láser y su personal utilizarán esta información para evaluar mi piel, mis antecedentes y las condiciones necesarias antes de realizar cualquier procedimiento estético o dermatológico. Entiendo que omitir información puede afectar la seguridad y los resultados del tratamiento.
          </div>
          <label className="flex items-start gap-3 rounded-2xl border bg-white p-3 text-sm">
            <Checkbox checked={form.declaracionAceptada} onCheckedChange={(checked) => update({ declaracionAceptada: checked === true })} />
            <span>Declaro que la información suministrada es verdadera y completa.</span>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <SignaturePad label="Firma del cliente" value={form.firma} onChange={(value) => update({ firma: value })} />
            <SignaturePad label="Firma del especialista" value={form.firmaEspecialista} onChange={(value) => update({ firmaEspecialista: value })} />
          </div>
          <div><Label>Nombre del especialista</Label><Input value={form.nombreEspecialista || form.especialista} onChange={(event) => update({ nombreEspecialista: event.target.value, especialista: event.target.value })} /></div>
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

