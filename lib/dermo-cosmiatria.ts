export interface FichaDermoCosmiatrica {
  id: string
  clienteId?: string
  fecha: string
  sucursal: string
  operadora: string
  especialista: string
  nombre: string
  documento: string
  fechaNacimiento: string
  direccion: string
  edad: string
  ciudad: string
  telefono: string
  ocupacion: string
  motivoConsulta: string
  tipoPiel: string
  estadoGeneralPiel: string
  sensibilidad: string
  hidratacion: string
  manchas: string
  acne: string
  rosacea: string
  melasma: string
  cicatrices: string
  lesionesVisibles: string
  irritacion: string
  observacionesPiel: string
  antecedentesMedicos: string[]
  antecedentesMedicosNotas: string
  alergiasNotas: string
  medicamentosNotas: string
  medicamentosFotosensibilizantes: string
  medicamentosFotosensibilizantesNotas: string
  embarazo: string
  embarazoNotas: string
  lactancia: string
  lactanciaNotas: string
  pielSensible: string
  pielSensibleNotas: string
  queloides: string
  queloidesNotas: string
  heridasActivas: string
  heridasActivasNotas: string
  exposicionSolar: string
  exposicionSolarNotas: string
  retinoidesAcidos: string
  retinoidesAcidosNotas: string
  tratamientosFacialesPrevios: string
  laserPrevio: string
  peelingPrevio: string
  limpiezaFacialPrevia: string
  rellenosBotoxRecientes: string
  cirugiasEsteticasRecientes: string
  usoAcidosRetinoides: string
  fechaUltimoTratamiento: string
  tratamientosPreviosNotas: string
  observacionesProfesionales: string
  recomendaciones: string
  cuidadosSugeridos: string
  recomiendaProcedimiento: string
  proximaEvaluacion: string
  declaracionAceptada: boolean
  alcohol: string
  cigarrillos: string
  cafe: string
  calidadSueno: string
  vasosAgua: string
  fototipo: string
  biotipo: string
  grasa: string
  seca: string
  textura: string
  colorPiel: string
  medicamentos: string
  medicamentosCuales: string
  medicamentoTopico: string
  medicamentoTopicoCuales: string
  alergias: string
  alergiasCuales: string
  cirugias: string
  cirugiasCuales: string
  cancerPiel: string
  cancerPielCuales: string
  herpes: string
  cosmeticoActual: string
  cosmeticoActualCuales: string
  toleraCosmeticos: string
  depilaLaser: string
  reaccionLaser: string
  reaccionClima: string
  embarazada: string
  seObserva: string[]
  tratamientosPrevios: string[]
  modificacionesPigmentarias: string[]
  lentigoSolar: string[]
  involucionCutanea: string[]
  texturaAlteraciones: string[]
  lipidizacionCutanea: string[]
  observaciones: string
  cedula: string
  email: string
  firma: string
  firmaEspecialista: string
  nombreEspecialista: string
  fechaRegistro: string
  estado: "Pendiente" | "Pendiente de revisión" | "Completada" | "Archivada"
  empresaOculta?: string
}

export const emptyFichaDermo: FichaDermoCosmiatrica = {
  id: "",
  fecha: new Date().toISOString().slice(0, 10),
  sucursal: "",
  operadora: "",
  especialista: "",
  nombre: "",
  documento: "",
  fechaNacimiento: "",
  direccion: "",
  edad: "",
  ciudad: "",
  telefono: "",
  ocupacion: "",
  motivoConsulta: "",
  tipoPiel: "",
  estadoGeneralPiel: "",
  sensibilidad: "",
  hidratacion: "",
  manchas: "",
  acne: "",
  rosacea: "",
  melasma: "",
  cicatrices: "",
  lesionesVisibles: "",
  irritacion: "",
  observacionesPiel: "",
  antecedentesMedicos: [],
  antecedentesMedicosNotas: "",
  alergiasNotas: "",
  medicamentosNotas: "",
  medicamentosFotosensibilizantes: "",
  medicamentosFotosensibilizantesNotas: "",
  embarazo: "",
  embarazoNotas: "",
  lactancia: "",
  lactanciaNotas: "",
  pielSensible: "",
  pielSensibleNotas: "",
  queloides: "",
  queloidesNotas: "",
  heridasActivas: "",
  heridasActivasNotas: "",
  exposicionSolar: "",
  exposicionSolarNotas: "",
  retinoidesAcidos: "",
  retinoidesAcidosNotas: "",
  tratamientosFacialesPrevios: "",
  laserPrevio: "",
  peelingPrevio: "",
  limpiezaFacialPrevia: "",
  rellenosBotoxRecientes: "",
  cirugiasEsteticasRecientes: "",
  usoAcidosRetinoides: "",
  fechaUltimoTratamiento: "",
  tratamientosPreviosNotas: "",
  observacionesProfesionales: "",
  recomendaciones: "",
  cuidadosSugeridos: "",
  recomiendaProcedimiento: "",
  proximaEvaluacion: "",
  declaracionAceptada: false,
  alcohol: "",
  cigarrillos: "",
  cafe: "",
  calidadSueno: "",
  vasosAgua: "",
  fototipo: "",
  biotipo: "",
  grasa: "",
  seca: "",
  textura: "",
  colorPiel: "",
  medicamentos: "",
  medicamentosCuales: "",
  medicamentoTopico: "",
  medicamentoTopicoCuales: "",
  alergias: "",
  alergiasCuales: "",
  cirugias: "",
  cirugiasCuales: "",
  cancerPiel: "",
  cancerPielCuales: "",
  herpes: "",
  cosmeticoActual: "",
  cosmeticoActualCuales: "",
  toleraCosmeticos: "",
  depilaLaser: "",
  reaccionLaser: "",
  reaccionClima: "",
  embarazada: "",
  seObserva: [],
  tratamientosPrevios: [],
  modificacionesPigmentarias: [],
  lentigoSolar: [],
  involucionCutanea: [],
  texturaAlteraciones: [],
  lipidizacionCutanea: [],
  observaciones: "",
  cedula: "",
  email: "",
  firma: "",
  firmaEspecialista: "",
  nombreEspecialista: "",
  fechaRegistro: "",
  estado: "Pendiente",
  empresaOculta: "",
}

export const siNoOpciones = ["Si", "No"]
export const calidadSuenoOpciones = ["Normal", "Mala", "Buena"]
export const sucursalesCosmiatria = ["Rafael Vidal", "Los Jardines", "Villa Olga", "La Vega"]
export const fototipoOpciones = [
  "I - Muy clara, siempre se quema",
  "II - Clara, se quema con facilidad",
  "III - Intermedia, se broncea gradualmente",
  "IV - Morena clara, rara vez se quema",
  "V - Morena oscura, casi nunca se quema",
  "VI - Muy oscura, no se quema",
]
export const tipoPielOpciones = ["Normal", "Seca", "Grasa", "Mixta", "Sensible", "Acnéica", "Madura"]
export const estadoGeneralPielOpciones = ["Normal", "Deshidratada", "Irritada", "Congestionada", "Fotoenvejecida", "Con manchas", "Con lesiones"]
export const sensibilidadOpciones = ["Baja", "Media", "Alta", "Muy alta"]
export const hidratacionOpciones = ["Buena", "Regular", "Baja", "Muy baja"]
export const antecedentesMedicosOpciones = [
  "Diabetes",
  "Hipertensión",
  "Problemas cardíacos",
  "Problemas hormonales",
  "Problemas circulatorios",
  "Enfermedades autoinmunes",
  "Cáncer o tratamiento oncológico",
  "Epilepsia",
  "Herpes",
  "Infecciones activas",
  "Cirugías recientes",
  "Tratamientos dermatológicos recientes",
  "Otro",
]
export const biotipoOpciones = ["Eudérmica", "Mixta", "Sensible"]
export const grasaOpciones = ["Oleosa", "Deshidratada", "Asfíctica"]
export const secaOpciones = ["Deshidratada", "A lipídica"]
export const texturaOpciones = ["Untuosa", "Lisa", "Áspera", "Rugosa"]
export const colorPielOpciones = ["Normal", "Pálido", "Rojizo", "Amarillento", "Pigmentado", "Melasma"]
export const seObservaOpciones = ["Lupus", "Dermatomiositis", "Herpes", "Esclerodermia", "Crest"]
export const tratamientosPreviosOpciones = ["Limpiezas de cutis", "Peeling", "Láser", "Toxina botulínica", "Implantes", "Hilos tensores", "Carboxiterapia", "Mesoterapia", "Lipoaspiración", "MDA", "IPL", "RF", "Otros"]
export const pigmentariasOpciones = ["Efides o pecas", "Lunares", "Mácula", "Melasma", "Discromías"]
export const lentigoOpciones = ["Rosácea", "Telangiectasias", "Pigmentación post inflamatoria"]
export const involucionOpciones = ["Arrugas", "Cicatriz", "Flacidez", "Surcos", "Pliegues"]
export const texturaAlteracionesOpciones = ["Queratosis descamativa", "Elastoidosis nodular", "Queratosis actínicas", "Queratosis seborreica", "Poiquilotermia"]
export const lipidizacionOpciones = ["Comedones", "Millium", "Seborrea", "Pápulas", "Pústulas", "Quistes"]
