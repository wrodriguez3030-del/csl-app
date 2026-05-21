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
  EquipoID: string
  Sucursal: string
  Empresa: string
  Domicilio?: string
  Modelo: string
  Serie?: string
  Numero?: string
  P_Cabeza?: number
  P_Totales?: number
  Max_Cabeza?: number
  Estado: "Activo" | "Inactivo"
  Observaciones?: string
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
}

export interface AuditoriaSemanal {
  _rowNum?: string
  AuditoriaID: string
  FechaSemana: string
  EquipoID: string
  Sucursal: string
  PulsosReales: number      // de LecturaSemanal.DiferenciaReal
  PulsosReportados: number  // suma de SesionCliente.DisparosReportados
  Diferencia: number        // PulsosReales - PulsosReportados
  PorcentajeDesviacion: number
  Alerta: "OK" | "Advertencia" | "Critico"
  Observaciones?: string
}

export interface DatabasePulsos {
  operadoras: Operadora[]
  lecturasSemanales: LecturaSemanal[]
  sesionesCliente: SesionCliente[]
  auditoriasSemanales: AuditoriaSemanal[]
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
}

// =====================================================
// MÓDULO RECURSOS HUMANOS
// =====================================================

export interface SolicitudEmpleo {
  _rowNum?: string
  SolicitudID: string
  FechaSolicitud: string
  Estado: "Pendiente" | "En revisión" | "Entrevista" | "Aprobado" | "Rechazado"
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
  // Módulo Pulsos
  | "pulse-dashboard"
  | "pulse-equipos"
  | "pulse-mantenimiento"
  | "pulsos-lecturas"
  | "pulsos-sesiones"
  | "pulsos-auditoria"
  | "pulsos-operadoras"
  // Módulo Recursos Humanos
  | "rrhh-solicitudes"
  | "rrhh-empleados"
  | "cosmiatria-clientes"
  | "cosmiatria-ficha"
  | "consent-masajes"
  | "consent-tatuajes-cejas"
  | "reportes-firmados"
  | "cliente-certificados"
  | "cliente-certificados-depicenter"
  | "cliente-certificados-imprimir"
  | "cliente-certificados-talonario"
  | "cliente-certificados-validez"
