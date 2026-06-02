"use client"

import {
  Scale, FileCheck, Users2, ListChecks, Star, ShieldAlert, GraduationCap,
  Megaphone,
} from "lucide-react"
import { HrPageShell } from "@/components/hr-page-shell"

/**
 * Barrel de placeholders profesionales para las páginas RR.HH. de fases 2-6.
 * Cada una usa HrPageShell con su icono, fase y lista de funcionalidades
 * planeadas. Cuando una fase se implemente, basta con reemplazar el export
 * correspondiente por su componente real sin tocar el dispatcher.
 */

// ── FASE 1 · Personal ──────────────────────────────────────────────────────
// RrhhContratosPage y RrhhDocumentosPage tienen CRUD real:
//   components/hr/rrhh-contratos-page.tsx
//   components/hr/rrhh-documentos-page.tsx

// ── FASE 2 · Asistencia ────────────────────────────────────────────────────

// RrhhPonchePage tiene componente real: components/hr/rrhh-ponche-page.tsx

// RrhhAsistenciaPage tiene componente real: components/hr/rrhh-asistencia-page.tsx
// RrhhHorariosPage tiene componente real: components/hr/rrhh-horarios-page.tsx

// RrhhPermisosPage tiene componente real: components/hr/rrhh-permisos-page.tsx

// ── FASE 3 · Pagos ─────────────────────────────────────────────────────────

// RrhhNominaPage tiene componente real: components/hr/rrhh-nomina-page.tsx

// RrhhDiasLaboradosPage tiene componente real: components/hr/rrhh-dias-laborados-page.tsx

// RrhhIncentivosPage tiene componente real: components/hr/rrhh-incentivos-page.tsx

// RrhhVacacionesPage tiene componente real: components/hr/rrhh-vacaciones-page.tsx
// RrhhDobleSueldoPage tiene componente real: components/hr/rrhh-doble-sueldo-page.tsx

// RrhhPrestamosPage tiene componente real: components/hr/rrhh-prestamos-page.tsx

// RrhhTxtBancariosPage tiene componente real: components/hr/rrhh-txt-bancarios-page.tsx

// ── FASE 4 · Prestaciones ──────────────────────────────────────────────────

export const RrhhLiquidacionesPage = () => (
  <HrPageShell
    icon={Scale}
    title="Liquidaciones y prestaciones RD"
    section="RR.HH. · Prestaciones"
    phase={4}
    description="Cálculo referencial de prestaciones laborales según legislación dominicana. Requiere validación por RR.HH., contabilidad y/o asesor legal."
    features={[
      "Tipos: desahucio, renuncia, despido (justificado/no), mutuo acuerdo, fin de contrato, abandono, fallecimiento",
      "Cálculos: preaviso, cesantía, vacaciones pendientes, Navidad proporcional, días laborados",
      "Conceptos: salario pendiente, incentivos/comisiones, bonificaciones, préstamos, descuentos",
      "Estados: borrador → calculado → revisado → aprobado → PDF → pendiente pago → pagado → archivado",
      "Advertencia legal en todos los cálculos",
    ]}
  />
)

export const RrhhPdfPrestacionesPage = () => (
  <HrPageShell
    icon={FileCheck}
    title="PDF de prestaciones"
    section="RR.HH. · Prestaciones"
    phase={4}
    description="Generación de PDF profesional de prestaciones con datos del empleado, conceptos, descuentos, nota legal y firmas."
    features={[
      "Header con logo empresa + datos completos del empleado",
      "Tiempo laborado, salario actual, promedios mensual/diario",
      "Detalle de conceptos aplicables y descuentos",
      "Nota legal completa de RD",
      "Firmas: RR.HH., representante empresa, contabilidad, empleado",
    ]}
  />
)

// ── FASE 5 · Desarrollo ────────────────────────────────────────────────────

export const RrhhReclutamientoPage = () => (
  <HrPageShell
    icon={Users2}
    title="Reclutamiento"
    section="RR.HH. · Desarrollo"
    phase={5}
    description="Pipeline de candidatos: vacantes, entrevistas, pruebas, decisiones y conversión a empleado."
    features={[
      "Vacantes por sucursal/cargo con descripción y estado",
      "Estados candidato: nuevo, evaluando, entrevista, aprobado, rechazado, contratado",
      "Conexión con 'Solicitudes de empleo' existentes",
      "Conversión directa a empleado con onboarding",
    ]}
  />
)

export const RrhhOnboardingPage = () => (
  <HrPageShell
    icon={ListChecks}
    title="Onboarding"
    section="RR.HH. · Desarrollo"
    phase={5}
    description="Checklist de ingreso del nuevo empleado: documentos, cuenta bancaria, uniforme, inducción, capacitación inicial."
    features={[
      "Cédula recibida · Contrato firmado · Cuenta bancaria · Uniforme",
      "Inducción completada · Capacitación inicial",
      "Usuario creado en el sistema · Horario y sucursal asignados",
      "Estado consolidado por empleado en el dashboard",
    ]}
  />
)

export const RrhhEvaluacionPage = () => (
  <HrPageShell
    icon={Star}
    title="Evaluación de desempeño"
    section="RR.HH. · Desarrollo"
    phase={5}
    description="Evaluaciones periódicas con criterios: puntualidad, servicio, ventas, protocolos, productividad, actitud, metas."
    features={[
      "Plantilla de evaluación configurable",
      "Calificación numérica y comentarios",
      "Adjuntar evidencias",
      "Plan de mejora con seguimiento",
      "Exportar PDF",
    ]}
  />
)

export const RrhhDisciplinaPage = () => (
  <HrPageShell
    icon={ShieldAlert}
    title="Disciplina"
    section="RR.HH. · Desarrollo"
    phase={5}
    description="Registro de amonestaciones, suspensiones e incidencias con evidencia y firma del empleado."
    features={[
      "Tipos: amonestación verbal/escrita, suspensión, incidencia",
      "Adjuntar evidencias (foto, audio, documento)",
      "Firma del empleado (digital)",
      "Estados: borrador, emitida, firmada, rechazada, archivada, anulada",
      "Seguimiento de medidas correctivas",
    ]}
  />
)

export const RrhhCapacitacionPage = () => (
  <HrPageShell
    icon={GraduationCap}
    title="Capacitación"
    section="RR.HH. · Desarrollo"
    phase={5}
    description="Cursos, certificaciones, evaluaciones y vencimientos por empleado."
    features={[
      "Catálogo de cursos internos/externos",
      "Asignación a empleados con fecha objetivo",
      "Evaluaciones al finalizar",
      "Certificados con vencimiento y renovación",
      "Reporte de cumplimiento por sucursal",
    ]}
  />
)

export const RrhhComunicacionPage = () => (
  <HrPageShell
    icon={Megaphone}
    title="Comunicación interna"
    section="RR.HH. · Desarrollo"
    phase={5}
    description="Avisos segmentados por empresa, sucursal o cargo con confirmación de lectura."
    features={[
      "Avisos generales con segmentación",
      "Mensajes internos uno-a-uno o por grupo",
      "Confirmación de lectura con timestamp",
      "Adjuntar archivos",
    ]}
  />
)

// ── FASE 6 · Reportes ──────────────────────────────────────────────────────
// RrhhReportesPage tiene componente real: components/hr/rrhh-reportes-page.tsx
// RrhhAuditoriaPage tiene componente real: components/hr/rrhh-auditoria-page.tsx
