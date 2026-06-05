"use client"

import { HrDevCrud } from "@/components/hr/hr-dev-crud"
import { Users2, ListChecks, Star, ShieldAlert, GraduationCap, Megaphone } from "lucide-react"

const MIG = "202606020011_hr_phase5_desarrollo.sql"
const SECTION = "RR.HH. · Desarrollo"
const ESTADO_CLASS: Record<string, string> = {
  nuevo: "bg-slate-100 text-slate-700 border-slate-200",
  evaluando: "bg-blue-100 text-blue-700 border-blue-200",
  entrevista: "bg-amber-100 text-amber-700 border-amber-200",
  aprobado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  contratado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  rechazado: "bg-red-100 text-red-700 border-red-200",
  en_progreso: "bg-blue-100 text-blue-700 border-blue-200",
  completado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  borrador: "bg-slate-100 text-slate-700 border-slate-200",
  finalizada: "bg-emerald-100 text-emerald-700 border-emerald-200",
  emitida: "bg-blue-100 text-blue-700 border-blue-200",
  firmada: "bg-emerald-100 text-emerald-700 border-emerald-200",
  archivada: "bg-gray-100 text-gray-500 border-gray-200",
  anulada: "bg-gray-100 text-gray-400 border-gray-200",
  asignado: "bg-slate-100 text-slate-700 border-slate-200",
  vencido: "bg-red-100 text-red-700 border-red-200",
}

export function RrhhReclutamientoPage() {
  return <HrDevCrud
    title="Reclutamiento" subtitle="Pipeline de candidatos: vacantes, evaluación, entrevista y conversión a empleado." section={SECTION} icon={Users2}
    getAction="getHrRecruitment" saveAction="saveHrRecruitment" deleteAction="deleteHrRecruitment" table="hr_recruitment" migration={MIG}
    addLabel="Nuevo candidato" defaults={{ estado: "nuevo" }} statusKey="estado" statusClass={ESTADO_CLASS}
    columns={[{ key: "nombre", label: "Candidato" }, { key: "puesto", label: "Puesto" }, { key: "sucursal", label: "Sucursal" }, { key: "estado", label: "Estado", kind: "badge" }]}
    fields={[
      { key: "nombre", label: "Nombre", required: true, full: true },
      { key: "puesto", label: "Puesto" }, { key: "sucursal", label: "Sucursal" },
      { key: "telefono", label: "Teléfono" }, { key: "email", label: "Email" },
      { key: "estado", label: "Estado", type: "select", options: ["nuevo", "evaluando", "entrevista", "aprobado", "rechazado", "contratado"] },
      { key: "notas", label: "Notas", type: "textarea" },
    ]} />
}

export function RrhhOnboardingPage() {
  return <HrDevCrud
    title="Onboarding" subtitle="Checklist de ingreso del nuevo empleado." section={SECTION} icon={ListChecks}
    getAction="getHrOnboarding" saveAction="saveHrOnboarding" deleteAction="deleteHrOnboarding" table="hr_onboarding" migration={MIG}
    addLabel="Nuevo onboarding" defaults={{ estado: "en_progreso", checklist: {} }} statusKey="estado" statusClass={ESTADO_CLASS}
    columns={[{ key: "employee_nombre", label: "Empleado" }, { key: "employee_id", label: "ID" }, { key: "estado", label: "Estado", kind: "badge" }]}
    fields={[
      { key: "employee_id", label: "Empleado", required: true, type: "employee", full: true },
      { key: "checklist", label: "Checklist de ingreso", type: "checklist", items: [
        { key: "cedula", label: "Cédula recibida" }, { key: "contrato", label: "Contrato firmado" },
        { key: "cuenta_banco", label: "Cuenta bancaria" }, { key: "uniforme", label: "Uniforme" },
        { key: "induccion", label: "Inducción" }, { key: "capacitacion", label: "Capacitación inicial" },
        { key: "usuario", label: "Usuario creado" }, { key: "horario", label: "Horario/sucursal asignados" },
      ] },
      { key: "estado", label: "Estado", type: "select", options: ["en_progreso", "completado"] },
      { key: "notas", label: "Notas", type: "textarea" },
    ]} />
}

export function RrhhEvaluacionPage() {
  return <HrDevCrud
    title="Evaluación de desempeño" subtitle="Evaluaciones periódicas con puntaje, comentarios y plan de mejora." section={SECTION} icon={Star}
    getAction="getHrEvaluations" saveAction="saveHrEvaluation" deleteAction="deleteHrEvaluation" table="hr_evaluations" migration={MIG}
    addLabel="Nueva evaluación" defaults={{ estado: "borrador" }} statusKey="estado" statusClass={ESTADO_CLASS}
    columns={[{ key: "employee_nombre", label: "Empleado" }, { key: "periodo", label: "Período" }, { key: "puntaje", label: "Puntaje" }, { key: "estado", label: "Estado", kind: "badge" }]}
    fields={[
      { key: "employee_id", label: "Empleado", required: true, type: "employee", full: true },
      { key: "periodo", label: "Período" }, { key: "puntaje", label: "Puntaje (0-100)", type: "number" },
      { key: "comentarios", label: "Comentarios", type: "textarea" }, { key: "plan_mejora", label: "Plan de mejora", type: "textarea" },
      { key: "estado", label: "Estado", type: "select", options: ["borrador", "finalizada"] },
    ]} />
}

export function RrhhDisciplinaPage() {
  return <HrDevCrud
    title="Disciplina" subtitle="Amonestaciones, suspensiones e incidencias con evidencia." section={SECTION} icon={ShieldAlert}
    getAction="getHrDisciplinary" saveAction="saveHrDisciplinary" deleteAction="deleteHrDisciplinary" table="hr_disciplinary" migration={MIG}
    addLabel="Nuevo registro" defaults={{ tipo: "amonestacion_verbal", estado: "borrador" }} statusKey="estado" statusClass={ESTADO_CLASS}
    columns={[{ key: "employee_nombre", label: "Empleado" }, { key: "tipo", label: "Tipo" }, { key: "fecha", label: "Fecha", kind: "date" }, { key: "estado", label: "Estado", kind: "badge" }]}
    fields={[
      { key: "employee_id", label: "Empleado", required: true, type: "employee", full: true },
      { key: "tipo", label: "Tipo", type: "select", options: ["amonestacion_verbal", "amonestacion_escrita", "suspension", "incidencia"] },
      { key: "fecha", label: "Fecha", type: "date" },
      { key: "descripcion", label: "Descripción", type: "textarea" }, { key: "evidencia_url", label: "Evidencia (URL)" },
      { key: "estado", label: "Estado", type: "select", options: ["borrador", "emitida", "firmada", "rechazada", "archivada", "anulada"] },
    ]} />
}

export function RrhhCapacitacionPage() {
  return <HrDevCrud
    title="Capacitación" subtitle="Cursos, certificaciones y vencimientos por empleado." section={SECTION} icon={GraduationCap}
    getAction="getHrTrainings" saveAction="saveHrTraining" deleteAction="deleteHrTraining" table="hr_trainings" migration={MIG}
    addLabel="Nueva capacitación" defaults={{ tipo: "interno", estado: "asignado" }} statusKey="estado" statusClass={ESTADO_CLASS}
    columns={[{ key: "employee_nombre", label: "Empleado" }, { key: "curso", label: "Curso" }, { key: "tipo", label: "Tipo" }, { key: "estado", label: "Estado", kind: "badge" }]}
    fields={[
      { key: "curso", label: "Curso", required: true, full: true },
      { key: "employee_id", label: "Empleado", type: "employee", full: true },
      { key: "tipo", label: "Tipo", type: "select", options: ["interno", "externo"] },
      { key: "fecha_objetivo", label: "Fecha objetivo", type: "date" }, { key: "vencimiento", label: "Vencimiento", type: "date" },
      { key: "certificado_url", label: "Certificado (URL)" },
      { key: "estado", label: "Estado", type: "select", options: ["asignado", "en_progreso", "completado", "vencido"] },
    ]} />
}

export function RrhhComunicacionPage() {
  return <HrDevCrud
    title="Comunicación interna" subtitle="Avisos segmentados por empresa, sucursal o cargo." section={SECTION} icon={Megaphone}
    getAction="getHrCommunications" saveAction="saveHrCommunication" deleteAction="deleteHrCommunication" table="hr_communications" migration={MIG}
    addLabel="Nuevo aviso" defaults={{ segmento: "general" }}
    columns={[{ key: "titulo", label: "Título" }, { key: "segmento", label: "Segmento" }, { key: "destinatario", label: "Destinatario" }, { key: "fecha", label: "Fecha", kind: "date" }]}
    fields={[
      { key: "titulo", label: "Título", required: true, full: true },
      { key: "mensaje", label: "Mensaje", type: "textarea" },
      { key: "segmento", label: "Segmento", type: "select", options: ["general", "sucursal", "cargo"] },
      { key: "destinatario", label: "Destinatario (sucursal/cargo)" }, { key: "fecha", label: "Fecha", type: "date" },
    ]} />
}
