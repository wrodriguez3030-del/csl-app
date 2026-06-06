/**
 * Mappers entre las filas de Supabase y los DTOs que consume el frontend.
 *
 * `fromDb(entity, row)` proyecta una fila al formato "PascalCase" histórico
 * que vienen esperando los componentes (ID, EquipoID, FechaSemana, etc.).
 *
 * `*ToDb(payload)` hace el camino inverso: partir del payload del cliente
 * y producir el row apto para insertar.  Cada `*ToDb` incluye fallback en
 * minúsculas y PascalCase para tolerar inconsistencias del frontend.
 */

import { ALL_MENU_IDS } from "@/lib/menus"
import { fichaDermoFromDb, fichaDermoToDb } from "@/lib/dermo-server"
import { toUpperField } from "@/lib/normalize-fields"
import {
  dateValue,
  moneyNumber,
  nombrePartes,
  numberFrom,
  onlyDigits,
  stringArrayFrom,
} from "./csl-helpers"
import type { Row } from "./csl-types"

// ---------- proyecciones DB → cliente ----------

export function fromDb(entity: string, row: Row): Row {
  switch (entity) {
    case "sucursales":
      return { Codigo: row.codigo, Nombre: row.nombre, Ciudad: row.ciudad, Direccion: row.direccion, Estado: row.estado, Notas: row.notas, Correo: row.correo }
    case "equipos":
      return {
        // business_id se expone al frontend para que el filtro superadmin
        // pueda distinguir equipos por tenant client-side.
        business_id: row.business_id,
        EquipoID: row.equipo_id, Sucursal: row.sucursal, Empresa: row.empresa, Domicilio: row.domicilio,
        Modelo: row.modelo, Serie: row.serie, Numero: row.numero,
        P_Cabeza: row.p_cabeza, P_Totales: row.p_totales, Max_Cabeza: row.max_cabeza,
        Estado: row.estado, Observaciones: row.observaciones,
        // Columnas añadidas por 202605280001_equipos_cabina_operadora.sql.
        // Nombre simplificado: `operadora` (no `operadora_nombre`) para que coincida
        // con la nomenclatura de la base de equipos importada y reducir aliasing.
        Cabina: toUpperField(row.cabina), Operadora: toUpperField(row.operadora), OperadoraID: row.operadora_id,
        // Columnas añadidas por 202605280002_equipos_pulsos_audit.sql.
        UltimaActualizacionPulsos: row.ultima_actualizacion_pulsos,
        UltimaSemanaPulsos: row.ultima_semana_pulsos,
        FallasRecientes: row.fallas_recientes,
      }
    case "tecnicos":
      return { Codigo: row.codigo, Nombre: row.nombre, Telefono: row.telefono, Correo: row.correo, Estado: row.estado, Notas: row.notas }
    case "piezas":
      return { Pieza: row.pieza, Categoria: row.categoria, Prioridad: row.prioridad, Tipo: row.tipo, Funcion: row.funcion, FallasComunes: row.fallas_comunes, Activa: row.activa }
    case "reportes":
      return { ID: row.report_id, Fecha: row.fecha, EquipoID: row.equipo_id, Sucursal: row.sucursal, Empresa: row.empresa, Cliente: row.cliente, Domicilio: row.domicilio, Ciudad: row.ciudad, Modelo: row.modelo, Serie: row.serie, Numero: row.numero, Tipo: row.tipo, EstadoEquipo: row.estado_equipo, Prioridad: row.prioridad, Problema: row.problema, Correccion: row.correccion, Observaciones: row.observaciones, Checklist: row.checklist, P_Cabeza: row.p_cabeza, P_Totales: row.p_totales, Atendio: row.atendio, PiezasJSON: row.piezas_json, PartesTexto: row.partes_texto, FirmaCliente: row.firma_cliente, FirmaTecnico: row.firma_tecnico, Fotos: row.fotos }
    case "inventario":
      return { ItemID: row.item_id, CodigoBarras: row.codigo_barras, Pieza: row.pieza, Categoria: row.categoria, Marca: row.marca, Modelo: row.modelo, NumeroParte: row.numero_parte, PrecioCompra: row.precio_compra, PrecioCompraMercado: row.precio_compra_mercado, PrecioVenta: row.precio_venta, StockRafaelVidal: row.stock_rafael_vidal, StockLosJardines: row.stock_los_jardines, StockVillaOlga: row.stock_villa_olga, StockLaVega: row.stock_la_vega, StockMinimo: row.stock_minimo, Proveedor: row.proveedor, Estado: row.estado, Observaciones: row.observaciones }
    case "operadoras":
      return { OperadoraID: row.operadora_id, Nombre: toUpperField(row.nombre), Sucursal: row.sucursal, Estado: row.estado, Notas: row.notas }
    case "lecturas_semanales":
      return { LecturaID: row.lectura_id, FechaSemana: row.fecha_semana, EquipoID: row.equipo_id, Sucursal: row.sucursal, Cabina: toUpperField(row.cabina), OperadoraID: row.operadora_id, LecturaInicial: row.lectura_inicial, LecturaFinal: row.lectura_final, DiferenciaReal: row.diferencia_real, Observaciones: row.observaciones }
    case "sesiones_cliente":
      return {
        SesionID: row.sesion_id, Fecha: row.fecha, Sucursal: row.sucursal, Cabina: toUpperField(row.cabina),
        OperadoraID: row.operadora_id, Cliente: row.cliente, AreaTrabajada: row.area_trabajada,
        DisparosReportados: row.disparos_reportados, Duracion: row.duracion, EquipoID: row.equipo_id,
        Observaciones: row.observaciones,
        // Campos del Excel AgendaPro (009_pulse_import_richer.sql).
        ContactoCliente: row.contacto_cliente, Tratamiento: row.tratamiento,
        Potencia: row.potencia, Spot: row.spot,
        ArchivoOrigen: row.archivo_origen, FilaOrigen: row.fila_origen,
        ImportHash: row.import_hash,
      }
    case "auditorias_semanales":
      return {
        AuditoriaID: row.auditoria_id, FechaSemana: row.fecha_semana,
        EquipoID: row.equipo_id, Sucursal: row.sucursal,
        PulsosReales: row.pulsos_reales, PulsosReportados: row.pulsos_reportados,
        Diferencia: row.diferencia, PorcentajeDesviacion: row.porcentaje_desviacion,
        Alerta: row.alerta, Observaciones: row.observaciones,
        // Campos agregados por 010_pulse_cuadre_semanal_auditoria.sql
        Cabina: toUpperField(row.cabina), SemanaFin: row.semana_fin,
        LecturaInicial: row.lectura_inicial, LecturaFinal: row.lectura_final,
        CreadoPor: row.creado_por, ArchivoExcel: row.archivo_excel,
        FotosCount: row.fotos_count, Fuente: row.fuente,
      }
    case "credenciales":
      return { CredencialID: row.credencial_id, Sucursal: row.sucursal, Area: row.area, Equipo: row.equipo, Sistema: row.sistema, Usuario: row.usuario, Contrasena: row.contrasena, PIN: row.pin, URL: row.url, Correo: row.correo }
    case "solicitudes_empleo":
    case "empleados":
      return { ...(row.payload_json as Row || {}), business_id: row.business_id, SolicitudID: row.solicitud_id || row.empleado_id, FechaSolicitud: row.fecha_solicitud, Estado: row.estado, PuestoSolicitado: row.puesto_solicitado, Nombre: row.nombre, Apellido: row.apellido, Cedula: row.cedula, Email: row.email, Telefono: row.telefono, FechaNacimiento: row.fecha_nacimiento, Sexo: row.sexo, Nacionalidad: row.nacionalidad, Provincia: row.provincia, Ciudad: row.ciudad, Sector: row.sector, Direccion: row.direccion, Experiencia: row.experiencia, Salario: row.salario, NivelEducacion: row.nivel_educacion, Especialidad: row.especialidad, DocumentosAdjuntos: row.documentos_adjuntos, FirmaDigital: row.firma_digital, Observaciones: row.observaciones, FechaRevision: row.fecha_revision, RevisadoPor: row.revisado_por, Sucursal: (row.payload_json as Row || {}).sucursal || (row.payload_json as Row || {}).Sucursal || "" }
    case "cosmiatria_clientes":
      return { ...(row.payload_json as Row || {}), ClienteID: row.cliente_id, NumeroCliente: row.numero_cliente, DocumentoIdentidad: row.documento_identidad, Email: row.email, Nombre: row.nombre, Apellido: row.apellido, Telefono: row.telefono, Telefono2: row.telefono2, Direccion: row.direccion, Localidad: row.localidad, Ciudad: row.ciudad, Region: row.region, FechaNacimiento: row.fecha_nacimiento, Edad: row.edad, Genero: row.genero, Sucursal: row.sucursal, PuedeAgendar: row.puede_agendar, ClienteDesde: row.cliente_desde, Estado: row.estado, Notas: row.notas, Origen: row.origen || (row.agendapro_client_id ? "AgendaPro" : "Manual"), AgendaProClientId: row.agendapro_client_id, AgendaProSyncedAt: row.agendapro_synced_at }
    case "ficha_dermatologica":
      return fichaDermoFromDb(row) as unknown as Row
    case "csl_consent_masajes":
    case "csl_consent_tatuajes_cejas":
      return {
        ...((row.payload_json as Row) || {}),
        id: row.consent_id,
        fecha: row.fecha,
        sucursal: row.sucursal,
        nombreCliente: row.nombre_cliente || row.cliente_nombre,
        documento: row.documento,
        telefono: row.telefono,
        correo: row.correo,
        direccion: row.direccion,
        fechaNacimiento: row.fecha_nacimiento,
        edad: row.edad,
        tipoProcedimiento: row.tipo_procedimiento,
        colorPigmento: row.color_pigmento || (Array.isArray(row.colores_pigmento_json) ? row.colores_pigmento_json.join(", ") : ""),
        tiempoAproximado: row.tiempo_aproximado || row.antiguedad_pigmento,
        sesionesExplicadas: row.sesiones_explicadas || row.cantidad_sesiones_previas,
        riesgosExplicados: row.riesgos_explicados || (Array.isArray(row.riesgos_aceptados_json) ? row.riesgos_aceptados_json.join(", ") : ""),
        cuidadosAntes: row.cuidados_antes || (Array.isArray(row.instrucciones_antes_json) ? row.instrucciones_antes_json.join(", ") : ""),
        cuidadosDespues: row.cuidados_despues || (Array.isArray(row.cuidados_despues_json) ? row.cuidados_despues_json.join(", ") : ""),
        zonaTratar: row.zona_tratar,
        observaciones: row.observaciones,
        firmaCliente: row.firma_cliente,
        firmaEspecialista: row.firma_especialista,
        nombreEspecialista: row.especialista || row.especialista_nombre,
        estado: row.estado,
        fechaRegistro: row.fecha_registro || row.created_at,
        // Vínculos relacionales con cliente y ficha dermatológica.
        clienteId: row.cliente_id || null,
        fichaId: row.ficha_id || null,
      }
    case "certificados_regalo":
      return { codigo: row.codigo, otorgadoA: row.otorgado_a, cortesiaDe: row.cortesia_de, validoPor: row.valido_por, fecha: row.fecha, sucursal: row.sucursal, tipo: row.tipo, firma: row.firma, emitidoEn: row.emitido_en, estado: row.estado, canjeadoEn: row.canjeado_en, notasEstado: row.notas_estado }
    case "piezas_poliza_lista":
      return {
        id: row.id,
        PiezaNombre: row.pieza_nombre,
        CategoriaSnapshot: row.categoria_snapshot,
        Cantidad: row.cantidad,
        Suplidor: row.suplidor,
        Prioridad: row.prioridad,
        Estado: row.estado,
        Sucursal: row.sucursal,
        FechaSolicitada: row.fecha_solicitada,
        FechaRecibida: row.fecha_recibida,
        Nota: row.nota,
        CreadoPor: row.creado_por,
        CreatedAt: row.created_at,
        UpdatedAt: row.updated_at,
      }
    case "certificados_depicenter":
      return {
        codigo: row.codigo,
        tipo: row.tipo,
        fecha: row.fecha,
        fechaVencimiento: row.fecha_vencimiento,
        sucursal: row.sucursal,
        otorgadoA: row.otorgado_a,
        cortesiaDe: row.cortesia_de,
        validoPor: row.valido_por,
        monto: row.monto,
        servicio: row.servicio,
        firma: row.firma,
        emitidoEn: row.emitido_en,
        emitidoPor: row.emitido_por,
        estado: row.estado,
        usadoEn: row.usado_en,
        fechaUso: row.fecha_uso,
        canceladoEn: row.cancelado_en,
        notasEstado: row.notas_estado,
        clienteNombre: row.cliente_nombre,
        clienteTelefono: row.cliente_telefono,
        clienteCorreo: row.cliente_correo,
        clienteDocumento: row.cliente_documento,
        observaciones: row.observaciones,
        marca: "Depicenter",
      }
    default:
      return row
  }
}

// ---------- mappers cliente → DB para entidades complejas ----------

export function solicitudToDb(payload: Row, keyName = "solicitud_id") {
  const id = String(payload.id ?? payload.SolicitudID ?? `sol_${Date.now()}`)
  const fechaIngresoLaboral = dateValue(payload.fechaIngresoLaboral ?? payload.FechaIngresoLaboral) || String(payload.fechaIngresoLaboral ?? payload.FechaIngresoLaboral ?? "")
  return {
    [keyName]: id,
    solicitud_id: id,
    fecha_solicitud: dateValue(payload.fecha ?? payload.FechaSolicitud),
    estado: String(payload.estado ?? payload.Estado ?? "Pendiente"),
    puesto_solicitado: String(payload.puestoSolicitado ?? payload.PuestoSolicitado ?? ""),
    nombre: String(payload.nombre ?? payload.Nombre ?? ""),
    apellido: String(payload.apellido ?? payload.Apellido ?? ""),
    cedula: String(payload.cedula ?? payload.Cedula ?? ""),
    email: String(payload.email ?? payload.Email ?? ""),
    telefono: String(payload.celular ?? payload.telefonoResidencia ?? payload.Telefono ?? ""),
    fecha_nacimiento: dateValue(payload.fechaNacimiento ?? payload.FechaNacimiento),
    sexo: String(payload.sexo ?? payload.Sexo ?? ""),
    nacionalidad: String(payload.nacionalidad ?? payload.Nacionalidad ?? ""),
    provincia: String(payload.provincia ?? payload.Provincia ?? ""),
    ciudad: String(payload.ciudad ?? payload.Ciudad ?? ""),
    sector: String(payload.sector ?? payload.Sector ?? ""),
    direccion: String(payload.direccion ?? payload.Direccion ?? ""),
    experiencia: Array.isArray(payload.experiencia) ? JSON.stringify(payload.experiencia) : String(payload.experiencia ?? payload.Experiencia ?? ""),
    salario: moneyNumber(payload.salario ?? payload.Salario ?? payload.pretensionesSalariales ?? 0),
    nivel_educacion: String(payload.nivelEducacion ?? payload.NivelEducacion ?? ""),
    especialidad: String(payload.especialidad ?? payload.Especialidad ?? ""),
    documentos_adjuntos: stringArrayFrom(payload.documentosAdjuntos ?? payload.DocumentosAdjuntos),
    firma_digital: String(payload.firma ?? payload.firmaDigital ?? payload.FirmaDigital ?? ""),
    observaciones: String(payload.observaciones ?? payload.Observaciones ?? ""),
    fecha_revision: dateValue(payload.fechaRevision ?? payload.FechaRevision),
    revisado_por: String(payload.revisadoPor ?? payload.RevisadoPor ?? ""),
    payload_json: { ...payload, id, fechaIngresoLaboral },
  }
}

function intOrNull(value: unknown) {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  const parsed = Number(raw.replace(/[^\d-]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function boolValue(value: unknown) {
  if (typeof value === "boolean") return value
  const raw = String(value ?? "").trim().toLowerCase()
  return ["si", "sí", "true", "1", "aceptado", "aceptada"].includes(raw)
}

function jsonArray(value: unknown) {
  if (Array.isArray(value)) return value
  const raw = String(value ?? "").trim()
  return raw ? [raw] : []
}

export function consentToDb(payload: Row, kind: "masajes" | "tatuajes") {
  const prefix = kind === "masajes" ? "CM" : "CTC"
  const id = String(payload.id ?? payload.ID ?? payload.consentId ?? `${prefix}-${Date.now()}`)
  const clienteId = String(payload.clienteId ?? payload.ClienteID ?? payload.cliente_id ?? "").trim() || null
  const fichaIdRaw = String(payload.fichaId ?? payload.FichaID ?? payload.ficha_id ?? "").trim()
  const fichaId = fichaIdRaw || null
  const base: Row = {
    consent_id: id,
    // Sólo incluimos las FK si hay valor: si la migración SQL aún no se ha
    // corrido, los guardados sin vínculo siguen funcionando. Una vez aplicada,
    // los valores se persisten normalmente.  Postgres mantiene NULL por
    // defecto si la columna no se incluye en el UPSERT.
    ...(clienteId ? { cliente_id: clienteId } : {}),
    ...(fichaId ? { ficha_id: fichaId } : {}),
    fecha: dateValue(payload.fecha ?? payload.Fecha),
    sucursal: String(payload.sucursal ?? payload.Sucursal ?? ""),
    nombre_cliente: String(payload.nombreCliente ?? payload.NombreCliente ?? payload.nombre ?? payload.Nombre ?? ""),
    cliente_nombre: String(payload.nombreCliente ?? payload.NombreCliente ?? payload.nombre ?? payload.Nombre ?? ""),
    documento: String(payload.documento ?? payload.Documento ?? payload.cedula ?? payload.Cedula ?? ""),
    telefono: String(payload.telefono ?? payload.Telefono ?? ""),
    correo: String(payload.correo ?? payload.Correo ?? payload.email ?? payload.Email ?? ""),
    direccion: String(payload.direccion ?? payload.Direccion ?? ""),
    fecha_nacimiento: dateValue(payload.fechaNacimiento ?? payload.FechaNacimiento),
    edad: intOrNull(payload.edad ?? payload.Edad),
    zona_tratar: String(payload.zonaTratar ?? payload.ZonaTratar ?? ""),
    observaciones: String(payload.observaciones ?? payload.Observaciones ?? ""),
    texto_consentimiento: String(payload.textoConsentimiento ?? payload.TextoConsentimiento ?? ""),
    firma_cliente: String(payload.firmaCliente ?? payload.FirmaCliente ?? ""),
    firma_especialista: String(payload.firmaEspecialista ?? payload.FirmaEspecialista ?? ""),
    especialista: String(payload.nombreEspecialista ?? payload.NombreEspecialista ?? payload.especialista ?? payload.Especialista ?? ""),
    especialista_nombre: String(payload.nombreEspecialista ?? payload.NombreEspecialista ?? payload.especialista ?? payload.Especialista ?? ""),
    estado: String(payload.estado ?? payload.Estado ?? "Pendiente"),
    fecha_registro: String(payload.fechaRegistro ?? payload.FechaRegistro ?? new Date().toISOString()),
    payload_json: { ...payload, id, clienteId, fichaId },
  }

  if (kind === "masajes") {
    return {
      ...base,
      tipo_masaje: String(payload.tipoMasaje ?? payload.TipoMasaje ?? ""),
      contraindicaciones: String(payload.contraindicaciones ?? payload.Contraindicaciones ?? ""),
      alergias: String(payload.alergias ?? payload.Alergias ?? ""),
      enfermedades_antecedentes: String(payload.enfermedadesAntecedentes ?? payload.EnfermedadesAntecedentes ?? ""),
      embarazo: String(payload.embarazo ?? payload.Embarazo ?? ""),
    }
  }

  return {
    ...base,
    tipo_procedimiento: String(payload.tipoProcedimiento ?? payload.TipoProcedimiento ?? ""),
    zona_otra_notas: String(payload.zonaOtraNotas ?? payload.ZonaOtraNotas ?? ""),
    tipo_pigmento: String(payload.tipoPigmento ?? payload.TipoPigmento ?? ""),
    tipo_pigmento_otro_notas: String(payload.tipoPigmentoOtroNotas ?? payload.TipoPigmentoOtroNotas ?? ""),
    colores_pigmento_json: jsonArray(payload.coloresPigmento ?? payload.ColoresPigmento ?? payload.colorPigmento ?? payload.ColorPigmento),
    colores_pigmento_otro_notas: String(payload.coloresPigmentoOtroNotas ?? payload.ColoresPigmentoOtroNotas ?? ""),
    antiguedad_pigmento: String(payload.antiguedadPigmento ?? payload.AntiguedadPigmento ?? payload.tiempoAproximado ?? payload.TiempoAproximado ?? ""),
    tamano_aproximado: String(payload.tamanoAproximado ?? payload.TamanoAproximado ?? ""),
    sesiones_previas: String(payload.sesionesPrevias ?? payload.SesionesPrevias ?? ""),
    cantidad_sesiones_previas: intOrNull(payload.cantidadSesionesPrevias ?? payload.CantidadSesionesPrevias),
    reaccion_previa_laser: String(payload.reaccionPreviaLaser ?? payload.ReaccionPreviaLaser ?? ""),
    observaciones_pigmento: String(payload.observacionesPigmento ?? payload.ObservacionesPigmento ?? ""),
    embarazo_lactancia: String(payload.embarazoLactancia ?? payload.EmbarazoLactancia ?? ""),
    embarazo_lactancia_notas: String(payload.embarazoLactanciaNotas ?? payload.EmbarazoLactanciaNotas ?? ""),
    alergias_notas: String(payload.alergiasNotas ?? payload.AlergiasNotas ?? ""),
    medicamentos: String(payload.medicamentos ?? payload.Medicamentos ?? ""),
    medicamentos_notas: String(payload.medicamentosNotas ?? payload.MedicamentosNotas ?? ""),
    exposicion_solar: String(payload.exposicionSolar ?? payload.ExposicionSolar ?? ""),
    exposicion_solar_notas: String(payload.exposicionSolarNotas ?? payload.ExposicionSolarNotas ?? ""),
    queloides: String(payload.queloides ?? payload.Queloides ?? ""),
    queloides_notas: String(payload.queloidesNotas ?? payload.QueloidesNotas ?? ""),
    instrucciones_antes_json: jsonArray(payload.instruccionesAntes ?? payload.InstruccionesAntes ?? payload.cuidadosAntes ?? payload.CuidadosAntes),
    cuidados_despues_json: jsonArray(payload.cuidadosDespuesJson ?? payload.CuidadosDespuesJson ?? payload.cuidadosDespues ?? payload.CuidadosDespues),
    riesgos_aceptados_json: jsonArray(payload.riesgosAceptados ?? payload.RiesgosAceptados ?? payload.riesgosExplicados ?? payload.RiesgosExplicados),
    politicas_json: jsonArray(payload.politicas ?? payload.Politicas),
    declaracion_resultados_aceptada: boolValue(payload.declaracionResultadosAceptada ?? payload.DeclaracionResultadosAceptada),
    autorizacion_fotografica_aceptada: boolValue(payload.autorizacionFotograficaAceptada ?? payload.AutorizacionFotograficaAceptada),
    autorizacion_procedimiento_aceptada: boolValue(payload.autorizacionProcedimientoAceptada ?? payload.AutorizacionProcedimientoAceptada),
    observaciones_medicas: String(payload.observacionesMedicas ?? payload.ObservacionesMedicas ?? ""),
    color_pigmento: String(payload.colorPigmento ?? payload.ColorPigmento ?? ""),
    tiempo_aproximado: String(payload.tiempoAproximado ?? payload.TiempoAproximado ?? ""),
    sesiones_explicadas: String(payload.sesionesExplicadas ?? payload.SesionesExplicadas ?? ""),
    riesgos_explicados: String(payload.riesgosExplicados ?? payload.RiesgosExplicados ?? ""),
    cuidados_antes: String(payload.cuidadosAntes ?? payload.CuidadosAntes ?? ""),
    cuidados_despues: String(payload.cuidadosDespues ?? payload.CuidadosDespues ?? ""),
  }
}

// ---------- cosmiatría ----------

function clienteCosmiatriaId(payload: Row) {
  const explicit = String(payload.ClienteID ?? payload.clienteId ?? payload.cliente_id ?? "").trim()
  if (explicit) return explicit
  const document = onlyDigits(payload.DocumentoIdentidad ?? payload.documentoIdentidad ?? payload.cedula)
  if (document) return `cli_doc_${document}`
  const phone = onlyDigits(payload.Telefono ?? payload.telefono)
  if (phone) return `cli_tel_${phone}`
  return `cli_${Date.now()}`
}

export function clienteCosmiatriaToDb(payload: Row) {
  // El nombre puede venir bajo distintas claves según el origen:
  //   - Módulo Clientes:        Nombre / Apellido por separado
  //   - Ficha Dermatológica:    nombre (string completo, sin apellido)
  //   - Consentimientos:        nombreCliente (string completo)
  // Aceptamos todas las variantes para no perder el nombre cuando un
  // consentimiento sincroniza al cliente (fix: antes se grababa "" y borraba
  // el nombre real previamente registrado).
  const rawNombre = String(
    payload.Nombre ??
    payload.nombre ??
    payload.NombreCliente ??
    payload.nombreCliente ??
    ""
  )
  const rawApellido = String(payload.Apellido ?? payload.apellido ?? "")
  const parsedName = nombrePartes(rawNombre)
  const nombre = rawApellido ? rawNombre : parsedName.nombre
  const apellido = rawApellido || parsedName.apellido
  const id = clienteCosmiatriaId(payload)
  const today = new Date().toISOString().slice(0, 10)
  return {
    cliente_id: id,
    numero_cliente: String(payload.NumeroCliente ?? payload.numeroCliente ?? id.replace(/^cli_(doc|tel)_/, "")),
    documento_identidad: String(payload.DocumentoIdentidad ?? payload.documentoIdentidad ?? payload.cedula ?? payload.Cedula ?? ""),
    email: String(payload.Email ?? payload.email ?? ""),
    nombre,
    apellido,
    telefono: String(payload.Telefono ?? payload.telefono ?? ""),
    telefono2: String(payload.Telefono2 ?? payload.telefono2 ?? ""),
    direccion: String(payload.Direccion ?? payload.direccion ?? ""),
    localidad: String(payload.Localidad ?? payload.localidad ?? ""),
    ciudad: String(payload.Ciudad ?? payload.ciudad ?? ""),
    region: String(payload.Region ?? payload.region ?? ""),
    fecha_nacimiento: dateValue(payload.FechaNacimiento ?? payload.fechaNacimiento),
    edad: numberFrom(payload, "Edad", Number(payload.edad ?? 0)),
    genero: String(payload.Genero ?? payload.genero ?? ""),
    sucursal: String(payload.Sucursal ?? payload.sucursal ?? ""),
    puede_agendar: payload.PuedeAgendar ?? payload.puedeAgendar ?? true,
    cliente_desde: dateValue(payload.ClienteDesde ?? payload.clienteDesde) || today,
    estado: String(payload.Estado ?? payload.estado ?? "Activo"),
    notas: String(payload.Notas ?? payload.notas ?? ""),
    payload_json: { ...payload, ClienteID: id, clienteId: id },
  }
}

export function mergeClienteRows(existing: Row | null | undefined, incoming: Row) {
  if (!existing) return incoming
  const merged = { ...existing, ...incoming }
  // No destructivo: si el incoming trae un campo vacío y el existing lo tenía
  // poblado, conservamos lo viejo. CRÍTICO para `nombre` y `apellido`: un
  // consentimiento puede sincronizar al cliente sin nombre completo y no
  // queremos borrar el nombre previamente registrado.
  for (const key of [
    "nombre",
    "apellido",
    "documento_identidad",
    "email",
    "telefono",
    "telefono2",
    "direccion",
    "localidad",
    "region",
    "ciudad",
    "fecha_nacimiento",
    "genero",
    "sucursal",
    "notas",
    "numero_cliente",
  ] as const) {
    const value = incoming[key]
    if ((value === "" || value === null || value === undefined) && existing[key]) {
      merged[key] = existing[key]
    }
  }
  merged.payload_json = { ...((existing.payload_json as Row) || {}), ...((incoming.payload_json as Row) || {}) }
  return merged
}

function fichaClientPatchFromCliente(cliente: Row) {
  const nombreCompleto = [cliente.nombre, cliente.apellido].map((value) => String(value || "").trim()).filter(Boolean).join(" ")
  return {
    clienteId: cliente.cliente_id,
    cliente_id: cliente.cliente_id,
    nombre: nombreCompleto || cliente.nombre || "",
    telefono: cliente.telefono || "",
    cedula: cliente.documento_identidad || "",
    email: cliente.email || "",
    ciudad: cliente.ciudad || "",
    sucursal: cliente.sucursal || "",
    edad: cliente.edad ? String(cliente.edad) : "",
  }
}

export { fichaClientPatchFromCliente }

// ---------- ficha dermatológica (re-export pasarela) ----------

export { fichaDermoToDb, fichaDermoFromDb }

// ---------- perfil del usuario ----------

export function profileToUser(row: Row): Row {
  const isAdmin = Boolean(row.is_admin)
  return {
    id: row.user_id,
    nombre: row.nombre,
    username: row.username,
    password: "",
    activo: row.activo !== false,
    isAdmin,
    menus: isAdmin ? [...ALL_MENU_IDS] : stringArrayFrom(row.menus),
    createdAt: row.created_at,
  }
}
