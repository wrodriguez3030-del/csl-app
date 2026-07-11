export interface Sucursal {
  _rowNum?: string
  Codigo: string
  Nombre: string
  Ciudad: string
  Direccion?: string
  Estado: "Activa" | "Inactiva"
  Notas?: string
  Correo?: string
}

export interface Equipo {
  _rowNum?: string
  /** UUID del business al que pertenece. Necesario para que el filtro
   *  superadmin distinga visualmente equipos CSL vs Depicenter. */
  business_id?: string
  EquipoID: string
  Sucursal: string
  Empresa: string
  Domicilio?: string
  Modelo: string
  Serie?: string
  Numero?: string
  /** Número de fuente (fuente de poder) del equipo. Texto libre alfanumérico
   *  ("Fuente 1", "F-01", "PS-001"). Prellena PowerSourceNumber en reportes.
   *  Añadido en migración 202606300001_equipos_source_number.sql. */
  SourceNumber?: string
  P_Cabeza?: number
  P_Totales?: number
  Max_Cabeza?: number
  Estado: "Activo" | "Inactivo"
  Observaciones?: string
  // Añadidos en migración 202605280001_equipos_cabina_operadora.sql.
  // Eran texto libre dentro de Observaciones — ahora son campos separados.
  Cabina?: string
  Operadora?: string
  OperadoraID?: string
  // Añadidos en migración 202605280002_equipos_pulsos_audit.sql.
  // Auditoría: cuándo / con qué semana se actualizaron los pulsos.
  UltimaActualizacionPulsos?: string  // ISO timestamp
  UltimaSemanaPulsos?: string         // ISO date (lunes)
  FallasRecientes?: string            // Comma-separated codes from latest Excel import
}

export interface Tecnico {
  _rowNum?: string
  Codigo: string
  Nombre: string
  Telefono?: string
  Correo?: string
  Estado: "Activo" | "Inactivo"
  Notas?: string
}

export interface PiezaIntervenida {
  pieza: string
  categoria: string
  accion: string
  estado: string
  desgaste?: number
  reemplazo: "Sí" | "No"
  costo?: number
  pulsos?: number
  observaciones?: string
}

export interface Reporte {
  _rowNum?: string
  ID: string
  Fecha: string
  EquipoID: string
  Sucursal: string
  Empresa?: string
  Cliente?: string
  Domicilio?: string
  Ciudad?: string
  Modelo?: string
  Serie?: string
  Numero?: string
  Tipo: "Preventivo" | "Correctivo" | "Garantía" | "Pago por servicio"
  EstadoEquipo: "Operativo" | "Observación" | "Fuera de servicio"
  Prioridad: "Baja" | "Media" | "Alta"
  Problema?: string
  Correccion?: string
  Observaciones?: string
  Checklist?: string
  P_Cabeza?: number
  P_Totales?: number
  Atendio: string
  // Parámetros técnicos del reporte de servicio (migración
  // 202606180001_reportes_campos_tecnicos.sql). Texto libre: pueden traer
  // unidades ("12.5 kV", "8 J").
  PowerSourceNumber?: string  // Número de la fuente de poder
  PowerSourceSerial?: string  // N/S Fuente
  FiberSerial?: string        // N/S Fibra
  HV?: string                 // HV@
  Joules?: string             // J
  BS?: string                 // BS
  BC?: string                 // BC
  HVRef?: string              // HV REF@
  VDC?: string                // VDC
  Voltage?: string            // V
  TX?: string                 // TX
  Software?: string           // Software
  PiezasJSON?: string
  PartesTexto?: string
  FirmaCliente?: string
  FirmaTecnico?: string
  Fotos?: string
}

export interface PiezaCatalogo {
  _rowNum?: string
  Pieza: string
  Categoria: string
  Prioridad: "Alta" | "Media-Alta" | "Media" | "Baja"
  Tipo: "Consumible" | "Consumible técnico" | "Consumible operativo" | "No consumible" | "No consumible crítico"
  Funcion?: string
  FallasComunes?: string
  Activa?: "Sí" | "No"
}

export type ReceivedStatus =
  | "pendiente"
  | "recibida_parcial"
  | "recibida_completa"
  | "cancelada"

export interface PiezaPolizaLista {
  id: string
  PiezaNombre: string
  CategoriaSnapshot?: string
  Cantidad: number
  Suplidor?: string
  Prioridad: "Baja" | "Media" | "Alta"
  Estado: "pendiente" | "recibida"
  Sucursal?: string
  FechaSolicitada: string
  FechaRecibida?: string | null
  Nota?: string
  CreadoPor?: string
  CreatedAt?: string
  UpdatedAt?: string
  // ── Recepción de pieza ──────────────────────────────────────────────
  ReceivedStatus?: ReceivedStatus
  ReceivedAt?: string | null
  ReceivedQuantity?: number | null
  ReceivedBy?: string | null
  ReceivedNote?: string | null
  ReceivedInvoiceNumber?: string | null
  ReceivedCost?: number | null
  ReceivedSupplier?: string | null
  ReceivedAttachmentUrl?: string | null
  ReceptionUpdatedAt?: string | null
  ReceptionUpdatedBy?: string | null
}

export interface InventarioItem {
  _rowNum?: string
  ItemID: string
  CodigoBarras?: string
  Pieza: string
  Categoria: string
  Marca?: string
  Modelo?: string
  NumeroParte?: string
  PrecioCompra: number
  PrecioCompraMercado?: number
  PrecioVenta?: number
  StockRafaelVidal: number
  StockLosJardines: number
  StockVillaOlga: number
  StockLaVega: number
  StockMinimo: number
  Proveedor?: string
  Estado: "Activo" | "Inactivo"
  Observaciones?: string
}

export interface Database {
  sucursales: Sucursal[]
  equipos: Equipo[]
  reportes: Reporte[]
  piezas: PiezaCatalogo[]
  tecnicos: Tecnico[]
  inventario?: InventarioItem[]
}

// =====================================================
// MULTI-TENANT (negocios) — ver supabase/migrations/202605220001*
// =====================================================

/** Slugs soportados. Coinciden 1:1 con `businesses.slug` en DB. */
export type BusinessSlug = "csl" | "depicenter"

/**
 * Roles propuestos en el plan multi-tenant. Por ahora solo se distingue
 * `is_superadmin` boolean en csl_user_profiles; este enum queda definido
 * para cuando se introduzca la columna `role` en una migración futura.
 */
export type UserRole = "superadmin" | "admin" | "tecnico" | "usuario"

/**
 * Representación hidratada de un negocio para el cliente. Construido a
 * partir de la fila `businesses` o del fallback local en `lib/business.ts`.
 */
export interface Business {
  id: string
  slug: BusinessSlug
  name: string
  /** Nombre corto para usar en labels compactos: "CSL", "Depicenter". */
  shortName: string
  displayName: string
  logoUrl: string
  primaryColor: string
  active: boolean
}

/**
 * Perfil del usuario tal como vive en la tabla `csl_user_profiles` (más
 * los campos derivados que el frontend necesita: businessSlug, business
 * hidratado). Hoy el sistema usa `SystemUser` en lib/security.ts; este
 * tipo paralelo es para módulos nuevos que prefieran trabajar con shape
 * más limpio y campos multi-tenant explícitos.
 */
export interface UserProfile {
  id: string
  userId: string
  email: string
  fullName: string
  role: UserRole
  businessId: string
  businessSlug: BusinessSlug
  business?: Business
  active: boolean
  isSuperadmin: boolean
}

// =====================================================
// MÓDULO CONTROL DE PULSOS
// =====================================================

export interface Operadora {
  _rowNum?: string
  OperadoraID: string
  Nombre: string
  Sucursal: string
  Estado: "Activa" | "Inactiva"
  Notas?: string
}

export interface LecturaSemanal {
  _rowNum?: string
  LecturaID: string
  FechaSemana: string       // lunes de la semana (ISO)
  EquipoID: string
  Sucursal: string
  Cabina: string
  OperadoraID: string
  LecturaInicial: number
  LecturaFinal: number
  DiferenciaReal: number    // calculado: Final - Inicial
  Observaciones?: string
}

export interface SesionCliente {
  _rowNum?: string
  SesionID: string
  Fecha: string
  Sucursal: string
  Cabina: string
  OperadoraID: string
  Cliente: string
  AreaTrabajada: string
  DisparosReportados: number
  Duracion?: number         // minutos
  EquipoID: string
  Observaciones?: string
  // Campos del Excel AgendaPro (009_pulse_import_richer.sql). Opcionales:
  // las sesiones manuales no los traen, los importados sí.
  ContactoCliente?: string
  Tratamiento?: string
  Potencia?: string
  Spot?: string
  ArchivoOrigen?: string
  FilaOrigen?: number
  /** SHA-256 determinístico para deduplicación en DB (UNIQUE parcial). */
  ImportHash?: string
}

export interface AuditoriaSemanal {
  _rowNum?: string
  AuditoriaID: string
  FechaSemana: string         // semana_inicio (lunes ISO)
  EquipoID: string
  Sucursal: string
  PulsosReales: number        // disparos_laser = LecturaFinal - LecturaInicial
  PulsosReportados: number    // suma de SesionCliente.DisparosReportados
  Diferencia: number          // PulsosReportados - PulsosReales
  PorcentajeDesviacion: number
  Alerta: "OK" | "Advertencia" | "Critico"
  Observaciones?: string
  // Campos agregados por 010_pulse_cuadre_semanal_auditoria.sql
  Cabina?: string
  SemanaFin?: string
  LecturaInicial?: number
  LecturaFinal?: number
  CreadoPor?: string           // uuid auth.users(id)
  /** Lista de archivos AgendaPro usados: [{ filename, hash?, rows? }] */
  ArchivoExcel?: Array<Record<string, unknown>>
  FotosCount?: number
  /** Origen del registro: "wizard_cuadre_semanal" cuando proviene del wizard. */
  Fuente?: string
}

/**
 * Resumen semanal de disparos por operadora (csl_operator_shots).
 * Una fila por (tenant, semana operativa, sucursal normalizada, operadora normalizada).
 */
export interface OperatorShot {
  id: string
  business_id: string
  period_start: string
  period_end: string
  period_label?: string | null
  sucursal_original?: string | null
  sucursal_normalizada: string
  operadora_original?: string | null
  operadora_normalizada: string
  sesiones: number
  disparos: number
  source_file?: string | null
  source_type?: string | null
  created_at?: string
  updated_at?: string
}

export interface DatabasePulsos {
  operadoras: Operadora[]
  lecturasSemanales: LecturaSemanal[]
  sesionesCliente: SesionCliente[]
  auditoriasSemanales: AuditoriaSemanal[]
  pulseReadings: import("./pulse-engine").PulseReading[]
  operatorShots: OperatorShot[]
}

// =====================================================
// MÓDULO COSMIATRÍA
// =====================================================

export interface ClienteCosmiatria {
  ClienteID: string
  NumeroCliente: string
  DocumentoIdentidad: string
  Email: string
  Nombre: string
  Apellido: string
  Telefono: string
  Telefono2: string
  Direccion: string
  Localidad: string
  Ciudad: string
  Region: string
  FechaNacimiento: string
  Edad: number
  Genero: string
  Sucursal: string
  PuedeAgendar: boolean
  ClienteDesde: string
  Estado: "Activo" | "Inactivo"
  Notas: string
  FichasCount?: number
  UltimaFicha?: string
  /** "AgendaPro" si vino de la sincronización; "Manual" si se creó a mano. */
  Origen?: string
  AgendaProClientId?: string
  AgendaProSyncedAt?: string
}

// =====================================================
// MÓDULO RECURSOS HUMANOS
// =====================================================

export interface SolicitudEmpleo {
  _rowNum?: string
  SolicitudID: string
  FechaSolicitud: string
  Estado: "Pendiente" | "En revisión" | "Entrevista" | "Aprobado" | "Rechazado" | "Renuncia" | "Desvinculado"
  Nombre: string
  Apellido: string
  Cedula: string
  Email: string
  Telefono: string
  FechaNacimiento: string
  Sexo: string
  Nacionalidad: string
  Provincia: string
  Ciudad: string
  Direccion: string
  PuestoSolicitado: string
  Experiencia: string
  Salario: number
  NivelEducacion: string
  Especialidad: string
  DocumentosAdjuntos: string[]
  FirmaDigital?: string
  Observaciones?: string
  FechaRevision?: string
  RevisadoPor?: string
}

export type TabId =
  | "config"
  | "panel"
  | "sucursales"
  | "equipos"
  | "tecnicos"
  | "reporte"
  | "reportes"
  | "historial-equipos"
  | "errores"
  | "inventario"
  | "credenciales"
  // Requisición de materiales por sucursal
  | "req-mat-nueva"
  | "req-mat-mis"
  | "req-mat-consolidado"
  | "req-mat-aprobaciones"
  | "req-mat-materiales"
  | "req-mat-dashboard"
  | "req-mat-inventario"
  | "req-mat-inventario-historico"
  // Módulo Compras
  | "compras-dashboard"
  | "compras-facturas"
  | "compras-pagos"
  | "compras-gastos-menores"
  | "compras-recurrentes"
  // Módulo Comisión de Ventas
  | "comision-dashboard"
  | "comision-importar"
  | "comision-sucursales"
  | "comision-prestadores"
  | "comision-productos"
  | "comision-laser"
  | "comision-clientes"
  | "comision-calculo"
  | "comision-liquidacion"
  | "comision-reglas"
  | "comision-historial"
  | "comision-reportes"
  // Módulo Pulsos
  | "pulse-dashboard"
  | "pulse-equipos"
  | "pulse-mantenimiento"
  | "pulsos-lecturas"
  | "pulsos-sesiones"
  | "pulsos-auditoria"
  | "pulsos-operadoras"
  | "pulsos-cuadre"
  // Módulo Recursos Humanos — Personal
  | "rrhh-dashboard"
  | "rrhh-empleados"
  | "rrhh-contratos"
  | "rrhh-documentos"
  // RR.HH. — Asistencia
  | "rrhh-dashboard-ponche"
  | "rrhh-ponche"
  | "rrhh-kiosko-ponche"
  | "rrhh-config-modalidades"
  | "rrhh-asistencia"
  | "rrhh-horarios"
  | "rrhh-permisos"
  // RR.HH. — Pagos
  | "rrhh-nomina"
  | "rrhh-dias-laborados"
  | "rrhh-incentivos"
  | "rrhh-vacaciones"
  | "rrhh-doble-sueldo"
  | "rrhh-prestamos"
  | "rrhh-txt-bancarios"
  // RR.HH. — Prestaciones
  | "rrhh-liquidaciones"
  | "rrhh-pdf-prestaciones"
  // RR.HH. — Desarrollo
  | "rrhh-solicitudes"
  | "rrhh-reclutamiento"
  | "rrhh-onboarding"
  | "rrhh-evaluacion"
  | "rrhh-disciplina"
  | "rrhh-capacitacion"
  | "rrhh-comunicacion"
  // RR.HH. — Reportes
  | "rrhh-reportes"
  | "rrhh-auditoria"
  | "cosmiatria-clientes"
  | "cosmiatria-ficha"
  | "consent-masajes"
  | "consent-peeling"
  | "consent-tatuajes-cejas"
  | "consent-depilacion-laser"
  | "reportes-firmados"
  // Permiso de acción (no es un tab navegable): habilita el botón
  // "Sincronizar directamente con la API" en la pantalla de Clientes.
  | "sincronizar-api"
  | "cliente-certificados"
  | "cliente-certificados-depicenter"
  | "cliente-certificados-imprimir"
  | "cliente-certificados-talonario"
  | "cliente-certificados-validez"
  // Mantenimiento — checklist de piezas pendientes/recibidas
  | "piezas-poliza"
  // Módulo Administración (solo superadmin)
  | "admin-users"
