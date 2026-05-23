"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Briefcase, CheckCircle2, FileSignature, GraduationCap, Landmark, Loader2, Send, Trash2, User, Users2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SiNoButtons } from "@/components/si-no-buttons"

type FamiliarItem = { nombre: string; parentesco: string; edad: string; direccion: string; ocupacion: string }
type EducacionItem = { escolaridad: string; institucion: string; curso: string; nivel: string; estado: string }
type ExperienciaItem = { desde: string; hasta: string; empresa: string; telefono: string; superior: string; inmediato: string; puesto: string; tareas: string }
type ReferenciaItem = { nombre: string; ocupacion: string; telefono: string }

type SolicitudPublica = {
  id: string
  fecha: string
  fechaIngresoLaboral: string
  estado: string
  puestoSolicitado: string
  sucursal: string
  nombre: string
  apellido: string
  cedula: string
  fechaNacimiento: string
  tipoSangre: string
  sexo: string
  estatura: string
  peso: string
  estadoCivil: string
  nacionalidad: string
  telefonoResidencia: string
  celular: string
  calle: string
  numeroDir: string
  sector: string
  ciudad: string
  email: string
  licenciaConducir: string
  categoriaLicencia: string
  perteneceAFP: string
  cualAFP: string
  banco: string
  numeroCuenta: string
  tipoCuenta: string
  pretensionesSalariales: string
  emergenciaContacto: string
  nivelEducacion: string
  especialidad: string
  familia: FamiliarItem[]
  educacion: EducacionItem[]
  experiencia: ExperienciaItem[]
  referencias: ReferenciaItem[]
  excel: boolean
  word: boolean
  powerPoint: boolean
  access: boolean
  windows: boolean
  otrosConocimientos: string
  disponibilidad: string
  firma: string
  observaciones: string
  empresaOculta: string
}

const emptyForm: SolicitudPublica = {
  id: "",
  fecha: new Date().toISOString().slice(0, 10),
  fechaIngresoLaboral: "",
  estado: "Pendiente",
  puestoSolicitado: "",
  sucursal: "",
  nombre: "",
  apellido: "",
  cedula: "",
  fechaNacimiento: "",
  tipoSangre: "",
  sexo: "",
  estatura: "",
  peso: "",
  estadoCivil: "",
  nacionalidad: "Dominicana",
  telefonoResidencia: "",
  celular: "",
  calle: "",
  numeroDir: "",
  sector: "",
  ciudad: "",
  email: "",
  licenciaConducir: "",
  categoriaLicencia: "",
  perteneceAFP: "",
  cualAFP: "",
  banco: "",
  numeroCuenta: "",
  tipoCuenta: "",
  pretensionesSalariales: "",
  emergenciaContacto: "",
  nivelEducacion: "",
  especialidad: "",
  familia: [],
  educacion: [],
  experiencia: [],
  referencias: [],
  excel: false,
  word: false,
  powerPoint: false,
  access: false,
  windows: false,
  otrosConocimientos: "",
  disponibilidad: "",
  firma: "",
  observaciones: "",
  empresaOculta: "",
}

const puestos = ["Operadora de Láser", "Cosmiatra", "Masajista", "Asistente Adm", "Encargado"]
const estadosCiviles = ["Soltero/a", "Casado/a", "Unión Libre", "Divorciado/a", "Viudo/a"]
const tiposSangre = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "No sabe"]
const ciudades = ["Santiago", "La Vega"]
const tiposCuenta = ["Ahorro", "Corriente"]
const fallbackSucursales = ["Rafael Vidal", "Los Jardines", "Villa Olga", "La Vega"]

function onlyDigits(value: string) {
  return String(value || "").replace(/\D/g, "")
}

function formatCedula(value: string) {
  const digits = onlyDigits(value).slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`
}

function formatPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

function formatHeightInput(value: string) {
  const digits = onlyDigits(value).slice(0, 2)
  if (digits.length <= 1) return digits
  return `${digits.slice(0, 1)}'${digits.slice(1)}"`
}

export default function SolicitudEmpleoPublicaPage() {
  const [form, setForm] = useState<SolicitudPublica>(emptyForm)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [successId, setSuccessId] = useState("")
  const [sucursales, setSucursales] = useState(fallbackSucursales)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)

  useEffect(() => {
    fetch("/api/public/solicitud-empleo")
      .then((response) => response.json())
      .then((result: { sucursales?: string[] }) => {
        if (Array.isArray(result.sucursales) && result.sucursales.length) setSucursales(result.sucursales)
      })
      .catch(() => undefined)
  }, [])

  const progress = useMemo(() => {
    const required = [form.puestoSolicitado, form.sucursal, form.nombre, form.apellido, form.cedula, form.celular, form.fechaNacimiento, form.sexo, form.ciudad, form.firma]
    return Math.round((required.filter(Boolean).length / required.length) * 100)
  }, [form])

  const addFamilia = () => setForm({ ...form, familia: [...form.familia, { nombre: "", parentesco: "", edad: "", direccion: "", ocupacion: "" }] })
  const addEducacion = () => setForm({ ...form, educacion: [...form.educacion, { escolaridad: "", institucion: "", curso: "", nivel: "", estado: "" }] })
  const addExperiencia = () => setForm({ ...form, experiencia: [...form.experiencia, { desde: "", hasta: "", empresa: "", telefono: "", superior: "", inmediato: "", puesto: "", tareas: "" }] })
  const addReferencia = () => setForm({ ...form, referencias: [...form.referencias, { nombre: "", ocupacion: "", telefono: "" }] })

  const getCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    const point = getCanvasPoint(event)
    canvas.setPointerCapture(event.pointerId)
    isDrawing.current = true
    context.beginPath()
    context.lineWidth = 2
    context.lineCap = "round"
    context.strokeStyle = "#020617"
    context.moveTo(point.x, point.y)
  }

  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context || !isDrawing.current) return
    const point = getCanvasPoint(event)
    context.lineTo(point.x, point.y)
    context.stroke()
  }

  const stopDrawing = () => {
    const canvas = canvasRef.current
    isDrawing.current = false
    if (canvas) setForm((current) => ({ ...current, firma: canvas.toDataURL("image/png") }))
  }

  const clearFirma = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    setForm({ ...form, firma: "" })
  }

  const submit = async () => {
    setError("")
    if (!form.puestoSolicitado || !form.nombre || !form.apellido || !form.cedula || !form.celular) {
      setError("Completa puesto, nombre, apellido, cédula y celular.")
      return
    }

    try {
      setIsLoading(true)
      const response = await fetch("/api/public/solicitud-empleo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, id: form.id || `sol_${Date.now()}` }),
      })
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; solicitudId?: string }
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo enviar la solicitud")
      setSuccessId(result.solicitudId || "")
      setForm(emptyForm)
      clearFirma()
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Error enviando la solicitud")
    } finally {
      setIsLoading(false)
    }
  }

  if (successId) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
        <Card className="mx-auto max-w-2xl border-cyan-500/20 bg-slate-900">
          <CardContent className="space-y-4 pt-8 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-cyan-400" />
            <h1 className="text-2xl font-bold">Solicitud enviada</h1>
            <p className="text-slate-300">Gracias. Tu solicitud fue registrada correctamente en el sistema de Recursos Humanos.</p>
            <p className="rounded-lg bg-slate-950 p-3 text-sm text-slate-400">Código: {successId}</p>
            <Button onClick={() => setSuccessId("")}>Enviar otra solicitud</Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="public-job-form min-h-screen bg-slate-950 px-4 py-8 text-white">
      <style jsx global>{`
        .public-job-form input,
        .public-job-form textarea,
        .public-job-form button[role="combobox"] {
          background-color: rgb(30 41 59) !important;
          border-color: rgb(71 85 105) !important;
          color: white !important;
        }
        .public-job-form input::placeholder,
        .public-job-form textarea::placeholder {
          color: rgb(148 163 184) !important;
        }
        .public-job-form input:focus,
        .public-job-form textarea:focus,
        .public-job-form button[role="combobox"]:focus {
          border-color: rgb(34 211 238) !important;
          box-shadow: 0 0 0 2px rgb(34 211 238 / 0.25) !important;
        }
      `}</style>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-3xl border border-cyan-500/20 bg-slate-900 p-6 shadow-2xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-cyan-400">Cibao Spa Laser</div>
              <h1 className="mt-1 text-3xl font-bold">Solicitud de empleo</h1>
              <p className="mt-2 text-slate-400">Completa tus datos. Al enviar, RRHH recibirá la solicitud en el sistema.</p>
            </div>
            <div className="min-w-44">
              <div className="mb-2 text-sm text-slate-400">Progreso {progress}%</div>
              <div className="h-2 rounded-full bg-slate-800">
                <div className="h-2 rounded-full bg-cyan-400" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        </div>

        {error ? <div className="rounded-xl border border-red-500/30 bg-red-950/50 p-4 text-red-200">{error}</div> : null}

        <Card className="border-white/10 bg-slate-900 text-white">
          <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-5 w-5 text-cyan-400" />Datos personales</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Puesto solicitado *"><OptionSelect value={form.puestoSolicitado} placeholder="Seleccionar puesto" options={puestos} onChange={(value) => setForm({ ...form, puestoSolicitado: value })} /></Field>
            <Field label="Sucursal"><OptionSelect value={form.sucursal} placeholder="Seleccionar sucursal" options={sucursales} onChange={(value) => setForm({ ...form, sucursal: value })} /></Field>
            <Field label="Nombres *"><Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></Field>
            <Field label="Apellidos *"><Input value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} /></Field>
            <Field label="Cédula *"><Input value={form.cedula} onChange={(e) => setForm({ ...form, cedula: formatCedula(e.target.value) })} /></Field>
            <Field label="Fecha nacimiento"><Input type="date" value={form.fechaNacimiento} onChange={(e) => setForm({ ...form, fechaNacimiento: e.target.value })} /></Field>
            <Field label="Sexo"><Select value={form.sexo} onValueChange={(value) => setForm({ ...form, sexo: value })}><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger><SelectContent><SelectItem value="Femenino">Femenino</SelectItem><SelectItem value="Masculino">Masculino</SelectItem></SelectContent></Select></Field>
            <Field label="Estado civil"><OptionSelect value={form.estadoCivil} placeholder="Seleccionar estado civil" options={estadosCiviles} onChange={(value) => setForm({ ...form, estadoCivil: value })} /></Field>
            <Field label="Nacionalidad"><Input value={form.nacionalidad} onChange={(e) => setForm({ ...form, nacionalidad: e.target.value })} /></Field>
            <Field label="Tipo sangre"><OptionSelect value={form.tipoSangre} placeholder="Seleccionar tipo de sangre" options={tiposSangre} onChange={(value) => setForm({ ...form, tipoSangre: value })} /></Field>
            <Field label="Estatura (pies)"><Input value={form.estatura} onChange={(e) => setForm({ ...form, estatura: formatHeightInput(e.target.value) })} placeholder={`Ej: 5'6"`} /></Field>
            <Field label="Peso (lbs)"><Input value={form.peso} onChange={(e) => setForm({ ...form, peso: e.target.value })} placeholder="Ej: 130" /></Field>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-900 text-white">
          <CardHeader><CardTitle>Contacto y dirección</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Celular *"><Input value={form.celular} onChange={(e) => setForm({ ...form, celular: formatPhone(e.target.value) })} /></Field>
            <Field label="Teléfono residencia"><Input value={form.telefonoResidencia} onChange={(e) => setForm({ ...form, telefonoResidencia: formatPhone(e.target.value) })} /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Ciudad"><OptionSelect value={form.ciudad} placeholder="Seleccionar ciudad" options={ciudades} onChange={(value) => setForm({ ...form, ciudad: value })} /></Field>
            <Field label="Calle"><Input value={form.calle} onChange={(e) => setForm({ ...form, calle: e.target.value })} /></Field>
            <Field label="Número"><Input value={form.numeroDir} onChange={(e) => setForm({ ...form, numeroDir: e.target.value })} /></Field>
            <Field label="Sector"><Input value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} /></Field>
            <Field label="Emergencia contacto"><Input value={form.emergenciaContacto} onChange={(e) => setForm({ ...form, emergenciaContacto: e.target.value })} /></Field>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-900 text-white">
          <CardHeader><CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5 text-cyan-400" />Datos bancarios y laborales</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Fecha de ingreso laboral"><Input type="date" value={form.fechaIngresoLaboral} onChange={(e) => setForm({ ...form, fechaIngresoLaboral: e.target.value })} /></Field>
            <Field label="Banco"><Input value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })} /></Field>
            <Field label="Número de cuenta"><Input value={form.numeroCuenta} onChange={(e) => setForm({ ...form, numeroCuenta: e.target.value })} /></Field>
            <Field label="Tipo de cuenta"><OptionSelect value={form.tipoCuenta} placeholder="Seleccionar tipo de cuenta" options={tiposCuenta} onChange={(value) => setForm({ ...form, tipoCuenta: value })} /></Field>
            <Field label="Pretensiones salariales"><Input value={form.pretensionesSalariales} onChange={(e) => setForm({ ...form, pretensionesSalariales: e.target.value })} /></Field>
            <Field label="Licencia de conducir">
              <SiNoButtons
                value={form.licenciaConducir}
                options={["Si", "No"]}
                onChange={(value) => setForm({ ...form, licenciaConducir: value, categoriaLicencia: "" })}
              />
            </Field>
          </CardContent>
        </Card>

        <RepeaterCard title="Familia" icon={<Users2 className="h-5 w-5 text-cyan-400" />} onAdd={addFamilia}>
          {form.familia.map((item, index) => (
            <div key={index} className="grid gap-3 rounded-xl border border-white/10 p-3 md:grid-cols-5">
              <Input placeholder="Nombre" value={item.nombre} onChange={(e) => updateArray(form, setForm, "familia", index, "nombre", e.target.value)} />
              <Input placeholder="Parentesco" value={item.parentesco} onChange={(e) => updateArray(form, setForm, "familia", index, "parentesco", e.target.value)} />
              <Input placeholder="Edad" value={item.edad} onChange={(e) => updateArray(form, setForm, "familia", index, "edad", e.target.value)} />
              <Input placeholder="Ocupación" value={item.ocupacion} onChange={(e) => updateArray(form, setForm, "familia", index, "ocupacion", e.target.value)} />
              <Button variant="outline" onClick={() => setForm({ ...form, familia: form.familia.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </RepeaterCard>

        <RepeaterCard title="Educación" icon={<GraduationCap className="h-5 w-5 text-cyan-400" />} onAdd={addEducacion}>
          {form.educacion.map((item, index) => (
            <div key={index} className="grid gap-3 rounded-xl border border-white/10 p-3 md:grid-cols-5">
              <Input placeholder="Escolaridad" value={item.escolaridad} onChange={(e) => updateArray(form, setForm, "educacion", index, "escolaridad", e.target.value)} />
              <Input placeholder="Institución" value={item.institucion} onChange={(e) => updateArray(form, setForm, "educacion", index, "institucion", e.target.value)} />
              <Input placeholder="Curso/Carrera" value={item.curso} onChange={(e) => updateArray(form, setForm, "educacion", index, "curso", e.target.value)} />
              <Input placeholder="Nivel" value={item.nivel} onChange={(e) => updateArray(form, setForm, "educacion", index, "nivel", e.target.value)} />
              <Button variant="outline" onClick={() => setForm({ ...form, educacion: form.educacion.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </RepeaterCard>

        <RepeaterCard title="Experiencia laboral" icon={<Briefcase className="h-5 w-5 text-cyan-400" />} onAdd={addExperiencia}>
          {form.experiencia.map((item, index) => (
            <div key={index} className="grid gap-3 rounded-xl border border-white/10 p-3 md:grid-cols-4">
              <Input type="date" value={item.desde} onChange={(e) => updateArray(form, setForm, "experiencia", index, "desde", e.target.value)} />
              <Input type="date" value={item.hasta} onChange={(e) => updateArray(form, setForm, "experiencia", index, "hasta", e.target.value)} />
              <Input placeholder="Empresa" value={item.empresa} onChange={(e) => updateArray(form, setForm, "experiencia", index, "empresa", e.target.value)} />
              <Input placeholder="Puesto" value={item.puesto} onChange={(e) => updateArray(form, setForm, "experiencia", index, "puesto", e.target.value)} />
              <Input placeholder="Teléfono" value={item.telefono} onChange={(e) => updateArray(form, setForm, "experiencia", index, "telefono", formatPhone(e.target.value))} />
              <Input placeholder="Superior" value={item.superior} onChange={(e) => updateArray(form, setForm, "experiencia", index, "superior", e.target.value)} />
              <Input placeholder="Tareas" value={item.tareas} onChange={(e) => updateArray(form, setForm, "experiencia", index, "tareas", e.target.value)} />
              <Button variant="outline" onClick={() => setForm({ ...form, experiencia: form.experiencia.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </RepeaterCard>

        <RepeaterCard title="Referencias personales" icon={<Users2 className="h-5 w-5 text-cyan-400" />} onAdd={addReferencia}>
          {form.referencias.map((item, index) => (
            <div key={index} className="grid gap-3 rounded-xl border border-white/10 p-3 md:grid-cols-4">
              <Input placeholder="Nombre" value={item.nombre} onChange={(e) => updateArray(form, setForm, "referencias", index, "nombre", e.target.value)} />
              <Input placeholder="Ocupación" value={item.ocupacion} onChange={(e) => updateArray(form, setForm, "referencias", index, "ocupacion", e.target.value)} />
              <Input placeholder="Teléfono" value={item.telefono} onChange={(e) => updateArray(form, setForm, "referencias", index, "telefono", formatPhone(e.target.value))} />
              <Button variant="outline" onClick={() => setForm({ ...form, referencias: form.referencias.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </RepeaterCard>

        <Card className="border-white/10 bg-slate-900 text-white">
          <CardHeader><CardTitle>Habilidades y firma</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-5">
              {(["excel", "word", "powerPoint", "access", "windows"] as const).map((key) => (
                <label key={key} className="flex items-center gap-2 rounded-xl border border-white/10 p-3 text-sm">
                  <input type="checkbox" checked={Boolean(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
                  {key}
                </label>
              ))}
            </div>
            <Field label="Otros conocimientos"><Textarea value={form.otrosConocimientos} onChange={(e) => setForm({ ...form, otrosConocimientos: e.target.value })} /></Field>
            <Field label="Disponibilidad"><Input type="date" value={form.disponibilidad} onChange={(e) => setForm({ ...form, disponibilidad: e.target.value })} /></Field>
            <div>
              <Label className="mb-2 flex items-center gap-2"><FileSignature className="h-4 w-4" />Firma digital</Label>
              <canvas ref={canvasRef} width={700} height={180} className="h-44 w-full touch-none rounded-xl border-4 border-cyan-400/40 bg-white" onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} onPointerLeave={stopDrawing} />
              <Button className="mt-2" variant="outline" onClick={clearFirma}>Limpiar firma</Button>
            </div>
            <Field label="Observaciones"><Textarea value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} /></Field>
            <div className="hidden"><Input value={form.empresaOculta} onChange={(e) => setForm({ ...form, empresaOculta: e.target.value })} tabIndex={-1} autoComplete="off" /></div>
          </CardContent>
        </Card>

        <div className="sticky bottom-4 rounded-2xl border border-white/10 bg-slate-900/95 p-4 shadow-2xl backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-slate-400">Al enviar autorizas a RRHH a verificar la información suministrada.</p>
            <Button size="lg" onClick={submit} disabled={isLoading} className="bg-cyan-500 text-slate-950 hover:bg-cyan-400">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Enviar solicitud
            </Button>
          </div>
        </div>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}

function OptionSelect({ value, placeholder, options, onChange }: { value: string; placeholder: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>{option}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RepeaterCard({ title, icon, onAdd, children }: { title: string; icon: React.ReactNode; onAdd: () => void; children: React.ReactNode }) {
  return (
    <Card className="border-white/10 bg-slate-900 text-white">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">{icon}{title}</CardTitle>
        <Button variant="outline" onClick={onAdd}>Agregar</Button>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  )
}

function updateArray<T extends keyof SolicitudPublica>(
  form: SolicitudPublica,
  setForm: React.Dispatch<React.SetStateAction<SolicitudPublica>>,
  key: T,
  index: number,
  field: string,
  value: string
) {
  const current = Array.isArray(form[key]) ? [...form[key] as Record<string, string>[]] : []
  current[index] = { ...current[index], [field]: value }
  setForm({ ...form, [key]: current })
}
