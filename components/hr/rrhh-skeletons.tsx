"use client"

import {
  Wallet, TrendingUp, Plane, Gift, FileText,
  Scale, FileCheck, Users2, ListChecks, Star, ShieldAlert, GraduationCap,
  Megaphone, BarChart3, Shield,
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

export const RrhhNominaPage = () => (
  <HrPageShell
    icon={Wallet}
    title="Nómina"
    section="RR.HH. · Pagos"
    phase={3}
    description="Corridas de nómina por período y sucursal con conceptos, revisión, aprobación y generación de TXT bancario."
    features={[
      "Período + sucursal + tipo de pago",
      "Conceptos: sueldo, horas extras, incentivos, bonos, ausencias, tardanzas, préstamos, descuentos",
      "Estados: borrador → calculada → revisión → aprobada → TXT generado → pagada",
      "Recibos individuales en PDF",
      "Bloqueo de cierre si hay ponches incompletos sin revisar",
    ]}
  />
)

// RrhhDiasLaboradosPage tiene componente real: components/hr/rrhh-dias-laborados-page.tsx

export const RrhhIncentivosPage = () => (
  <HrPageShell
    icon={TrendingUp}
    title="Incentivos y comisiones"
    section="RR.HH. · Pagos"
    phase={3}
    description="Comisiones, bonos por meta y ajustes manuales, pagaderos en nómina o en TXT separado."
    features={[
      "Importar Excel con asignaciones por empleado o sucursal",
      "Tipos: comisión, bono fijo, bono por meta, incentivo especial, ajuste manual",
      "Aprobación previa al pago",
      "Salida a nómina o a TXT separado",
    ]}
  />
)

export const RrhhVacacionesPage = () => (
  <HrPageShell
    icon={Plane}
    title="Vacaciones"
    section="RR.HH. · Pagos"
    phase={3}
    description="Balance acumulado/usado/pendiente, solicitud, aprobación y pago de vacaciones con constancia PDF."
    features={[
      "Balance por empleado con cálculo automático según fecha de ingreso",
      "Solicitud con calendario consolidado por sucursal",
      "Aprobación con cálculo de monto a pagar",
      "Generar constancia PDF + TXT bancario si aplica",
    ]}
  />
)

export const RrhhDobleSueldoPage = () => (
  <HrPageShell
    icon={Gift}
    title="Doble sueldo"
    section="RR.HH. · Pagos"
    phase={3}
    description="Salario de Navidad anual o proporcional según fecha de ingreso/salida, con bloqueo de doble pago en el mismo año."
    features={[
      "Cálculo anual o proporcional",
      "Bloqueo automático de doble pago en el mismo año fiscal",
      "Ajustes autorizados con motivo",
      "Recibo PDF + TXT bancario separado",
    ]}
  />
)

// RrhhPrestamosPage tiene componente real: components/hr/rrhh-prestamos-page.tsx

export const RrhhTxtBancariosPage = () => (
  <HrPageShell
    icon={FileText}
    title="Archivos TXT bancarios"
    section="RR.HH. · Pagos"
    phase={3}
    description="Generación de TXT bancario en formato: CUENTA_ORIGEN,CUENTA_DESTINO,MONTO,NOMBRE_EMPLEADO. Sin encabezado, montos con 2 decimales, nombres en mayúsculas."
    features={[
      "Origen: nómina, incentivos, vacaciones, doble sueldo, días laborados, liquidaciones",
      "Solo se genera si el pago está aprobado",
      "Validación de totales contra monto aprobado",
      "Hash único por archivo para evitar duplicados",
      "Nombrado estándar: TIPO_TENANT_SUCURSAL_YYYY-MM-DD.txt",
    ]}
  />
)

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

export const RrhhReportesPage = () => (
  <HrPageShell
    icon={BarChart3}
    title="Reportes RR.HH."
    section="RR.HH. · Reportes"
    phase={6}
    description="Reportes consolidados: empleados, asistencia, nómina, incentivos, vacaciones, préstamos, liquidaciones, archivos bancarios."
    features={[
      "Empleados activos/inactivos · Asistencia diaria · Tardanzas y ausencias",
      "Nómina por período · Incentivos · Vacaciones · Préstamos",
      "Liquidaciones · Archivos bancarios · Auditoría completa",
      "Exportar Excel · PDF · TXT cuando aplique",
      "Filtros: empresa, sucursal, empleado, cargo, departamento, período, estado",
    ]}
  />
)

export const RrhhAuditoriaPage = () => (
  <HrPageShell
    icon={Shield}
    title="Auditoría RR.HH."
    section="RR.HH. · Reportes"
    phase={6}
    description="Log de acciones críticas con usuario, módulo, acción, valores anteriores/nuevos, IP y timestamp."
    features={[
      "Crear/editar empleado · Cambio de sueldo · Cambio de cuenta bancaria",
      "Crear/editar ponche manual · Aprobar correcciones",
      "Crear/aprobar nómina · Generar TXT · Generar PDF",
      "Crear/aprobar liquidación · Eliminar/inactivar registros",
      "Trazabilidad completa con valores anteriores y nuevos",
    ]}
  />
)
