"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type React from "react"
import { Eye, FileSignature, FileText, Link as LinkIcon, Loader2, MessageCircle, Pencil, Printer, Save, Search, Trash2, UserPlus, Users, X } from "lucide-react"
import { LinkGeneratorDialog } from "@/components/link-generator-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { SignaturePad } from "@/components/signature-pad"
import { apiJsonp, normalizeApiUrl, useAppStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import type { ClienteCosmiatria } from "@/lib/types"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import { useAutoRefresh } from "@/hooks/use-auto-refresh"

type ConsentKind = "masajes" | "tatuajes"
type ConsentStatus = "Pendiente" | "Firmado" | "Anulado"

interface FichaResumen {
  id: string
  fecha: string
  sucursal: string
  operadora: string
  alergias?: string
  alergiasCuales?: string
  medicamentos?: string
  medicamentosCuales?: string
  embarazada?: string
  observaciones?: string
}

interface ConsentimientoRecord {
  id: string
  /** FK relacional al cliente. Vacío = aún no vinculado. */
  clienteId: string
  /** FK opcional a una ficha dermatológica del mismo cliente. */
  fichaId: string
  fecha: string
  sucursal: string
  nombreCliente: string
  documento: string
  telefono: string
  correo: string
  direccion: string
  fechaNacimiento: string
  edad: string
  tipoMasaje?: string
  zonaTratar: string
  observaciones: string
  contraindicaciones?: string
  alergias?: string
  enfermedadesAntecedentes?: string
  embarazo?: "Sí" | "No" | ""
  // ---- Plantilla profesional CSL para masajes ----
  instrucciones?: string[]
  presionPreferida?: "Suave" | "Media" | "Fuerte" | ""
  contraindicacionesList?: string[]
  observacionesMedicas?: string
  declaracionAceptada?: boolean
  politicasAceptadas?: string[]
  autorizacionAceptada?: boolean
  // Cuando el usuario selecciona "Otro" en los dropdowns, guarda el detalle.
  tipoMasajeOtro?: string
  zonaTratarOtro?: string
  // Embarazo / Alergias como Sí/No con notas. Conservamos `embarazo` y `alergias`
  // por compatibilidad con consentimientos antiguos.
  embarazoNotas?: string
  alergiasSiNo?: "Sí" | "No" | ""
  alergiasNotas?: string
  tipoProcedimiento?: string
  colorPigmento?: string
  tiempoAproximado?: string
  sesionesExplicadas?: string
  riesgosExplicados?: string
  cuidadosAntes?: string
  cuidadosDespues?: string

  // ---- Plantilla profesional CSL para Tatuajes y Cejas ----
  tipoProcedimientoOtro?: string
  tipoPigmento?: string
  tipoPigmentoOtro?: string
  coloresPigmento?: string[]
  coloresPigmentoOtro?: string
  antiguedadPigmento?: string
  tamanoAproximado?: string
  sesionesPreviasSiNo?: "Sí" | "No" | ""
  cantidadSesionesPrevias?: string
  reaccionPreviaLaser?: string
  observacionesPigmento?: string
  embarazoLactanciaSiNo?: "Sí" | "No" | ""
  embarazoLactanciaNotas?: string
  medicamentosSiNo?: "Sí" | "No" | ""
  medicamentosNotas?: string
  exposicionSolarSiNo?: "Sí" | "No" | ""
  exposicionSolarNotas?: string
  queloidesSiNo?: "Sí" | "No" | ""
  queloidesNotas?: string
  instruccionesAntes?: string[]
  cuidadosDespuesList?: string[]
  riesgosAceptadosList?: string[]
  declaracionResultadosAceptada?: boolean
  autorizacionFotograficaAceptada?: boolean
  autorizacionProcedimientoAceptada?: boolean
  textoConsentimiento: string
  firmaCliente: string
  firmaEspecialista: string
  nombreEspecialista: string
  estado: ConsentStatus
  fechaRegistro: string
}

const MASAJE_TEXT =
  "Declaro que he recibido información clara sobre el masaje a realizar, sus beneficios, posibles molestias, contraindicaciones y recomendaciones. Confirmo que he informado mi condición de salud, alergias, antecedentes y cualquier situación relevante. Autorizo a Cibao Spa Laser y al especialista indicado a realizar el procedimiento de masaje descrito en este consentimiento."

const TATUAJE_TEXT =
  "Declaro que he recibido explicación clara sobre el procedimiento láser de eliminación de tatuajes o cejas, sus riesgos, cuidados previos y posteriores, posibles cambios de pigmentación, molestias, necesidad de varias sesiones y resultados variables. Entiendo la información recibida, he podido realizar preguntas y autorizo a Cibao Spa Laser y al especialista indicado a realizar el tratamiento descrito."

// =====================================================
// Plantilla profesional CSL para Consentimiento de Masajes.
// Usada exclusivamente cuando kind === "masajes".
// =====================================================

const INSTRUCCIONES_MASAJES: ReadonlyArray<string> = [
  "Llegar al menos 15 minutos antes de la cita",
  "No comer mínimo 1 hora antes del masaje",
  "No tomar café 3 horas antes del masaje",
  "Tomar agua antes del masaje",
  "Usar ropa cómoda y ligera",
  "Traer ropa íntima si así lo desea",
  "Si es posible, ducharse antes de la cita",
  "Evitar alcohol y drogas antes del masaje",
  "Mantener el celular en silencio para respetar el ambiente tranquilo",
  "Informar molestias, lesiones, condiciones médicas y presión preferida",
  "Indicar zonas a trabajar o evitar",
  "Los masajes con piedras no son aptos para personas con problemas de presión",
]

const CONTRAINDICACIONES_MASAJES: ReadonlyArray<string> = [
  "Embarazo, especialmente si se trata de masajes reductores",
  "Fiebre o malestar general",
  "Enfermedades contagiosas o infecciones en la piel",
  "Piel sensible o lesiones cutáneas como dermatitis, eczema o quemaduras",
  "Fracturas, esguinces o lesiones recientes",
  "Problemas circulatorios como trombosis o varices severas",
  "Uso de medicamentos anticoagulantes",
  "Problemas cardíacos o hipertensión",
  "Cáncer o tratamiento oncológico",
  "Ansiedad severa, PTSD u otras condiciones psicológicas que requieran precaución",
]

const POLITICAS_MASAJES: ReadonlyArray<string> = [
  "Reservas y cancelaciones con 48 horas de antelación",
  "Horario de lunes a viernes de 9:00 a.m. a 8:00 p.m. y sábados de 8:00 a.m. a 4:00 p.m.",
  "Si la cancelación o reprogramación no es comunicada, la sesión se dará por realizada",
  "Los pagos pueden hacerse en efectivo, transferencia o tarjeta",
  "Los precios no incluyen ITBIS",
  "El tiempo de la cita no puede extenderse si afecta el itinerario programado",
  "Si el retraso es responsabilidad del centro, el tiempo será repuesto",
  "Si el retraso es responsabilidad del cliente, se atenderá solo el tiempo restante de la cita",
]

const PRESIONES_MASAJES: ReadonlyArray<"Suave" | "Media" | "Fuerte"> = ["Suave", "Media", "Fuerte"]

const TIPOS_MASAJE: ReadonlyArray<string> = [
  "Relajante",
  "Descontracturante",
  "Reductor",
  "Drenaje linfático",
  "Piedras calientes",
  "Postoperatorio",
  "Deportivo",
  "Terapéutico",
  "Otro",
]

const ZONAS_MASAJE: ReadonlyArray<string> = [
  "Cuerpo completo",
  "Espalda",
  "Cuello y hombros",
  "Piernas",
  "Abdomen",
  "Brazos",
  "Glúteos",
  "Zona lumbar",
  "Zona cervical",
  "Otro",
]

/** Especialista por defecto que se autocompleta al elegir sucursal. Se puede
 *  editar manualmente en el formulario. */
const ESPECIALISTAS_POR_SUCURSAL: Record<string, string> = {
  "Los Jardines": "Benita",
  "Villa Olga": "Dayhana",
}

const DECLARACION_MASAJES: ReadonlyArray<string> = [
  "Comprende que los resultados están relacionados con la respuesta de su organismo y con las técnicas aplicadas.",
  "Consiente aportar datos personales antes y después del tratamiento para fines de diagnóstico, registro e historia clínica, siendo este material propiedad de Cibao Spa Laser.",
  "Acepta que Cibao Spa Laser pueda retrasar o suspender el procedimiento si lo considera necesario.",
  "Se compromete a seguir fielmente las instrucciones impartidas antes, durante y después del procedimiento.",
  "Entiende que el personal se basará en sus declaraciones para determinar si el proceso puede ser seguro y efectivo para su persona.",
]

const AUTORIZACION_MASAJES: ReadonlyArray<string> = [
  "Ha sido informado sobre el procedimiento, sus riesgos, complicaciones y beneficios.",
  "Ha tenido la oportunidad de hacer preguntas y ha recibido respuestas satisfactorias.",
  "Entiende que los resultados pueden variar de una persona a otra.",
  "Da su consentimiento para realizar el procedimiento en Cibao Spa Laser y libera a Cibao Spa Laser y a su personal de responsabilidad legal, penal o civil por complicaciones que puedan surgir durante o después del tratamiento, en la medida permitida por la ley y siempre que se haya actuado conforme a la información suministrada y a las condiciones declaradas por el cliente.",
]

// =====================================================
// Plantilla profesional CSL para Eliminación de Tatuajes y Cejas con láser.
// =====================================================

const TIPOS_PROCEDIMIENTO_TATUAJES: ReadonlyArray<string> = [
  "Eliminación de tatuaje corporal",
  "Eliminación de cejas",
  "Eliminación de microblading",
  "Eliminación de micropigmentación",
  "Eliminación de pigmento cosmético",
  "Retoque de eliminación",
  "Evaluación para eliminación",
  "Otro",
]

const ZONAS_TATUAJES: ReadonlyArray<string> = [
  "Cejas",
  "Rostro",
  "Cuello",
  "Pecho",
  "Espalda",
  "Abdomen",
  "Brazo",
  "Antebrazo",
  "Muñeca",
  "Mano",
  "Dedos",
  "Pierna",
  "Tobillo",
  "Pie",
  "Otra zona",
]

const TIPOS_PIGMENTO: ReadonlyArray<string> = [
  "Tatuaje profesional",
  "Tatuaje amateur",
  "Microblading",
  "Micropigmentación",
  "Pigmento cosmético",
  "Pigmento desconocido",
  "Otro",
]

const COLORES_PIGMENTO: ReadonlyArray<string> = [
  "Negro",
  "Azul",
  "Rojo",
  "Verde",
  "Amarillo",
  "Blanco",
  "Marrón",
  "Gris",
  "Mixto",
  "Otro",
]

const INSTRUCCIONES_TATUAJES: ReadonlyArray<string> = [
  "Evitar exposición al sol al menos 2 semanas antes del procedimiento",
  "No usar autobronceadores en la zona a tratar",
  "No aplicar cremas, lociones, maquillaje o perfumes el día del procedimiento",
  "Informar medicamentos actuales",
  "Informar si usa anticoagulantes",
  "Informar si usa medicamentos fotosensibilizantes",
  "Evitar alcohol 48 horas antes del procedimiento",
  "Evitar antiinflamatorios como aspirina o ibuprofeno 48 horas antes, salvo indicación médica",
  "Mantener la piel hidratada antes del tratamiento",
  "Informar antecedentes de cicatrices queloides",
  "Informar enfermedades de la piel o lesiones activas",
  "Informar embarazo o lactancia",
  "Informar alergias conocidas",
]

const CUIDADOS_DESPUES_TATUAJES: ReadonlyArray<string> = [
  "Mantener la zona limpia y seca",
  "Lavar suavemente con agua fría y jabón suave",
  "No frotar ni rascar la zona tratada",
  "Aplicar la crema o ungüento recomendado por el especialista",
  "No retirar costras",
  "No explotar ampollas",
  "Evitar exposición directa al sol",
  "Usar protector solar SPF 30 o superior cuando la piel esté recuperada",
  "Evitar saunas, jacuzzis, piscinas y agua caliente durante el período indicado",
  "Evitar ejercicio intenso o sudoración excesiva durante los primeros días",
  "No aplicar maquillaje en la zona tratada hasta que sane (especialmente cejas)",
  "Evitar productos con alcohol, ácidos, retinoides o exfoliantes",
  "Contactar al centro o médico si presenta secreción, fiebre, dolor intenso, inflamación excesiva o signos de infección",
  "Asistir a las revisiones indicadas por Cibao Spa Laser",
]

const RIESGOS_TATUAJES: ReadonlyArray<string> = [
  "Enrojecimiento",
  "Hinchazón",
  "Dolor o ardor",
  "Sensibilidad temporal",
  "Formación de costras",
  "Formación de ampollas",
  "Sangrado leve",
  "Irritación",
  "Infección",
  "Cambios de pigmentación",
  "Hiperpigmentación",
  "Hipopigmentación",
  "Cicatrices",
  "Cicatrices queloides en personas predispuestas",
  "Cambios en la textura de la piel",
  "Reacciones alérgicas a productos o anestésicos",
  "Mayor sensibilidad al sol",
  "Eliminación incompleta del pigmento",
  "Necesidad de múltiples sesiones",
  "Resultados no satisfactorios",
  "Oscurecimiento temporal o permanente de algunos pigmentos",
  "Posibilidad de que el pigmento no desaparezca completamente",
]

// Las políticas son las mismas para ambos consentimientos (mismo centro).
const POLITICAS_TATUAJES = POLITICAS_MASAJES

const DECLARACION_RESULTADOS_TATUAJES: ReadonlyArray<string> = [
  "La eliminación de tatuajes, cejas, microblading o micropigmentación con láser no es una ciencia exacta.",
  "Los resultados pueden variar de una persona a otra.",
  "No se garantiza la eliminación total del pigmento.",
  "Pueden requerirse múltiples sesiones.",
  "Algunos colores o pigmentos pueden ser más difíciles de eliminar.",
  "El intervalo entre sesiones puede variar según la evolución de la piel.",
  "El procedimiento busca mejorar la apariencia, pero no garantiza perfección absoluta.",
]

const AUTORIZACION_FOTOGRAFICA_TATUAJES =
  "Autorizo a Cibao Spa Laser a tomar fotografías o registros antes, durante y después del procedimiento, con fines de evaluación, seguimiento, historial clínico interno y control de evolución. Estas imágenes serán manejadas de forma confidencial y no serán cedidas a terceros salvo obligación legal o autorización expresa del cliente."

const AUTORIZACION_FINAL_TATUAJES =
  "He sido informado/a sobre el procedimiento de eliminación de tatuajes, cejas, microblading o micropigmentación con láser, incluyendo sus beneficios, limitaciones, posibles riesgos, complicaciones y cuidados necesarios antes y después del tratamiento. He tenido la oportunidad de realizar preguntas y he recibido respuestas satisfactorias. Entiendo que los resultados pueden variar de una persona a otra, que pueden requerirse múltiples sesiones y que no se garantiza la eliminación completa del pigmento. Doy mi consentimiento libre, voluntario e informado para realizarme el procedimiento en Cibao Spa Laser. También declaro que la información suministrada por mí es verdadera y completa, y entiendo que el personal de Cibao Spa Laser se basará en dicha información para determinar si el procedimiento puede realizarse de forma segura."

const KIND_CONFIG = {
  masajes: {
    title: "Consentimiento Masajes",
    subtitle: "Registro de autorización, firmas y PDF para terapias corporales.",
    badge: "Masajes",
    getAction: "getConsentMasajes",
    saveAction: "saveConsentMasaje",
    deleteAction: "deleteConsentMasaje",
    idPrefix: "CM",
    defaultText: MASAJE_TEXT,
  },
  tatuajes: {
    title: "Consentimiento Eliminación de Tatuajes y Cejas",
    subtitle: "Autorización informada para procedimientos láser de pigmento.",
    badge: "Láser pigmento",
    getAction: "getConsentTatuajesCejas",
    saveAction: "saveConsentTatuajeCeja",
    deleteAction: "deleteConsentTatuajeCeja",
    idPrefix: "CTC",
    defaultText: TATUAJE_TEXT,
  },
} satisfies Record<ConsentKind, Record<string, string>>

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function makeId(prefix: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14)
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

function emptyRecord(kind: ConsentKind, sucursal = ""): ConsentimientoRecord {
  const config = KIND_CONFIG[kind]
  return {
    id: makeId(config.idPrefix),
    clienteId: "",
    fichaId: "",
    fecha: todayIso(),
    sucursal,
    nombreCliente: "",
    documento: "",
    telefono: "",
    correo: "",
    direccion: "",
    fechaNacimiento: "",
    edad: "",
    tipoMasaje: "",
    zonaTratar: "",
    observaciones: "",
    contraindicaciones: "",
    alergias: "",
    enfermedadesAntecedentes: "",
    embarazo: "",
    tipoProcedimiento: "",
    colorPigmento: "",
    tiempoAproximado: "",
    sesionesExplicadas: "",
    riesgosExplicados: "",
    cuidadosAntes: "",
    cuidadosDespues: "",
    textoConsentimiento: config.defaultText,
    firmaCliente: "",
    firmaEspecialista: "",
    nombreEspecialista: "",
    estado: "Pendiente",
    fechaRegistro: new Date().toISOString(),
    // Plantilla profesional masajes — sólo se rellena visualmente cuando kind === "masajes".
    instrucciones: [],
    presionPreferida: "",
    contraindicacionesList: [],
    observacionesMedicas: "",
    declaracionAceptada: false,
    politicasAceptadas: [],
    autorizacionAceptada: false,
    tipoMasajeOtro: "",
    zonaTratarOtro: "",
    embarazoNotas: "",
    alergiasSiNo: "",
    alergiasNotas: "",
    // Tatuajes / cejas
    tipoProcedimientoOtro: "",
    tipoPigmento: "",
    tipoPigmentoOtro: "",
    coloresPigmento: [],
    coloresPigmentoOtro: "",
    antiguedadPigmento: "",
    tamanoAproximado: "",
    sesionesPreviasSiNo: "",
    cantidadSesionesPrevias: "",
    reaccionPreviaLaser: "",
    observacionesPigmento: "",
    embarazoLactanciaSiNo: "",
    embarazoLactanciaNotas: "",
    medicamentosSiNo: "",
    medicamentosNotas: "",
    exposicionSolarSiNo: "",
    exposicionSolarNotas: "",
    queloidesSiNo: "",
    queloidesNotas: "",
    instruccionesAntes: [],
    cuidadosDespuesList: [],
    riesgosAceptadosList: [],
    declaracionResultadosAceptada: false,
    autorizacionFotograficaAceptada: false,
    autorizacionProcedimientoAceptada: false,
  }
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "")
}

function clienteFullName(cliente: ClienteCosmiatria) {
  return `${cliente.Nombre || ""} ${cliente.Apellido || ""}`.trim()
}

/** Nombre presentable de un cliente. Nunca devuelve un ID interno. */
function clienteDisplayName(cliente: ClienteCosmiatria | null | undefined) {
  if (!cliente) return ""
  const full = clienteFullName(cliente)
  if (full) return full
  return "Cliente sin nombre registrado"
}

function formatDate(value?: string) {
  if (!value) return "-"
  const datePart = String(value).slice(0, 10)
  const [year, month, day] = datePart.split("-")
  if (year && month && day) return `${day}/${month}/${year}`
  return value
}

function calcAge(value: string) {
  if (!value) return ""
  const birth = new Date(`${value}T00:00:00`)
  if (Number.isNaN(birth.getTime())) return ""
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const monthDiff = now.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1
  return age > 0 ? String(age) : ""
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

function normalizeRecord(input: Partial<ConsentimientoRecord>, kind: ConsentKind): ConsentimientoRecord {
  const base = emptyRecord(kind)
  return {
    ...base,
    ...input,
    id: String(input.id || input["ID" as keyof ConsentimientoRecord] || base.id),
    clienteId: String(input.clienteId || ""),
    fichaId: String(input.fichaId || ""),
    fecha: String(input.fecha || base.fecha).slice(0, 10),
    estado: (input.estado || "Pendiente") as ConsentStatus,
    textoConsentimiento: input.textoConsentimiento || base.textoConsentimiento,
    fechaRegistro: input.fechaRegistro || base.fechaRegistro,
    // Re-coerce los campos de la plantilla masajes (vienen serializados desde payload_json).
    instrucciones: asStringArray(input.instrucciones),
    presionPreferida: ((input.presionPreferida as string) || "") as ConsentimientoRecord["presionPreferida"],
    contraindicacionesList: asStringArray(input.contraindicacionesList),
    observacionesMedicas: String(input.observacionesMedicas ?? ""),
    declaracionAceptada: Boolean(input.declaracionAceptada),
    politicasAceptadas: asStringArray(input.politicasAceptadas),
    autorizacionAceptada: Boolean(input.autorizacionAceptada),
    tipoMasajeOtro: String(input.tipoMasajeOtro ?? ""),
    zonaTratarOtro: String(input.zonaTratarOtro ?? ""),
    embarazoNotas: String(input.embarazoNotas ?? ""),
    alergiasSiNo: ((input.alergiasSiNo as string) || "") as ConsentimientoRecord["alergiasSiNo"],
    alergiasNotas: String(input.alergiasNotas ?? input.alergias ?? ""),
    // Tatuajes / cejas
    tipoProcedimientoOtro: String(input.tipoProcedimientoOtro ?? ""),
    tipoPigmento: String(input.tipoPigmento ?? ""),
    tipoPigmentoOtro: String(input.tipoPigmentoOtro ?? ""),
    coloresPigmento: asStringArray(input.coloresPigmento),
    coloresPigmentoOtro: String(input.coloresPigmentoOtro ?? ""),
    antiguedadPigmento: String(input.antiguedadPigmento ?? ""),
    tamanoAproximado: String(input.tamanoAproximado ?? ""),
    sesionesPreviasSiNo: ((input.sesionesPreviasSiNo as string) || "") as ConsentimientoRecord["sesionesPreviasSiNo"],
    cantidadSesionesPrevias: String(input.cantidadSesionesPrevias ?? ""),
    reaccionPreviaLaser: String(input.reaccionPreviaLaser ?? ""),
    observacionesPigmento: String(input.observacionesPigmento ?? ""),
    embarazoLactanciaSiNo: ((input.embarazoLactanciaSiNo as string) || "") as ConsentimientoRecord["embarazoLactanciaSiNo"],
    embarazoLactanciaNotas: String(input.embarazoLactanciaNotas ?? ""),
    medicamentosSiNo: ((input.medicamentosSiNo as string) || "") as ConsentimientoRecord["medicamentosSiNo"],
    medicamentosNotas: String(input.medicamentosNotas ?? ""),
    exposicionSolarSiNo: ((input.exposicionSolarSiNo as string) || "") as ConsentimientoRecord["exposicionSolarSiNo"],
    exposicionSolarNotas: String(input.exposicionSolarNotas ?? ""),
    queloidesSiNo: ((input.queloidesSiNo as string) || "") as ConsentimientoRecord["queloidesSiNo"],
    queloidesNotas: String(input.queloidesNotas ?? ""),
    instruccionesAntes: asStringArray(input.instruccionesAntes),
    cuidadosDespuesList: asStringArray(input.cuidadosDespuesList),
    riesgosAceptadosList: asStringArray(input.riesgosAceptadosList),
    declaracionResultadosAceptada: Boolean(input.declaracionResultadosAceptada),
    autorizacionFotograficaAceptada: Boolean(input.autorizacionFotograficaAceptada),
    autorizacionProcedimientoAceptada: Boolean(input.autorizacionProcedimientoAceptada),
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function signatureBlock(label: string, dataUrl: string, name: string) {
  return `
    <div class="signature">
      <div class="sig-title">${escapeHtml(label)}</div>
      ${dataUrl ? `<img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(label)}" />` : `<div class="sig-empty"></div>`}
      <div class="sig-line"></div>
      <div class="sig-name">${escapeHtml(name || label)}</div>
    </div>
  `
}

function masajesDisplay(record: ConsentimientoRecord) {
  const tipo = record.tipoMasaje === "Otro" && record.tipoMasajeOtro ? `Otro · ${record.tipoMasajeOtro}` : (record.tipoMasaje || "")
  const zona = record.zonaTratar === "Otro" && record.zonaTratarOtro ? `Otro · ${record.zonaTratarOtro}` : (record.zonaTratar || "")
  const embarazo = record.embarazo === "Sí" && record.embarazoNotas ? `Sí · ${record.embarazoNotas}` : (record.embarazo || "")
  const alergias =
    record.alergiasSiNo === "Sí" && (record.alergiasNotas || record.alergias)
      ? `Sí · ${record.alergiasNotas || record.alergias}`
      : (record.alergiasSiNo || (record.alergias ? `Sí · ${record.alergias}` : ""))
  return { tipo, zona, embarazo, alergias }
}

function tatuajesDisplay(record: ConsentimientoRecord) {
  const tipo = record.tipoProcedimiento === "Otro" && record.tipoProcedimientoOtro ? `Otro · ${record.tipoProcedimientoOtro}` : (record.tipoProcedimiento || "")
  const zona = record.zonaTratar === "Otra zona" && record.zonaTratarOtro ? `Otra · ${record.zonaTratarOtro}` : (record.zonaTratar || "")
  const tipoPigmento = record.tipoPigmento === "Otro" && record.tipoPigmentoOtro ? `Otro · ${record.tipoPigmentoOtro}` : (record.tipoPigmento || "")
  const colores = (() => {
    const list = record.coloresPigmento || []
    if (!list.length) return ""
    const items = list.map((c) => (c === "Otro" && record.coloresPigmentoOtro ? `Otro (${record.coloresPigmentoOtro})` : c))
    return items.join(", ")
  })()
  const embarazo = record.embarazoLactanciaSiNo === "Sí" && record.embarazoLactanciaNotas
    ? `Sí · ${record.embarazoLactanciaNotas}`
    : (record.embarazoLactanciaSiNo || "")
  const alergias =
    record.alergiasSiNo === "Sí" && (record.alergiasNotas || record.alergias)
      ? `Sí · ${record.alergiasNotas || record.alergias}`
      : (record.alergiasSiNo || (record.alergias ? `Sí · ${record.alergias}` : ""))
  const medicamentos = record.medicamentosSiNo === "Sí" && record.medicamentosNotas
    ? `Sí · ${record.medicamentosNotas}`
    : (record.medicamentosSiNo || "")
  const exposicion = record.exposicionSolarSiNo === "Sí" && record.exposicionSolarNotas
    ? `Sí · ${record.exposicionSolarNotas}`
    : (record.exposicionSolarSiNo || "")
  const queloides = record.queloidesSiNo === "Sí" && record.queloidesNotas
    ? `Sí · ${record.queloidesNotas}`
    : (record.queloidesSiNo || "")
  const sesionesPrev = record.sesionesPreviasSiNo === "Sí" && record.cantidadSesionesPrevias
    ? `Sí · ${record.cantidadSesionesPrevias}`
    : (record.sesionesPreviasSiNo || "")
  return { tipo, zona, tipoPigmento, colores, embarazo, alergias, medicamentos, exposicion, queloides, sesionesPrev }
}

function printConsent(record: ConsentimientoRecord, kind: ConsentKind) {
  const config = KIND_CONFIG[kind]
  const display = kind === "masajes" ? masajesDisplay(record) : null
  const tDisplay = kind === "tatuajes" ? tatuajesDisplay(record) : null
  const fields =
    kind === "masajes" && display
      ? [
          ["Tipo de masaje", display.tipo],
          ["Zona a tratar", display.zona],
          ["Presión preferida", record.presionPreferida],
          ["Embarazo", display.embarazo],
          ["Alergias", display.alergias],
        ]
      : kind === "tatuajes" && tDisplay
      ? [
          ["Procedimiento", tDisplay.tipo],
          ["Zona a tratar", tDisplay.zona],
          ["Tipo de pigmento", tDisplay.tipoPigmento],
          ["Colores del pigmento", tDisplay.colores],
          ["Antigüedad aproximada", record.antiguedadPigmento],
          ["Tamaño aproximado", record.tamanoAproximado],
          ["Sesiones previas", tDisplay.sesionesPrev],
          ["Reacción previa al láser", record.reaccionPreviaLaser],
          ["Embarazo / Lactancia", tDisplay.embarazo],
          ["Alergias", tDisplay.alergias],
          ["Medicamentos", tDisplay.medicamentos],
          ["Exposición solar reciente", tDisplay.exposicion],
          ["Antecedentes de queloides", tDisplay.queloides],
        ]
      : []

  const detailRows = fields
    .map(([label, value]) => `<div class="field"><b>${escapeHtml(label)}:</b><span>${escapeHtml(value || "-")}</span></div>`)
    .join("")

  const checkList = (items: string[] | undefined, total: ReadonlyArray<string>) => {
    const set = new Set(items || [])
    return total
      .map((opt) => `<li class="${set.has(opt) ? "ck-on" : "ck-off"}"><span class="mark">${set.has(opt) ? "☑" : "☐"}</span><span>${escapeHtml(opt)}</span></li>`)
      .join("")
  }
  const masajesExtraSections =
    kind === "masajes"
      ? `
      <div class="section">
        <div class="section-title">Instrucciones antes del procedimiento</div>
        <ul class="checklist">${checkList(record.instrucciones, INSTRUCCIONES_MASAJES)}</ul>
      </div>
      <div class="section">
        <div class="section-title">Contraindicaciones / precaución</div>
        <ul class="checklist">${checkList(record.contraindicacionesList, CONTRAINDICACIONES_MASAJES)}</ul>
        ${record.observacionesMedicas ? `<div class="text"><b>Observaciones médicas:</b> ${escapeHtml(record.observacionesMedicas)}</div>` : ""}
      </div>
      <div class="section">
        <div class="section-title">Declaración del cliente</div>
        <ul class="bullet">${DECLARACION_MASAJES.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
        <div class="accept ${record.declaracionAceptada ? "ok" : "no"}">${record.declaracionAceptada ? "✔ El cliente acepta la declaración." : "○ Pendiente de aceptación"}</div>
      </div>
      <div class="section">
        <div class="section-title">Políticas y procedimientos</div>
        <ul class="checklist">${checkList(record.politicasAceptadas, POLITICAS_MASAJES)}</ul>
      </div>
      <div class="section">
        <div class="section-title">Autorización final</div>
        <ul class="bullet">${AUTORIZACION_MASAJES.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
        <div class="accept ${record.autorizacionAceptada ? "ok" : "no"}">${record.autorizacionAceptada ? "✔ El cliente autoriza el procedimiento." : "○ Pendiente de autorización"}</div>
      </div>`
      : ""

  const tatuajesExtraSections =
    kind === "tatuajes"
      ? `
      <div class="section">
        <div class="section-title">Instrucciones antes del procedimiento</div>
        <ul class="checklist">${checkList(record.instruccionesAntes, INSTRUCCIONES_TATUAJES)}</ul>
        ${record.observacionesPigmento ? `<div class="text"><b>Observaciones del pigmento:</b> ${escapeHtml(record.observacionesPigmento)}</div>` : ""}
      </div>
      <div class="section">
        <div class="section-title">Cuidados después del tratamiento</div>
        <ul class="checklist">${checkList(record.cuidadosDespuesList, CUIDADOS_DESPUES_TATUAJES)}</ul>
      </div>
      <div class="section">
        <div class="section-title">Riesgos y posibles complicaciones</div>
        <ul class="checklist">${checkList(record.riesgosAceptadosList, RIESGOS_TATUAJES)}</ul>
      </div>
      <div class="section">
        <div class="section-title">Declaración sobre resultados</div>
        <ul class="bullet">${DECLARACION_RESULTADOS_TATUAJES.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
        <div class="accept ${record.declaracionResultadosAceptada ? "ok" : "no"}">${record.declaracionResultadosAceptada ? "✔ El cliente acepta la declaración sobre resultados." : "○ Pendiente de aceptación"}</div>
      </div>
      <div class="section">
        <div class="section-title">Autorización para registro fotográfico</div>
        <div class="text">${escapeHtml(AUTORIZACION_FOTOGRAFICA_TATUAJES)}</div>
        <div class="accept ${record.autorizacionFotograficaAceptada ? "ok" : "no"}">${record.autorizacionFotograficaAceptada ? "✔ Autorizada" : "○ No autorizada / pendiente"}</div>
      </div>
      <div class="section">
        <div class="section-title">Políticas y procedimientos</div>
        <ul class="checklist">${checkList(record.politicasAceptadas, POLITICAS_TATUAJES)}</ul>
      </div>
      <div class="section">
        <div class="section-title">Autorización final</div>
        <div class="text">${escapeHtml(AUTORIZACION_FINAL_TATUAJES)}</div>
        <div class="accept ${record.autorizacionProcedimientoAceptada ? "ok" : "no"}">${record.autorizacionProcedimientoAceptada ? "✔ El cliente autoriza el procedimiento." : "○ Pendiente de autorización"}</div>
      </div>`
      : ""

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(config.title)} - ${escapeHtml(record.nombreCliente)}</title>
      <style>
        @page { size: A4; margin: 14mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 12px; }
        .header { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid #008d81; padding-bottom: 12px; margin-bottom: 14px; }
        .logo { width: 118px; height: 64px; object-fit: contain; }
        h1 { margin: 0; color: #007f78; font-size: 20px; letter-spacing: .02em; text-transform: uppercase; }
        .sub { margin-top: 4px; color: #475569; font-weight: 700; }
        .meta { margin-left: auto; text-align: right; color: #334155; font-size: 11px; }
        .section { margin-top: 12px; border: 1px solid #d7dee8; border-radius: 10px; overflow: hidden; break-inside: avoid; }
        .section-title { background: #008d81; color: white; padding: 7px 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
        .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; }
        .field { min-height: 29px; border-bottom: 1px dotted #aab6c5; padding: 7px 10px; display: flex; gap: 8px; }
        .field b { min-width: 145px; color: #0f172a; }
        .field span { flex: 1; }
        .full { grid-column: 1 / -1; }
        .text { padding: 11px 12px; line-height: 1.6; text-align: justify; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 18px 14px 10px; }
        .signature { text-align: center; min-height: 150px; }
        .sig-title { font-weight: 800; color: #0f172a; margin-bottom: 8px; }
        .signature img { width: 260px; height: 88px; object-fit: contain; border: 1px solid #d7dee8; background: white; }
        .sig-empty { height: 88px; }
        .sig-line { border-top: 1px solid #111827; margin: 10px 24px 4px; }
        .sig-name { font-weight: 700; color: #334155; }
        .footer { margin-top: 16px; color: #64748b; font-size: 10px; text-align: center; }
        .checklist, .bullet { margin: 0; padding: 8px 14px 8px 22px; list-style: none; }
        .checklist li { padding: 3px 0; display: flex; align-items: flex-start; gap: 8px; line-height: 1.45; break-inside: avoid; }
        .checklist .mark { display: inline-block; width: 14px; color: #0f172a; font-weight: 800; }
        .checklist .ck-on { color: #0f172a; }
        .checklist .ck-off { color: #94a3b8; }
        .bullet { list-style: disc outside; padding-left: 28px; line-height: 1.55; }
        .bullet li { margin: 4px 0; break-inside: avoid; }
        .accept { padding: 8px 14px; font-weight: 700; font-size: 11px; }
        .accept.ok { color: #047857; background: #ecfdf5; }
        .accept.no { color: #b45309; background: #fffbeb; }
        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
      </style>
    </head>
    <body>
      <div class="header">
        <img class="logo" src="${window.location.origin}/cibao-spa-laser-logo.jpeg" alt="Cibao Spa Laser" />
        <div>
          <h1>${escapeHtml(config.title)}</h1>
          <div class="sub">Cibao Spa Laser · Consentimiento informado</div>
        </div>
        <div class="meta">
          <b>ID:</b> ${escapeHtml(record.id)}<br/>
          <b>Fecha:</b> ${formatDate(record.fecha)}<br/>
          <b>Sucursal:</b> ${escapeHtml(record.sucursal || "-")}
        </div>
      </div>
      <div class="section">
        <div class="section-title">Datos del cliente</div>
        <div class="grid">
          <div class="field"><b>Nombre:</b><span>${escapeHtml(record.nombreCliente)}</span></div>
          <div class="field"><b>Cédula / Documento:</b><span>${escapeHtml(record.documento || "-")}</span></div>
          <div class="field"><b>Teléfono:</b><span>${escapeHtml(record.telefono || "-")}</span></div>
          <div class="field"><b>Correo:</b><span>${escapeHtml(record.correo || "-")}</span></div>
          <div class="field"><b>Fecha nacimiento:</b><span>${formatDate(record.fechaNacimiento)}</span></div>
          <div class="field"><b>Edad:</b><span>${escapeHtml(record.edad || "-")}</span></div>
          <div class="field full"><b>Dirección:</b><span>${escapeHtml(record.direccion || "-")}</span></div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Datos del procedimiento</div>
        <div class="grid">${detailRows}<div class="field full"><b>Especialista:</b><span>${escapeHtml(record.nombreEspecialista || "-")}</span></div><div class="field full"><b>Observaciones:</b><span>${escapeHtml(record.observaciones || "-")}</span></div></div>
      </div>
      ${masajesExtraSections}
      ${tatuajesExtraSections}
      <div class="section">
        <div class="section-title">Firmas</div>
        <div class="signatures">
          ${signatureBlock("Firma del cliente", record.firmaCliente, record.nombreCliente)}
          ${signatureBlock("Firma del especialista", record.firmaEspecialista, record.nombreEspecialista)}
        </div>
      </div>
      <div class="footer">Documento generado por Sistema Integral CSL · ${new Date().toLocaleString("es-DO")}</div>
      <script>setTimeout(() => window.print(), 450)</script>
    </body>
  </html>`

  const popup = window.open("", "_blank", "width=1000,height=900")
  if (!popup) return
  popup.document.write(html)
  popup.document.close()
}

export function ConsentimientosPage({ kind }: { kind: ConsentKind }) {
  const config = KIND_CONFIG[kind]
  const { apiUrl, db, showToast, setIsLoading, setLoadingMessage, incrementFormOpen, decrementFormOpen } = useAppStore()
  const sucursales = useMemo(() => db.sucursales.filter((s) => s.Estado !== "Inactiva").map((s) => s.Nombre).filter(Boolean), [db.sucursales])
  const [records, setRecords] = useState<ConsentimientoRecord[]>([])
  const [clientes, setClientes] = useState<ClienteCosmiatria[]>([])
  const [query, setQuery] = useState("")
  const [filterSucursal, setFilterSucursal] = useState("todas")
  const [filterFecha, setFilterFecha] = useState("")
  const [formOpen, setFormOpen] = useState(false)
  const [detail, setDetail] = useState<ConsentimientoRecord | null>(null)
  // Para masajes: inicia siempre vacío. Para tatuajes/cejas: hereda la primera sucursal activa
  // (comportamiento histórico que se mantiene para no romper otra plantilla).
  const initialSucursal = ""
  const [form, setForm] = useState<ConsentimientoRecord>(() => emptyRecord(kind, initialSucursal))
  const [fichasCliente, setFichasCliente] = useState<FichaResumen[]>([])
  // Mensaje de validación visible dentro del dialog (no sólo toast).
  const [saveError, setSaveError] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  // Dialog para generar link único de envío al cliente vía WhatsApp.
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const publicFormType = kind === "masajes" ? "consentimiento_masajes" : "consentimiento_tatuajes_cejas"
  const publicFormTitle = kind === "masajes"
    ? "Enviar Consentimiento de Masajes a un cliente"
    : "Enviar Consentimiento de Tatuajes/Cejas a un cliente"

  const loadRecords = useCallback(async () => {
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: config.getAction })
      const items = Array.isArray(result.records) ? result.records : []
      setRecords(items.map((item) => normalizeRecord(item as Partial<ConsentimientoRecord>, kind)))
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al cargar consentimientos", "error")
    }
  }, [apiUrl, config.getAction, kind, showToast])

  const loadClientes = useCallback(async () => {
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getClientesCosmiatria" })
      const items = Array.isArray(result.records) ? (result.records as Record<string, unknown>[]) : []
      setClientes(items.map((raw) => ({
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
        Edad: Number(raw.Edad ?? raw.edad ?? 0) || 0,
        Genero: String(raw.Genero ?? raw.genero ?? ""),
        Sucursal: String(raw.Sucursal ?? raw.sucursal ?? ""),
        PuedeAgendar: raw.PuedeAgendar !== false,
        ClienteDesde: String(raw.ClienteDesde ?? raw.cliente_desde ?? ""),
        Estado: ((raw.Estado ?? raw.estado ?? "Activo") as ClienteCosmiatria["Estado"]),
        Notas: String(raw.Notas ?? raw.notas ?? ""),
      })))
    } catch (error) {
      // No bloquear la UI: el formulario sigue siendo usable manualmente.
      console.warn("No se pudo cargar clientes para vincular consentimientos", error)
    }
  }, [apiUrl])

  useEffect(() => {
    void loadRecords()
    void loadClientes()
  }, [loadRecords, loadClientes])

  // Auto-refresh del listado cada 60s. Se pausa si el dialog del formulario
  // está abierto para no interferir con la captura del usuario.
  useAutoRefresh(loadRecords, {
    intervalMs: 60_000,
    skipWhen: () => formOpen,
  })

  // Tracking del dialog: incrementa el contador global de formularios abiertos
  // para que el auto-refresh global del sistema NO se dispare mientras hay
  // captura activa en este módulo.
  useEffect(() => {
    if (formOpen) {
      incrementFormOpen()
      return () => decrementFormOpen()
    }
  }, [formOpen, incrementFormOpen, decrementFormOpen])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return records
      .filter((record) => {
        const matchesQuery =
          !needle ||
          [record.nombreCliente, record.documento, record.telefono, record.correo, record.id]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        const matchesSucursal = filterSucursal === "todas" || record.sucursal === filterSucursal
        const matchesFecha = !filterFecha || record.fecha === filterFecha
        return matchesQuery && matchesSucursal && matchesFecha
      })
      .sort((a, b) => `${b.fecha}${b.fechaRegistro}`.localeCompare(`${a.fecha}${a.fechaRegistro}`))
  }, [filterFecha, filterSucursal, query, records])

  const signed = records.filter((record) => record.estado === "Firmado").length
  const pending = records.filter((record) => record.estado === "Pendiente").length

  const update = (patch: Partial<ConsentimientoRecord>) => {
    setSaveError("") // cualquier edición despeja el banner de error
    setForm((current) => ({ ...current, ...patch }))
  }

  /** Carga el historial de un cliente (fichas + consentimientos). Sólo
   *  guardamos las fichas resumidas: las usamos para "vincular ficha". */
  const loadHistorialCliente = useCallback(async (clienteId: string) => {
    if (!clienteId) {
      setFichasCliente([])
      return
    }
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "getClienteHistorial",
        clienteId,
      }) as { ok?: boolean; fichas?: Record<string, unknown>[] }
      if (!result?.ok) return
      const fichas = Array.isArray(result.fichas) ? result.fichas : []
      setFichasCliente(fichas.map((row): FichaResumen => ({
        id: String(row.id ?? row.FichaID ?? ""),
        fecha: String(row.fecha ?? ""),
        sucursal: String(row.sucursal ?? ""),
        operadora: String(row.operadora ?? ""),
        alergias: row.alergias as string | undefined,
        alergiasCuales: row.alergiasCuales as string | undefined,
        medicamentos: row.medicamentos as string | undefined,
        medicamentosCuales: row.medicamentosCuales as string | undefined,
        embarazada: row.embarazada as string | undefined,
        observaciones: row.observaciones as string | undefined,
      })))
    } catch (error) {
      console.warn("No se pudo cargar historial del cliente", error)
    }
  }, [apiUrl])

  /** Aplicar datos de un cliente al formulario (autocompletado).
   *
   *  Sucursal: solo se llena si la del formulario está vacía, así nunca
   *  pisa una elección manual del usuario.
   */
  const pickCliente = (cliente: ClienteCosmiatria) => {
    const fullName = clienteFullName(cliente)
    setForm((current) => {
      const nextSucursal = current.sucursal || cliente.Sucursal || ""
      return {
        ...current,
        clienteId: cliente.ClienteID,
        // Vínculo a ficha se limpia: se vuelve a elegir explícitamente.
        fichaId: "",
        nombreCliente: fullName || current.nombreCliente,
        documento: cliente.DocumentoIdentidad || current.documento,
        telefono: cliente.Telefono || current.telefono,
        correo: cliente.Email || current.correo,
        direccion: cliente.Direccion || current.direccion,
        fechaNacimiento: cliente.FechaNacimiento || current.fechaNacimiento,
        edad: cliente.Edad ? String(cliente.Edad) : current.edad,
        sucursal: nextSucursal,
        // Si llenamos sucursal aquí, autocompletamos el especialista por defecto
        // sólo si el formulario no lo tenía ya escrito.
        nombreEspecialista:
          current.nombreEspecialista ||
          (nextSucursal && ESPECIALISTAS_POR_SUCURSAL[nextSucursal]) ||
          "",
      }
    })
    void loadHistorialCliente(cliente.ClienteID)
  }

  /** Vincular una ficha dermatológica del cliente y traer datos de salud. */
  const linkFicha = (ficha: FichaResumen) => {
    const alergias = [ficha.alergias, ficha.alergiasCuales].filter(Boolean).join(" — ")
    const enfermedades = [ficha.medicamentos, ficha.medicamentosCuales]
      .filter(Boolean)
      .map((value) => `Medicamentos: ${value}`)
      .join(" / ")
    const embarazo = ficha.embarazada === "Si" || ficha.embarazada === "Sí"
      ? "Sí"
      : ficha.embarazada === "No"
        ? "No"
        : ""
    setForm((current) => ({
      ...current,
      fichaId: ficha.id,
      alergias: alergias || current.alergias,
      enfermedadesAntecedentes: enfermedades || current.enfermedadesAntecedentes,
      embarazo: (embarazo as "Sí" | "No" | "") || current.embarazo,
    }))
    showToast(`Vinculado a ficha del ${formatDate(ficha.fecha)}`, "success")
  }

  /** Limpiar el cliente vinculado (volver a captura manual). */
  const clearCliente = () => {
    setFichasCliente([])
    setForm((current) => ({ ...current, clienteId: "", fichaId: "" }))
  }

  const startCreate = () => {
    setSaveError("")
    setFichasCliente([])
    setForm(emptyRecord(kind, ""))
    setFormOpen(true)
  }

  const startEdit = (record: ConsentimientoRecord) => {
    setSaveError("")
    const normalized = normalizeRecord(record, kind)
    setForm(normalized)
    setFormOpen(true)
    if (normalized.clienteId) void loadHistorialCliente(normalized.clienteId)
    else setFichasCliente([])
  }

  const handleSave = async () => {
    if (isSaving) return // anti-doble-click
    setSaveError("")

    // Resolver el nombre efectivo del cliente: si la UI tiene un cliente
    // vinculado pero `nombreCliente` viene vacío (caso de datos legacy),
    // usamos el nombre de la tabla Clientes en su lugar.
    const linked = form.clienteId ? clientes.find((c) => c.ClienteID === form.clienteId) : null
    const effectiveNombre = (form.nombreCliente || "").trim() || (linked ? clienteFullName(linked) : "")

    // ---- Validaciones (mensaje visible) ----
    if (!effectiveNombre) {
      const msg = "Falta el nombre del cliente. Selecciona uno desde la búsqueda o captúralo en 'Datos del cliente'."
      setSaveError(msg)
      showToast(msg, "error")
      return
    }
    if (!form.sucursal.trim()) {
      const msg = "Falta seleccionar la sucursal."
      setSaveError(msg)
      showToast(msg, "error")
      return
    }
    if (!form.documento.trim() && !form.telefono.trim() && !form.clienteId) {
      const msg = "Captura cédula o teléfono del cliente, o selecciona un cliente existente."
      setSaveError(msg)
      showToast(msg, "error")
      return
    }
    // Validaciones específicas de Tatuajes/Cejas: aceptaciones obligatorias.
    if (kind === "tatuajes") {
      if (!form.declaracionResultadosAceptada) {
        const msg = "El cliente debe aceptar la declaración sobre resultados."
        setSaveError(msg); showToast(msg, "error"); return
      }
      if (!form.autorizacionProcedimientoAceptada) {
        const msg = "El cliente debe autorizar el procedimiento (autorización final)."
        setSaveError(msg); showToast(msg, "error"); return
      }
      // Las políticas son obligatorias: se exige al menos una marcada
      // (en la práctica todas, pero validamos lo mínimo).
      if (!form.politicasAceptadas || form.politicasAceptadas.length === 0) {
        const msg = "El cliente debe aceptar las políticas del centro."
        setSaveError(msg); showToast(msg, "error"); return
      }
    }

    setIsSaving(true)
    setIsLoading(true)
    setLoadingMessage("Guardando consentimiento...")
    try {
      const payload = {
        ...form,
        // Aseguramos que el nombre que viaja al backend NUNCA esté vacío
        // cuando hay un cliente vinculado con nombre real.
        nombreCliente: effectiveNombre,
        estado: form.firmaCliente ? "Firmado" : form.estado,
        fechaRegistro: form.fechaRegistro || new Date().toISOString(),
      }
      const result = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: config.saveAction,
        data: JSON.stringify(payload),
      })
      if (!result || (result as { ok?: boolean }).ok === false) {
        throw new Error(String((result as { error?: string })?.error || "El servidor rechazó el guardado"))
      }

      const saved = normalizeRecord((result.record as Partial<ConsentimientoRecord>) || payload, kind)
      setRecords((current) => [saved, ...current.filter((record) => record.id !== saved.id)])

      // ---- Limpieza post-guardado exitoso ----
      setForm(emptyRecord(kind, ""))
      setFichasCliente([])
      setFormOpen(false)

      // Refrescar lista de clientes (el backend pudo haber creado uno nuevo).
      void loadClientes()

      // Notificar resultado del email si el backend lo incluyó.
      const emailInfo = (result as { email?: { sent?: boolean; warning?: string } | undefined }).email
      const linkedAfter = saved.clienteId
      const baseMsg = linkedAfter ? "Consentimiento guardado y vinculado al cliente" : "Consentimiento guardado"
      if (emailInfo && emailInfo.sent === false && emailInfo.warning) {
        showToast(`${baseMsg}, pero no se pudo enviar el correo: ${emailInfo.warning}`, "info")
      } else if (emailInfo && emailInfo.sent) {
        showToast(`${baseMsg} y notificación enviada`, "success")
      } else {
        showToast(baseMsg, "success")
      }
    } catch (error) {
      // En error: mantenemos el formulario y mostramos el mensaje real.
      const msg = error instanceof Error ? error.message : "Error al guardar"
      setSaveError(msg)
      showToast(msg, "error")
    } finally {
      setIsSaving(false)
      setIsLoading(false)
    }
  }

  const handleDelete = async (record: ConsentimientoRecord) => {
    if (!confirm(`Eliminar el consentimiento ${record.id}?`)) return
    setIsLoading(true)
    setLoadingMessage("Eliminando consentimiento...")
    try {
      await apiJsonp(normalizeApiUrl(apiUrl), { action: config.deleteAction, id: record.id })
      setRecords((current) => current.filter((item) => item.id !== record.id))
      showToast("Consentimiento eliminado", "success")
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al eliminar", "error")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="csl-section-card">
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <span className="csl-kpi-icon">
                  <FileSignature className="h-5 w-5" />
                </span>
                <span className="csl-pill">{config.badge}</span>
              </div>
              <h2 className="font-heading text-2xl font-black tracking-tight text-[color:var(--brand-primary-dark)] sm:text-3xl">{config.title}</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">{config.subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setLinkDialogOpen(true)} className="gap-2 rounded-full">
                <MessageCircle className="h-4 w-4" /> Generar link para cliente
              </Button>
              <Button variant="outline" onClick={loadRecords} className="rounded-full">Actualizar</Button>
              <Button onClick={startCreate} className="gap-2 rounded-full"><FileSignature className="h-4 w-4" /> Nuevo consentimiento</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <ConsentKpi label="Registros" value={records.length} />
        <ConsentKpi label="Firmados" value={signed} tone="success" />
        <ConsentKpi label="Pendientes" value={pending} tone="warning" />
        <ConsentKpi label="Sucursales" value={new Set(records.map((r) => r.sucursal).filter(Boolean)).size} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros y búsqueda</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1fr_240px_200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por cliente, documento, teléfono, correo o ID..." className="pl-10" />
          </div>
          <Select value={filterSucursal} onValueChange={setFilterSucursal}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las sucursales</SelectItem>
              {sucursales.map((sucursal) => <SelectItem key={sucursal} value={sucursal}>{sucursal}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={filterFecha} onChange={(event) => setFilterFecha(event.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consentimientos guardados</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length ? filtered.map((record, seqIndex) => {
                  // El nombre que mostramos es siempre el del cliente real
                  // (tabla Clientes) cuando existe el vínculo. Caemos a
                  // record.nombreCliente sólo si el cliente no se encontró
                  // en el listado cargado.
                  const linked = record.clienteId ? clientes.find((c) => c.ClienteID === record.clienteId) : null
                  const displayName = (linked && clienteFullName(linked)) || record.nombreCliente || "—"
                  return (
                  <TableRow
                    key={record.id}
                    className="cursor-pointer"
                    onClick={() => setDetail(record)}
                  >
                    <TableCell className="text-center"><SeqBadge n={seqIndex + 1} /></TableCell>
                    <TableCell className="font-semibold">{formatDate(record.fecha)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{displayName}</span>
                        {record.clienteId ? (
                          <Badge variant="outline" className="border-emerald-300/40 bg-emerald-500/10 text-[10px] text-emerald-700">
                            <LinkIcon className="mr-1 h-3 w-3" />
                            Cliente vinculado
                          </Badge>
                        ) : null}
                        {record.fichaId ? (
                          <Badge variant="outline" className="border-cyan-300/40 bg-cyan-500/10 text-[10px] text-cyan-700">
                            <FileText className="mr-1 h-3 w-3" />
                            Ficha
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">{record.documento || record.id}</div>
                    </TableCell>
                    <TableCell>{record.sucursal || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{record.telefono || "-"}</TableCell>
                    <TableCell><StatusBadge status={record.estado} /></TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setDetail(record)} title="Ver"><Eye className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => printConsent(record, kind)} title="Imprimir PDF"><Printer className="h-4 w-4 text-primary" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => startEdit(record)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => void handleDelete(record)} title="Eliminar"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  )
                }) : (
                  <TableRow><TableCell colSpan={7} className="py-12 text-center text-muted-foreground">No hay consentimientos para mostrar.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ConsentFormDialog
        kind={kind}
        open={formOpen}
        form={form}
        sucursales={sucursales}
        clientes={clientes}
        fichasCliente={fichasCliente}
        saveError={saveError}
        isSaving={isSaving}
        onOpenChange={(value) => { if (!value) setSaveError(""); setFormOpen(value) }}
        onUpdate={update}
        onSave={handleSave}
        onPickCliente={pickCliente}
        onClearCliente={clearCliente}
        onLinkFicha={linkFicha}
      />

      <DetailDialog record={detail} kind={kind} clientes={clientes} onClose={() => setDetail(null)} onPrint={(record) => printConsent(record, kind)} onEdit={(record) => { setDetail(null); startEdit(record) }} />

      <LinkGeneratorDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        formType={publicFormType}
        title={publicFormTitle}
      />
    </div>
  )
}

function ConsentKpi({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "warning" }) {
  return (
    <Card className={cn(
      "csl-section-card",
      tone === "success" && "border-emerald-200",
      tone === "warning" && "border-amber-200",
    )}>
      <CardContent className="p-5">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className={cn(
          "mt-2 font-heading text-3xl font-black",
          tone === "success" && "text-emerald-700",
          tone === "warning" && "text-amber-700",
          tone === "default" && "text-[color:var(--brand-primary-dark)]",
        )}>{value.toLocaleString("en-US")}</div>
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: ConsentStatus }) {
  const classes =
    status === "Firmado"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "Anulado"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : "bg-amber-50 text-amber-700 border-amber-200"
  return <Badge variant="outline" className={classes}>{status}</Badge>
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function ConsentFormDialog({
  kind,
  open,
  form,
  sucursales,
  clientes,
  fichasCliente,
  saveError,
  isSaving,
  onOpenChange,
  onUpdate,
  onSave,
  onPickCliente,
  onClearCliente,
  onLinkFicha,
}: {
  kind: ConsentKind
  open: boolean
  form: ConsentimientoRecord
  sucursales: string[]
  clientes: ClienteCosmiatria[]
  fichasCliente: FichaResumen[]
  saveError: string
  isSaving: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (patch: Partial<ConsentimientoRecord>) => void
  onSave: () => void
  onPickCliente: (cliente: ClienteCosmiatria) => void
  onClearCliente: () => void
  onLinkFicha: (ficha: FichaResumen) => void
}) {
  const config = KIND_CONFIG[kind]
  const linkedCliente = useMemo(
    () => (form.clienteId ? clientes.find((c) => c.ClienteID === form.clienteId) : null),
    [clientes, form.clienteId],
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[1120px]">
        <DialogHeader>
          <DialogTitle>{form.id.startsWith(config.idPrefix) ? "Nuevo consentimiento" : "Editar consentimiento"}</DialogTitle>
          <DialogDescription>{config.title} · complete los datos, firme y guarde.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="ID">
                <Input value={form.id} readOnly className="font-mono text-xs" />
              </Field>
              <Field label="Fecha">
                <Input type="date" value={form.fecha} onChange={(e) => onUpdate({ fecha: e.target.value })} />
              </Field>
              <Field label="Sucursal">
                <Select
                  value={form.sucursal}
                  onValueChange={(value) => {
                    const patch: Partial<ConsentimientoRecord> = { sucursal: value }
                    // Autocompletar especialista por sucursal en ambos consentimientos.
                    // SOLO si el campo está vacío o coincide con un default conocido
                    // (un nombre escrito a mano se respeta).
                    const next = ESPECIALISTAS_POR_SUCURSAL[value] || ""
                    const current = form.nombreEspecialista
                    const isAutoValue = !current || Object.values(ESPECIALISTAS_POR_SUCURSAL).includes(current)
                    if (isAutoValue) patch.nombreEspecialista = next
                    onUpdate(patch)
                  }}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                  <SelectContent>{sucursales.map((sucursal) => <SelectItem key={sucursal} value={sucursal}>{sucursal}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Estado">
                <Select value={form.estado} onValueChange={(value) => onUpdate({ estado: value as ConsentStatus })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Pendiente">Pendiente</SelectItem><SelectItem value="Firmado">Firmado</SelectItem><SelectItem value="Anulado">Anulado</SelectItem></SelectContent>
                </Select>
              </Field>
            </div>
          </section>

          <ClientePicker
            clientes={clientes}
            linkedCliente={linkedCliente || null}
            fichasCliente={fichasCliente}
            linkedFichaId={form.fichaId}
            onPick={onPickCliente}
            onClear={onClearCliente}
            onLinkFicha={onLinkFicha}
          />

          <section className="rounded-2xl border p-4">
            <h3 className="mb-4 font-heading text-lg font-black">Datos del cliente</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Nombre del cliente"><Input value={form.nombreCliente} onChange={(e) => onUpdate({ nombreCliente: e.target.value })} /></Field>
              <Field label="Cédula o documento"><Input value={form.documento} onChange={(e) => onUpdate({ documento: e.target.value })} /></Field>
              <Field label="Teléfono"><Input value={form.telefono} onChange={(e) => onUpdate({ telefono: e.target.value })} /></Field>
              <Field label="Correo"><Input type="email" value={form.correo} onChange={(e) => onUpdate({ correo: e.target.value })} /></Field>
              <Field label="Fecha nacimiento"><Input type="date" value={form.fechaNacimiento} onChange={(e) => onUpdate({ fechaNacimiento: e.target.value, edad: calcAge(e.target.value) })} /></Field>
              <Field label="Edad"><Input value={form.edad} onChange={(e) => onUpdate({ edad: e.target.value })} /></Field>
              <Field label="Dirección" className="md:col-span-3"><Input value={form.direccion} onChange={(e) => onUpdate({ direccion: e.target.value })} /></Field>
            </div>
          </section>

          {kind === "masajes" ? (
            <MasajesTemplateSections form={form} onUpdate={onUpdate} />
          ) : null}

          {kind === "tatuajes" ? (
            <TatuajesTemplateSections form={form} onUpdate={onUpdate} />
          ) : null}

          <section className="rounded-2xl border p-4">
            <h3 className="mb-4 font-heading text-lg font-black">Firmas digitales</h3>
            <div className="grid gap-5 md:grid-cols-2">
              <SignaturePad label="Firma del cliente" value={form.firmaCliente} onChange={(value) => onUpdate({ firmaCliente: value, estado: value ? "Firmado" : form.estado })} />
              <SignaturePad label="Firma del especialista" value={form.firmaEspecialista} onChange={(value) => onUpdate({ firmaEspecialista: value })} />
            </div>
          </section>
        </div>

        {/* Banner de error visible (validación o falla del backend). */}
        {saveError ? (
          <div className="sticky bottom-[68px] z-10 mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700 shadow-sm">
            ⚠ {saveError}
          </div>
        ) : null}

        <DialogFooter className="sticky bottom-0 z-20 -mx-6 -mb-6 border-t border-[color:var(--brand-border)] bg-white/95 px-6 py-3 backdrop-blur sm:-mx-6 sm:-mb-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving} className="gap-2">
            <X className="h-4 w-4" /> Cancelar
          </Button>
          <Button onClick={onSave} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? "Guardando…" : "Guardar consentimiento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DetailDialog({ record, kind, clientes, onClose, onPrint, onEdit }: { record: ConsentimientoRecord | null; kind: ConsentKind; clientes: ClienteCosmiatria[]; onClose: () => void; onPrint: (record: ConsentimientoRecord) => void; onEdit: (record: ConsentimientoRecord) => void }) {
  if (!record) return null
  const linkedCliente = record.clienteId ? clientes.find((c) => c.ClienteID === record.clienteId) : null
  const display = kind === "masajes" ? masajesDisplay(record) : null
  const tDisplay = kind === "tatuajes" ? tatuajesDisplay(record) : null
  const extra: Array<[string, string | undefined]> =
    kind === "masajes" && display
      ? [
          ["Tipo de masaje", display.tipo],
          ["Zona", display.zona],
          ["Presión preferida", record.presionPreferida],
          ["Embarazo", display.embarazo],
          ["Alergias", display.alergias],
        ]
      : kind === "tatuajes" && tDisplay
      ? [
          ["Procedimiento", tDisplay.tipo],
          ["Zona", tDisplay.zona],
          ["Tipo de pigmento", tDisplay.tipoPigmento],
          ["Colores", tDisplay.colores],
          ["Antigüedad", record.antiguedadPigmento],
          ["Tamaño aprox.", record.tamanoAproximado],
          ["Sesiones previas", tDisplay.sesionesPrev],
          ["Embarazo / Lactancia", tDisplay.embarazo],
          ["Alergias", tDisplay.alergias],
          ["Medicamentos", tDisplay.medicamentos],
          ["Exposición solar", tDisplay.exposicion],
          ["Queloides", tDisplay.queloides],
        ]
      : []

  const masajesChecks = kind === "masajes" ? [
    { title: "Instrucciones marcadas", marked: record.instrucciones || [], total: INSTRUCCIONES_MASAJES },
    { title: "Contraindicaciones marcadas", marked: record.contraindicacionesList || [], total: CONTRAINDICACIONES_MASAJES },
    { title: "Políticas aceptadas", marked: record.politicasAceptadas || [], total: POLITICAS_MASAJES },
  ] : []

  const tatuajesChecks = kind === "tatuajes" ? [
    { title: "Instrucciones antes del procedimiento", marked: record.instruccionesAntes || [], total: INSTRUCCIONES_TATUAJES },
    { title: "Cuidados después", marked: record.cuidadosDespuesList || [], total: CUIDADOS_DESPUES_TATUAJES },
    { title: "Riesgos aceptados", marked: record.riesgosAceptadosList || [], total: RIESGOS_TATUAJES },
    { title: "Políticas aceptadas", marked: record.politicasAceptadas || [], total: POLITICAS_TATUAJES },
  ] : []

  // Nombre real del cliente. Prioridad:
  //   1) Nombre del cliente vinculado (tabla Clientes — fuente de verdad)
  //   2) Nombre guardado en el consentimiento (cliente_nombre)
  //   3) Fallback explícito que NUNCA es un ID interno
  const headerName =
    (linkedCliente && clienteFullName(linkedCliente)) ||
    (record.nombreCliente && record.nombreCliente.trim()) ||
    "Cliente sin nombre registrado"

  return (
    <Dialog open={Boolean(record)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[920px]">
        <DialogHeader>
          <DialogTitle>{headerName}</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-[10px] text-muted-foreground/70">{record.id}</span>
            {" · "}{formatDate(record.fecha)}
            {record.sucursal ? ` · ${record.sucursal}` : ""}
            {record.clienteId ? <> · <span className="text-emerald-700">cliente vinculado</span></> : null}
            {record.fichaId ? <> · <span className="text-cyan-700">ficha vinculada</span></> : null}
          </DialogDescription>
        </DialogHeader>
        {linkedCliente ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs">
            <div className="font-bold uppercase tracking-wide text-emerald-700">
              <LinkIcon className="mr-1 inline h-3 w-3" /> Cliente
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-semibold text-slate-900">{clienteDisplayName(linkedCliente)}</span>
              {linkedCliente.DocumentoIdentidad ? <span>· cédula {linkedCliente.DocumentoIdentidad}</span> : null}
              {linkedCliente.Sucursal ? <span>· {linkedCliente.Sucursal}</span> : null}
              <span className="font-mono text-[10px] text-muted-foreground/70">{linkedCliente.ClienteID}</span>
            </div>
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <DetailItem label="Documento" value={record.documento} />
          <DetailItem label="Teléfono" value={record.telefono} />
          <DetailItem label="Correo" value={record.correo} />
          <DetailItem label="Edad" value={record.edad} />
          {extra.map(([label, value]) => <DetailItem key={label} label={label || ""} value={value || "-"} />)}
          <DetailItem label="Especialista" value={record.nombreEspecialista} />
          <DetailItem label="Estado" value={record.estado} />
          {kind === "masajes" && record.observacionesMedicas ? (
            <div className="md:col-span-2 rounded-2xl border bg-amber-50/60 p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">Observaciones médicas</div>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">{record.observacionesMedicas}</p>
            </div>
          ) : null}
          {kind === "masajes" ? masajesChecks.map((block) => (
            <div key={block.title} className="md:col-span-2 rounded-2xl border p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{block.title}</div>
                <span className="text-xs text-muted-foreground">
                  {block.marked.length} de {block.total.length}
                </span>
              </div>
              <ul className="space-y-1 text-sm">
                {block.total.map((opt) => {
                  const on = block.marked.includes(opt)
                  return (
                    <li key={opt} className={`flex items-start gap-2 ${on ? "text-slate-800" : "text-slate-400"}`}>
                      <span className="font-mono text-xs">{on ? "☑" : "☐"}</span>
                      <span className="leading-snug">{opt}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )) : null}
          {kind === "masajes" ? (
            <div className="md:col-span-2 grid gap-3 md:grid-cols-2">
              <div className={`rounded-2xl border p-3 text-sm ${record.declaracionAceptada ? "border-emerald-300 bg-emerald-50/60 text-emerald-700" : "border-amber-300 bg-amber-50/40 text-amber-700"}`}>
                <div className="font-bold">Declaración del cliente</div>
                <div className="text-xs">{record.declaracionAceptada ? "✔ Aceptada" : "○ Pendiente"}</div>
              </div>
              <div className={`rounded-2xl border p-3 text-sm ${record.autorizacionAceptada ? "border-emerald-300 bg-emerald-50/60 text-emerald-700" : "border-amber-300 bg-amber-50/40 text-amber-700"}`}>
                <div className="font-bold">Autorización final</div>
                <div className="text-xs">{record.autorizacionAceptada ? "✔ Aceptada" : "○ Pendiente"}</div>
              </div>
            </div>
          ) : null}

          {kind === "tatuajes" ? tatuajesChecks.map((block) => (
            <div key={block.title} className="md:col-span-2 rounded-2xl border p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <div className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{block.title}</div>
                <span className="text-xs text-muted-foreground">
                  {block.marked.length} de {block.total.length}
                </span>
              </div>
              <ul className="space-y-1 text-sm">
                {block.total.map((opt) => {
                  const on = block.marked.includes(opt)
                  return (
                    <li key={opt} className={`flex items-start gap-2 ${on ? "text-slate-800" : "text-slate-400"}`}>
                      <span className="font-mono text-xs">{on ? "☑" : "☐"}</span>
                      <span className="leading-snug">{opt}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )) : null}

          {kind === "tatuajes" ? (
            <div className="md:col-span-2 grid gap-3 md:grid-cols-3">
              <div className={`rounded-2xl border p-3 text-sm ${record.declaracionResultadosAceptada ? "border-emerald-300 bg-emerald-50/60 text-emerald-700" : "border-amber-300 bg-amber-50/40 text-amber-700"}`}>
                <div className="font-bold">Declaración resultados</div>
                <div className="text-xs">{record.declaracionResultadosAceptada ? "✔ Aceptada" : "○ Pendiente"}</div>
              </div>
              <div className={`rounded-2xl border p-3 text-sm ${record.autorizacionFotograficaAceptada ? "border-emerald-300 bg-emerald-50/60 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                <div className="font-bold">Autorización fotográfica</div>
                <div className="text-xs">{record.autorizacionFotograficaAceptada ? "✔ Autorizada" : "○ No autorizada"}</div>
              </div>
              <div className={`rounded-2xl border p-3 text-sm ${record.autorizacionProcedimientoAceptada ? "border-emerald-300 bg-emerald-50/60 text-emerald-700" : "border-amber-300 bg-amber-50/40 text-amber-700"}`}>
                <div className="font-bold">Autorización final</div>
                <div className="text-xs">{record.autorizacionProcedimientoAceptada ? "✔ Aceptada" : "○ Pendiente"}</div>
              </div>
            </div>
          ) : null}
          {kind !== "masajes" ? (
            <div className="md:col-span-2 rounded-2xl border p-4">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">Consentimiento</div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{record.textoConsentimiento}</p>
            </div>
          ) : null}
          <div className="md:col-span-2 grid gap-4 md:grid-cols-2">
            <SignaturePreview label="Firma cliente" value={record.firmaCliente} />
            <SignaturePreview label="Firma especialista" value={record.firmaEspecialista} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onPrint(record)} className="gap-2"><Printer className="h-4 w-4" /> Imprimir PDF</Button>
          <Button onClick={() => onEdit(record)} className="gap-2"><Pencil className="h-4 w-4" /> Editar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DetailItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-2xl border bg-slate-50/70 p-4">
      <div className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-2 font-semibold">{value || "-"}</div>
    </div>
  )
}

function SignaturePreview({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-slate-50/70 p-4">
      <div className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      {value ? <img src={value} alt={label} className="mt-3 h-28 w-full rounded-xl bg-white object-contain p-2" /> : <div className="mt-3 grid h-28 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">Sin firma</div>}
    </div>
  )
}

/**
 * Plantilla profesional CSL para Consentimiento de Masajes.
 *
 * Reemplaza el bloque "Datos del procedimiento" cuando kind === "masajes".
 * Estructura organizada por bloques: cliente solo marca opciones, el
 * especialista completa observaciones y firmas. Todos los campos viajan
 * por payload_json (no requieren cambios de schema).
 */
function MasajesTemplateSections({
  form,
  onUpdate,
}: {
  form: ConsentimientoRecord
  onUpdate: (patch: Partial<ConsentimientoRecord>) => void
}) {
  const toggleArrayItem = (key: "instrucciones" | "contraindicacionesList" | "politicasAceptadas", value: string, checked: boolean) => {
    const current = (form[key] as string[] | undefined) ?? []
    const next = checked ? Array.from(new Set([...current, value])) : current.filter((v) => v !== value)
    onUpdate({ [key]: next } as Partial<ConsentimientoRecord>)
  }

  const isChecked = (key: "instrucciones" | "contraindicacionesList" | "politicasAceptadas", value: string) =>
    Boolean(((form[key] as string[] | undefined) ?? []).includes(value))

  const allInstr = form.instrucciones?.length === INSTRUCCIONES_MASAJES.length
  const allPol = form.politicasAceptadas?.length === POLITICAS_MASAJES.length

  return (
    <>
      {/* Resumen rápido del procedimiento */}
      <section className="rounded-2xl border p-4">
        <h3 className="mb-4 font-heading text-lg font-black">Datos del procedimiento</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Tipo de masaje">
            <Select
              value={form.tipoMasaje || ""}
              onValueChange={(value) => {
                // Si cambia a algo distinto de "Otro", limpiamos el especificar.
                onUpdate({
                  tipoMasaje: value,
                  ...(value === "Otro" ? {} : { tipoMasajeOtro: "" }),
                })
              }}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Seleccionar tipo" /></SelectTrigger>
              <SelectContent>
                {TIPOS_MASAJE.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.tipoMasaje === "Otro" ? (
              <Input
                className="mt-2"
                value={form.tipoMasajeOtro || ""}
                onChange={(e) => onUpdate({ tipoMasajeOtro: e.target.value })}
                placeholder="Especificar tipo de masaje…"
              />
            ) : null}
          </Field>
          <Field label="Zona a tratar">
            <Select
              value={form.zonaTratar || ""}
              onValueChange={(value) => {
                onUpdate({
                  zonaTratar: value,
                  ...(value === "Otro" ? {} : { zonaTratarOtro: "" }),
                })
              }}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Seleccionar zona" /></SelectTrigger>
              <SelectContent>
                {ZONAS_MASAJE.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.zonaTratar === "Otro" ? (
              <Input
                className="mt-2"
                value={form.zonaTratarOtro || ""}
                onChange={(e) => onUpdate({ zonaTratarOtro: e.target.value })}
                placeholder="Especificar zona…"
              />
            ) : null}
          </Field>
          <Field label="Nombre del especialista" className="md:col-span-2">
            <Input
              value={form.nombreEspecialista}
              onChange={(e) => onUpdate({ nombreEspecialista: e.target.value })}
              placeholder="Se autocompleta según la sucursal"
            />
          </Field>
        </div>
      </section>

      {/* 1. Instrucciones antes del procedimiento — incluye Embarazo y Alergias */}
      <section className="rounded-2xl border p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-lg font-black">Instrucciones antes del procedimiento</h3>
          <button
            type="button"
            onClick={() => onUpdate({ instrucciones: allInstr ? [] : [...INSTRUCCIONES_MASAJES] })}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            {allInstr ? "Desmarcar todas" : "Marcar todas"}
          </button>
        </div>

        {/* Embarazo Sí/No con notas condicionales */}
        <div className="mb-4 grid gap-3 rounded-xl border bg-[color:var(--brand-bg-subtle)] p-3 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-black uppercase tracking-wide text-[color:var(--brand-primary-dark)]">¿Está embarazada?</div>
            <div className="flex gap-2">
              {(["Sí", "No"] as const).map((opt) => {
                const active = form.embarazo === opt
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onUpdate({ embarazo: opt, ...(opt === "No" ? { embarazoNotas: "" } : {}) })}
                    className={`rounded-xl border px-4 py-1.5 text-sm font-semibold transition-colors ${
                      active ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)] text-white" : "border-[color:var(--brand-border)] bg-white hover:bg-muted/30"
                    }`}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
            {form.embarazo === "Sí" ? (
              <Textarea
                value={form.embarazoNotas || ""}
                onChange={(e) => onUpdate({ embarazoNotas: e.target.value })}
                placeholder="Semanas, autorización médica, observaciones relevantes…"
                className="mt-2 min-h-16"
              />
            ) : null}
          </div>

          {/* Alergias Sí/No con notas condicionales */}
          <div>
            <div className="mb-1.5 text-xs font-black uppercase tracking-wide text-[color:var(--brand-primary-dark)]">¿Tiene alergias?</div>
            <div className="flex gap-2">
              {(["Sí", "No"] as const).map((opt) => {
                const active = form.alergiasSiNo === opt
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onUpdate({ alergiasSiNo: opt, ...(opt === "No" ? { alergiasNotas: "", alergias: "" } : {}) })}
                    className={`rounded-xl border px-4 py-1.5 text-sm font-semibold transition-colors ${
                      active ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)] text-white" : "border-[color:var(--brand-border)] bg-white hover:bg-muted/30"
                    }`}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
            {form.alergiasSiNo === "Sí" ? (
              <Textarea
                value={form.alergiasNotas || ""}
                onChange={(e) => onUpdate({ alergiasNotas: e.target.value, alergias: e.target.value })}
                placeholder="Tipo de alergia, medicamentos, productos o aceites a evitar…"
                className="mt-2 min-h-16"
              />
            ) : null}
          </div>
        </div>

        <p className="mb-2 text-xs text-muted-foreground">
          Marca las indicaciones explicadas al cliente antes de la sesión.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {INSTRUCCIONES_MASAJES.map((opt) => (
            <label key={opt} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm hover:bg-muted/30">
              <Checkbox
                checked={isChecked("instrucciones", opt)}
                onCheckedChange={(v) => toggleArrayItem("instrucciones", opt, !!v)}
                className="mt-0.5"
              />
              <span className="leading-snug">{opt}</span>
            </label>
          ))}
        </div>
      </section>

      {/* 2. Presión preferida */}
      <section className="rounded-2xl border p-4">
        <h3 className="mb-3 font-heading text-lg font-black">Presión preferida</h3>
        <div className="flex flex-wrap gap-2">
          {PRESIONES_MASAJES.map((p) => {
            const active = form.presionPreferida === p
            return (
              <button
                key={p}
                type="button"
                onClick={() => onUpdate({ presionPreferida: active ? "" : p })}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                  active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted/30"
                }`}
              >
                {p}
              </button>
            )
          })}
        </div>
      </section>

      {/* 3. Contraindicaciones / precaución */}
      <section className="rounded-2xl border p-4">
        <h3 className="mb-3 font-heading text-lg font-black">Contraindicaciones / precaución</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          El cliente declara presentar una o varias de las siguientes condiciones (marcar las que apliquen).
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {CONTRAINDICACIONES_MASAJES.map((opt) => (
            <label key={opt} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm hover:bg-muted/30">
              <Checkbox
                checked={isChecked("contraindicacionesList", opt)}
                onCheckedChange={(v) => toggleArrayItem("contraindicacionesList", opt, !!v)}
                className="mt-0.5"
              />
              <span className="leading-snug">{opt}</span>
            </label>
          ))}
        </div>
        <div className="mt-4">
          <Field label="Observaciones médicas o advertencias adicionales">
            <Textarea
              value={form.observacionesMedicas || ""}
              onChange={(e) => onUpdate({ observacionesMedicas: e.target.value })}
              placeholder="Cualquier información médica relevante: medicamentos, antecedentes, recomendaciones del médico tratante…"
              className="min-h-24"
            />
          </Field>
        </div>
      </section>

      {/* 4. Declaración del cliente */}
      <section className="rounded-2xl border p-4">
        <h3 className="mb-3 font-heading text-lg font-black">Declaración del cliente</h3>
        <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          {DECLARACION_MASAJES.map((line, idx) => <li key={idx}>{line}</li>)}
        </ul>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-3 text-sm">
          <Checkbox
            checked={Boolean(form.declaracionAceptada)}
            onCheckedChange={(v) => onUpdate({ declaracionAceptada: !!v })}
            className="mt-0.5"
          />
          <span className="font-semibold leading-snug">El cliente declara y acepta los puntos anteriores.</span>
        </label>
      </section>

      {/* 5. Políticas y procedimientos */}
      <section className="rounded-2xl border p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-lg font-black">Políticas y procedimientos</h3>
          <button
            type="button"
            onClick={() => onUpdate({ politicasAceptadas: allPol ? [] : [...POLITICAS_MASAJES] })}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            {allPol ? "Desmarcar todas" : "Marcar todas"}
          </button>
        </div>
        <div className="grid gap-2">
          {POLITICAS_MASAJES.map((opt) => (
            <label key={opt} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm hover:bg-muted/30">
              <Checkbox
                checked={isChecked("politicasAceptadas", opt)}
                onCheckedChange={(v) => toggleArrayItem("politicasAceptadas", opt, !!v)}
                className="mt-0.5"
              />
              <span className="leading-snug">{opt}</span>
            </label>
          ))}
        </div>
      </section>

      {/* 6. Autorización final */}
      <section className="rounded-2xl border p-4">
        <h3 className="mb-3 font-heading text-lg font-black">Autorización final</h3>
        <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          {AUTORIZACION_MASAJES.map((line, idx) => <li key={idx}>{line}</li>)}
        </ul>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border-2 border-dashed border-emerald-400/30 bg-emerald-50/40 p-3 text-sm">
          <Checkbox
            checked={Boolean(form.autorizacionAceptada)}
            onCheckedChange={(v) => onUpdate({ autorizacionAceptada: !!v })}
            className="mt-0.5"
          />
          <span className="font-semibold leading-snug">
            Autorizo a Cibao Spa Laser y a su personal a realizar el procedimiento descrito.
          </span>
        </label>
      </section>

      {/* Observaciones libres del especialista */}
      <section className="rounded-2xl border p-4">
        <h3 className="mb-3 font-heading text-lg font-black">Observaciones del especialista</h3>
        <Textarea
          value={form.observaciones}
          onChange={(e) => onUpdate({ observaciones: e.target.value })}
          placeholder="Notas internas del especialista para el expediente del cliente."
          className="min-h-20"
        />
      </section>
    </>
  )
}

/**
 * Plantilla profesional CSL para Eliminación de Tatuajes y Cejas con láser.
 *
 * Reemplaza el bloque "Datos del procedimiento" cuando kind === "tatuajes".
 * Estructura: datos del procedimiento → datos del pigmento → instrucciones
 * antes (con Sí/No para salud) → cuidados después → riesgos → declaraciones.
 * Todos los campos viajan vía payload_json (sin schema migration).
 */
function TatuajesTemplateSections({
  form,
  onUpdate,
}: {
  form: ConsentimientoRecord
  onUpdate: (patch: Partial<ConsentimientoRecord>) => void
}) {
  const toggleListItem = (key: "instruccionesAntes" | "cuidadosDespuesList" | "riesgosAceptadosList" | "politicasAceptadas" | "coloresPigmento", value: string, checked: boolean) => {
    const current = (form[key] as string[] | undefined) ?? []
    const next = checked ? Array.from(new Set([...current, value])) : current.filter((v) => v !== value)
    onUpdate({ [key]: next } as Partial<ConsentimientoRecord>)
  }
  const isItemChecked = (key: "instruccionesAntes" | "cuidadosDespuesList" | "riesgosAceptadosList" | "politicasAceptadas" | "coloresPigmento", value: string) =>
    Boolean(((form[key] as string[] | undefined) ?? []).includes(value))

  /** Botones Sí/No reusables con notas condicionales. */
  const SiNoBlock = ({
    label,
    siNoKey,
    notasKey,
    placeholder,
  }: {
    label: string
    siNoKey: "embarazoLactanciaSiNo" | "alergiasSiNo" | "medicamentosSiNo" | "exposicionSolarSiNo" | "queloidesSiNo" | "sesionesPreviasSiNo"
    notasKey: keyof ConsentimientoRecord
    placeholder: string
  }) => {
    const value = (form[siNoKey] as string | undefined) || ""
    return (
      <div>
        <div className="mb-1.5 text-xs font-black uppercase tracking-wide text-[color:var(--brand-primary-dark)]">{label}</div>
        <div className="flex gap-2">
          {(["Sí", "No"] as const).map((opt) => {
            const active = value === opt
            return (
              <button
                key={opt}
                type="button"
                onClick={() =>
                  onUpdate({
                    [siNoKey]: opt,
                    ...(opt === "No" ? { [notasKey]: "" } : {}),
                  } as Partial<ConsentimientoRecord>)
                }
                className={`rounded-xl border px-4 py-1.5 text-sm font-semibold transition-colors ${
                  active ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)] text-white" : "border-[color:var(--brand-border)] bg-white hover:bg-muted/30"
                }`}
              >
                {opt}
              </button>
            )
          })}
        </div>
        {value === "Sí" ? (
          <Textarea
            value={String(form[notasKey] ?? "")}
            onChange={(e) => onUpdate({ [notasKey]: e.target.value } as Partial<ConsentimientoRecord>)}
            placeholder={placeholder}
            className="mt-2 min-h-16"
          />
        ) : null}
      </div>
    )
  }

  const allInstr = (form.instruccionesAntes?.length || 0) === INSTRUCCIONES_TATUAJES.length
  const allCuidados = (form.cuidadosDespuesList?.length || 0) === CUIDADOS_DESPUES_TATUAJES.length
  const allRiesgos = (form.riesgosAceptadosList?.length || 0) === RIESGOS_TATUAJES.length
  const allPolit = (form.politicasAceptadas?.length || 0) === POLITICAS_TATUAJES.length

  return (
    <>
      {/* 1. Datos del procedimiento */}
      <section className="rounded-2xl border p-4">
        <h3 className="mb-4 font-heading text-lg font-black">Datos del procedimiento</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Tipo de procedimiento">
            <Select
              value={form.tipoProcedimiento || ""}
              onValueChange={(value) =>
                onUpdate({
                  tipoProcedimiento: value,
                  ...(value === "Otro" ? {} : { tipoProcedimientoOtro: "" }),
                })
              }
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Seleccionar tipo" /></SelectTrigger>
              <SelectContent>
                {TIPOS_PROCEDIMIENTO_TATUAJES.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.tipoProcedimiento === "Otro" ? (
              <Input
                className="mt-2"
                value={form.tipoProcedimientoOtro || ""}
                onChange={(e) => onUpdate({ tipoProcedimientoOtro: e.target.value })}
                placeholder="Especificar tipo de procedimiento…"
              />
            ) : null}
          </Field>
          <Field label="Zona a tratar">
            <Select
              value={form.zonaTratar || ""}
              onValueChange={(value) =>
                onUpdate({
                  zonaTratar: value,
                  ...(value === "Otra zona" ? {} : { zonaTratarOtro: "" }),
                })
              }
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Seleccionar zona" /></SelectTrigger>
              <SelectContent>
                {ZONAS_TATUAJES.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.zonaTratar === "Otra zona" ? (
              <Input
                className="mt-2"
                value={form.zonaTratarOtro || ""}
                onChange={(e) => onUpdate({ zonaTratarOtro: e.target.value })}
                placeholder="Especificar zona…"
              />
            ) : null}
          </Field>
          <Field label="Nombre del especialista" className="md:col-span-2">
            <Input
              value={form.nombreEspecialista}
              onChange={(e) => onUpdate({ nombreEspecialista: e.target.value })}
              placeholder="Se autocompleta según la sucursal"
            />
          </Field>
        </div>
      </section>

      {/* 2. Datos del tatuaje, cejas o pigmento a eliminar */}
      <section className="rounded-2xl border p-4">
        <h3 className="mb-4 font-heading text-lg font-black">Datos del tatuaje, cejas o pigmento a eliminar</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Tipo de pigmento">
            <Select
              value={form.tipoPigmento || ""}
              onValueChange={(value) =>
                onUpdate({
                  tipoPigmento: value,
                  ...(value === "Otro" ? {} : { tipoPigmentoOtro: "" }),
                })
              }
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Seleccionar tipo" /></SelectTrigger>
              <SelectContent>
                {TIPOS_PIGMENTO.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.tipoPigmento === "Otro" ? (
              <Input
                className="mt-2"
                value={form.tipoPigmentoOtro || ""}
                onChange={(e) => onUpdate({ tipoPigmentoOtro: e.target.value })}
                placeholder="Especificar tipo de pigmento…"
              />
            ) : null}
          </Field>
          <Field label="Antigüedad aproximada">
            <Input
              value={form.antiguedadPigmento || ""}
              onChange={(e) => onUpdate({ antiguedadPigmento: e.target.value })}
              placeholder="Ej: 5 años, 6 meses…"
            />
          </Field>
          <Field label="Tamaño aproximado">
            <Input
              value={form.tamanoAproximado || ""}
              onChange={(e) => onUpdate({ tamanoAproximado: e.target.value })}
              placeholder="Ej: 5 x 8 cm, palma de la mano…"
            />
          </Field>
          <Field label="Reacción previa al láser (si aplica)">
            <Input
              value={form.reaccionPreviaLaser || ""}
              onChange={(e) => onUpdate({ reaccionPreviaLaser: e.target.value })}
              placeholder="Hinchazón, ampollas, ninguna…"
            />
          </Field>
          <Field label="Colores del pigmento (uno o varios)" className="md:col-span-2">
            <div className="flex flex-wrap gap-2">
              {COLORES_PIGMENTO.map((color) => {
                const active = isItemChecked("coloresPigmento", color)
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => toggleListItem("coloresPigmento", color, !active)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      active ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)] text-white" : "border-[color:var(--brand-border)] bg-white hover:bg-muted/30"
                    }`}
                  >
                    {color}
                  </button>
                )
              })}
            </div>
            {isItemChecked("coloresPigmento", "Otro") ? (
              <Input
                className="mt-2"
                value={form.coloresPigmentoOtro || ""}
                onChange={(e) => onUpdate({ coloresPigmentoOtro: e.target.value })}
                placeholder="Especificar otros colores…"
              />
            ) : null}
          </Field>
        </div>

        <div className="mt-4 grid gap-3 rounded-xl border bg-[color:var(--brand-bg-subtle)] p-3 md:grid-cols-2">
          <SiNoBlock
            label="¿Ha recibido sesiones previas de eliminación?"
            siNoKey="sesionesPreviasSiNo"
            notasKey="cantidadSesionesPrevias"
            placeholder="Cantidad de sesiones, fechas, centro donde se realizó…"
          />
          <Field label="Observaciones del pigmento">
            <Textarea
              value={form.observacionesPigmento || ""}
              onChange={(e) => onUpdate({ observacionesPigmento: e.target.value })}
              placeholder="Profesional/casero, profundidad estimada, retoques previos…"
              className="min-h-16"
            />
          </Field>
        </div>
      </section>

      {/* 3. Instrucciones antes del procedimiento (con Sí/No salud) */}
      <section className="rounded-2xl border p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-lg font-black">Instrucciones antes del procedimiento</h3>
          <button
            type="button"
            onClick={() => onUpdate({ instruccionesAntes: allInstr ? [] : [...INSTRUCCIONES_TATUAJES] })}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            {allInstr ? "Desmarcar todas" : "Marcar todas"}
          </button>
        </div>

        {/* Bloque salud Sí/No */}
        <div className="mb-4 grid gap-3 rounded-xl border bg-[color:var(--brand-bg-subtle)] p-3 md:grid-cols-2">
          <SiNoBlock
            label="¿Está embarazada o en período de lactancia?"
            siNoKey="embarazoLactanciaSiNo"
            notasKey="embarazoLactanciaNotas"
            placeholder="Semanas, lactancia activa, autorización médica…"
          />
          <SiNoBlock
            label="¿Tiene alergias?"
            siNoKey="alergiasSiNo"
            notasKey="alergiasNotas"
            placeholder="Anestésicos, medicamentos, cremas, productos tópicos…"
          />
          <SiNoBlock
            label="¿Está tomando medicamentos actualmente?"
            siNoKey="medicamentosSiNo"
            notasKey="medicamentosNotas"
            placeholder="Anticoagulantes, antibióticos, isotretinoína, fotosensibilizantes…"
          />
          <SiNoBlock
            label="¿Exposición solar / bronceado / autobronceador reciente?"
            siNoKey="exposicionSolarSiNo"
            notasKey="exposicionSolarNotas"
            placeholder="Cuándo, dónde, intensidad…"
          />
          <SiNoBlock
            label="¿Antecedentes de cicatrices queloides o mala cicatrización?"
            siNoKey="queloidesSiNo"
            notasKey="queloidesNotas"
            placeholder="Tipo, ubicación, antecedentes familiares…"
          />
        </div>

        <p className="mb-2 text-xs text-muted-foreground">
          Marca las indicaciones que se le explicaron al cliente.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {INSTRUCCIONES_TATUAJES.map((opt) => (
            <label key={opt} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm hover:bg-muted/30">
              <Checkbox
                checked={isItemChecked("instruccionesAntes", opt)}
                onCheckedChange={(v) => toggleListItem("instruccionesAntes", opt, !!v)}
                className="mt-0.5"
              />
              <span className="leading-snug">{opt}</span>
            </label>
          ))}
        </div>
      </section>

      {/* 4. Cuidados después del tratamiento */}
      <section className="rounded-2xl border p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-lg font-black">Cuidados después del tratamiento</h3>
          <button
            type="button"
            onClick={() => onUpdate({ cuidadosDespuesList: allCuidados ? [] : [...CUIDADOS_DESPUES_TATUAJES] })}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            {allCuidados ? "Desmarcar todas" : "Marcar todas"}
          </button>
        </div>
        <div className="grid gap-2">
          {CUIDADOS_DESPUES_TATUAJES.map((opt) => (
            <label key={opt} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm hover:bg-muted/30">
              <Checkbox
                checked={isItemChecked("cuidadosDespuesList", opt)}
                onCheckedChange={(v) => toggleListItem("cuidadosDespuesList", opt, !!v)}
                className="mt-0.5"
              />
              <span className="leading-snug">{opt}</span>
            </label>
          ))}
        </div>
      </section>

      {/* 5. Riesgos y posibles complicaciones */}
      <section className="rounded-2xl border p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-lg font-black">Riesgos y posibles complicaciones</h3>
          <button
            type="button"
            onClick={() => onUpdate({ riesgosAceptadosList: allRiesgos ? [] : [...RIESGOS_TATUAJES] })}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            {allRiesgos ? "Desmarcar todos" : "Marcar todos"}
          </button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          Marca los riesgos sobre los que el cliente fue informado y declara comprender.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {RIESGOS_TATUAJES.map((opt) => (
            <label key={opt} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm hover:bg-muted/30">
              <Checkbox
                checked={isItemChecked("riesgosAceptadosList", opt)}
                onCheckedChange={(v) => toggleListItem("riesgosAceptadosList", opt, !!v)}
                className="mt-0.5"
              />
              <span className="leading-snug">{opt}</span>
            </label>
          ))}
        </div>
      </section>

      {/* 6. Declaración sobre resultados (obligatoria) */}
      <section className="rounded-2xl border p-4">
        <h3 className="mb-3 font-heading text-lg font-black">Declaración sobre resultados</h3>
        <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          {DECLARACION_RESULTADOS_TATUAJES.map((line, idx) => <li key={idx}>{line}</li>)}
        </ul>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-3 text-sm">
          <Checkbox
            checked={Boolean(form.declaracionResultadosAceptada)}
            onCheckedChange={(v) => onUpdate({ declaracionResultadosAceptada: !!v })}
            className="mt-0.5"
          />
          <span className="font-semibold leading-snug">
            Declaro que entiendo que los resultados no están garantizados y que puede requerirse más de una sesión.
          </span>
        </label>
      </section>

      {/* 7. Autorización fotográfica */}
      <section className="rounded-2xl border p-4">
        <h3 className="mb-3 font-heading text-lg font-black">Autorización para registro fotográfico</h3>
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{AUTORIZACION_FOTOGRAFICA_TATUAJES}</p>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
          <Checkbox
            checked={Boolean(form.autorizacionFotograficaAceptada)}
            onCheckedChange={(v) => onUpdate({ autorizacionFotograficaAceptada: !!v })}
            className="mt-0.5"
          />
          <span className="font-semibold leading-snug">
            Autorizo el registro fotográfico para seguimiento clínico.
          </span>
        </label>
      </section>

      {/* 8. Políticas y procedimientos */}
      <section className="rounded-2xl border p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-lg font-black">Políticas y procedimientos</h3>
          <button
            type="button"
            onClick={() => onUpdate({ politicasAceptadas: allPolit ? [] : [...POLITICAS_TATUAJES] })}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            {allPolit ? "Desmarcar todas" : "Marcar todas"}
          </button>
        </div>
        <div className="grid gap-2">
          {POLITICAS_TATUAJES.map((opt) => (
            <label key={opt} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm hover:bg-muted/30">
              <Checkbox
                checked={isItemChecked("politicasAceptadas", opt)}
                onCheckedChange={(v) => toggleListItem("politicasAceptadas", opt, !!v)}
                className="mt-0.5"
              />
              <span className="leading-snug">{opt}</span>
            </label>
          ))}
        </div>
      </section>

      {/* 9. Autorización final (obligatoria) */}
      <section className="rounded-2xl border p-4">
        <h3 className="mb-3 font-heading text-lg font-black">Autorización final</h3>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{AUTORIZACION_FINAL_TATUAJES}</p>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border-2 border-dashed border-emerald-400/30 bg-emerald-50/40 p-3 text-sm">
          <Checkbox
            checked={Boolean(form.autorizacionProcedimientoAceptada)}
            onCheckedChange={(v) => onUpdate({ autorizacionProcedimientoAceptada: !!v })}
            className="mt-0.5"
          />
          <span className="font-semibold leading-snug">
            Autorizo la realización del procedimiento de eliminación de tatuajes y/o cejas con láser.
          </span>
        </label>
      </section>

      {/* 10. Observaciones libres del especialista */}
      <section className="rounded-2xl border p-4">
        <h3 className="mb-3 font-heading text-lg font-black">Observaciones del especialista</h3>
        <Textarea
          value={form.observaciones}
          onChange={(e) => onUpdate({ observaciones: e.target.value })}
          placeholder="Notas internas del especialista para el expediente del cliente."
          className="min-h-20"
        />
      </section>
    </>
  )
}

/**
 * Selector de cliente: búsqueda en vivo + autocompletado.
 *
 *   - "Buscar cliente":  filtra `clientes` por nombre/cédula/teléfono/correo.
 *     Al seleccionar uno, se llaman los autocompletados del formulario
 *     padre y se carga el historial (fichas) para ofrecer vinculación.
 *   - "Vincular ficha":  visible cuando el cliente vinculado tiene fichas.
 *   - "Crear cliente nuevo": no crea de inmediato; sólo deja la captura
 *     manual; el backend `saveConsent*` upserta el cliente al guardar el
 *     consentimiento (mismo helper que `saveFichaDermatologia`).
 */
function ClientePicker({
  clientes,
  linkedCliente,
  fichasCliente,
  linkedFichaId,
  onPick,
  onClear,
  onLinkFicha,
}: {
  clientes: ClienteCosmiatria[]
  linkedCliente: ClienteCosmiatria | null
  fichasCliente: FichaResumen[]
  linkedFichaId: string
  onPick: (cliente: ClienteCosmiatria) => void
  onClear: () => void
  onLinkFicha: (ficha: FichaResumen) => void
}) {
  const [query, setQuery] = useState("")

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return clientes.slice(0, 8)
    const needleDigits = onlyDigits(needle)
    return clientes
      .filter((c) => {
        const haystack = [
          c.Nombre,
          c.Apellido,
          clienteFullName(c),
          c.DocumentoIdentidad,
          c.Telefono,
          c.Telefono2,
          c.Email,
          c.NumeroCliente,
        ]
          .join(" ")
          .toLowerCase()
        if (haystack.includes(needle)) return true
        if (needleDigits) {
          const digits = [c.DocumentoIdentidad, c.Telefono, c.Telefono2]
            .map((value) => onlyDigits(value))
            .join(" ")
          if (digits.includes(needleDigits)) return true
        }
        return false
      })
      .slice(0, 12)
  }, [query, clientes])

  return (
    <section className="rounded-2xl border border-emerald-300/40 bg-emerald-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-heading text-base font-black">
          <Users className="h-4 w-4 text-emerald-400" />
          Cliente vinculado
        </h3>
        {linkedCliente ? (
          <Button variant="outline" size="sm" onClick={onClear} className="gap-2">
            <X className="h-3.5 w-3.5" /> Cambiar / quitar
          </Button>
        ) : null}
      </div>

      {linkedCliente ? (
        <div className="mt-3 rounded-xl border bg-white/60 p-3 text-sm">
          {/* Título principal: SIEMPRE el nombre real del cliente. Nunca un ID. */}
          <div className="flex flex-wrap items-baseline gap-2">
            <div className="text-base font-bold text-[color:var(--brand-primary-dark)]">
              {clienteDisplayName(linkedCliente)}
            </div>
            {/* ID interno como texto secundario muy discreto */}
            <div className="font-mono text-[10px] text-muted-foreground/70">{linkedCliente.ClienteID}</div>
          </div>
          <div className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
            <span>Cédula: {linkedCliente.DocumentoIdentidad || "—"}</span>
            <span>Teléfono: {linkedCliente.Telefono || "—"}</span>
            <span>Correo: {linkedCliente.Email || "—"}</span>
            <span>Sucursal: {linkedCliente.Sucursal || "—"}</span>
            <span>Edad: {linkedCliente.Edad || "—"}</span>
            <span>Estado: {linkedCliente.Estado}</span>
          </div>

          {fichasCliente.length > 0 ? (
            <div className="mt-3 border-t pt-3">
              <div className="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">
                Fichas dermatológicas del cliente
              </div>
              <div className="flex flex-wrap gap-2">
                {fichasCliente.slice(0, 6).map((ficha) => {
                  const isLinked = ficha.id === linkedFichaId
                  return (
                    <Button
                      key={ficha.id}
                      type="button"
                      size="sm"
                      variant={isLinked ? "default" : "outline"}
                      className="gap-2"
                      onClick={() => onLinkFicha(ficha)}
                      title={`Vincular esta ficha y traer datos de salud (alergias, embarazo)`}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {formatDate(ficha.fecha)}
                      {ficha.sucursal ? ` · ${ficha.sucursal}` : ""}
                      {isLinked ? " · vinculada" : ""}
                    </Button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              Este cliente aún no tiene ficha dermatológica registrada.
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <Label className="text-xs font-black uppercase tracking-wide text-muted-foreground">
            Buscar cliente existente
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nombre, cédula, teléfono o correo..."
              className="pl-9"
            />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-xl border bg-white/60">
            {matches.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">
                No hay coincidencias. Captura los datos manualmente y al guardar el consentimiento se creará un cliente nuevo.
              </div>
            ) : (
              <ul className="divide-y">
                {matches.map((c) => (
                  <li key={c.ClienteID}>
                    <button
                      type="button"
                      onClick={() => onPick(c)}
                      className="flex w-full items-center gap-2 p-2 text-left text-sm transition-colors hover:bg-[color:var(--brand-primary-soft)] focus:bg-[color:var(--brand-primary-soft)] focus:outline-none"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{clienteDisplayName(c)}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[c.DocumentoIdentidad, c.Telefono, c.Email, c.Sucursal].filter(Boolean).join(" · ") || c.ClienteID}
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[color:var(--brand-primary)]">
                        Seleccionar →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
            <UserPlus className="h-3.5 w-3.5" />
            ¿No está? Captura los datos abajo y al guardar el consentimiento se crea automáticamente.
          </div>
        </div>
      )}
    </section>
  )
}
