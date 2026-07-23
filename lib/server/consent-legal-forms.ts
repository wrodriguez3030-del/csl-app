/**
 * Contenido legal + builders de PDF para los consentimientos de Masajes, Peeling
 * y Eliminación de Tatuajes/Cejas. Reutiliza el motor genérico `buildConsentPdf`
 * (mismo estilo que el de Depilación Láser). El texto legal es FIJO y está portado
 * 1:1 del documento que genera el navegador (`buildPrintHtml` de cada formulario).
 *
 * SOLO servidor.
 */
import { buildConsentPdf, plain, bullets, type Section } from "@/lib/server/consent-depilacion-pdf"

type Row = Record<string, unknown>

// ── MASAJES ──────────────────────────────────────────────────────────────────
const MASAJE_SECTIONS: Section[] = [
  { title: "Procedimiento", blocks: [{ kind: "p", runs: plain("Masajes.") }] },
  {
    title: "Descripción del procedimiento",
    blocks: [{ kind: "p", runs: plain("Los masajes son técnicas diseñadas para mejorar el bienestar físico y mental. Estos procedimientos pueden ayudar a relajar la musculatura, aliviar tensiones, mejorar la circulación y promover una sensación general de bienestar, de acuerdo con las necesidades del cliente y las recomendaciones del personal especializado.") }],
  },
  {
    title: "Declaraciones del cliente",
    blocks: [{
      kind: "list", ordered: true, items: bullets([
        "Confirmo que Cibao Spa Láser me ha explicado detalladamente, en palabras comprensibles para mí, el efecto y la naturaleza del procedimiento a realizar, incluyendo posibles riesgos, molestias, alternativas de tratamiento cuando existan y cuidados posteriores. Todas las preguntas que he formulado libremente sobre el procedimiento han sido contestadas a mi satisfacción.",
        "Acepto y consiento que, al firmar cada sesión recibida, estaré firmando además el consentimiento informado del tratamiento correspondiente.",
        "Comprendo que los resultados están relacionados directamente con la respuesta individual de mi organismo y con las técnicas aplicadas.",
        "Consiento aportar datos personales antes y después del tratamiento, siendo este material de diagnóstico, registro e historia clínica, propiedad de Cibao Spa Láser.",
        "Acepto que Cibao Spa Láser pueda retrasar o suspender el procedimiento si lo considera necesario.",
        "Me comprometo a seguir fielmente, en la mejor medida de mis posibilidades, las instrucciones impartidas por Cibao Spa Láser antes, durante y después del procedimiento.",
        "Entiendo que el personal médico, especialistas y asistentes se basarán en las declaraciones hechas por mí para determinar si el procedimiento puede ser seguro y efectivo para mi persona.",
      ]),
    }],
  },
  {
    title: "Instrucciones antes del procedimiento",
    blocks: [{
      kind: "list", items: bullets([
        "Se recomienda llegar al menos 15 minutos antes de la cita para registrarse, completar cualquier información necesaria y relajarse antes del masaje.",
        "Durante la consulta inicial, informar de manera honesta sobre necesidades, preocupaciones y condiciones médicas.",
        "Informar al terapeuta sobre cualquier condición médica, lesión, dolor muscular, problema de piel o antecedente de salud relevante.",
        "Asegurarse de estar bien hidratado antes del masaje, tomando agua en las horas previas.",
        "Si va a comer antes del procedimiento, optar por una comida ligera.",
        "Evitar comidas pesadas o grasosas que puedan causar incomodidad durante el masaje.",
        "Se recomienda no ingerir alimentos al menos dos horas antes del procedimiento.",
        "Usar ropa cómoda y ligera al llegar al spa.",
        "Si es posible, tomar una ducha antes de la cita para sentirse fresco y limpio.",
        "Evitar alcohol y drogas antes del masaje, ya que pueden afectar la percepción del dolor y la capacidad de relajación.",
        "Dedicar unos minutos a relajarse mentalmente antes del procedimiento.",
        "Practicar respiraciones profundas o visualizar un lugar tranquilo antes de iniciar.",
        "Apagar o silenciar el teléfono móvil para mantener un ambiente calmado.",
        "Mantener silencio en áreas compartidas y respetar la privacidad de otros clientes.",
        "Comunicar al terapeuta cualquier preferencia sobre presión del masaje, áreas a trabajar, áreas a evitar o técnicas deseadas.",
      ]),
    }],
  },
  {
    title: "Contraindicaciones",
    blocks: [
      { kind: "p", runs: plain("El cliente reconoce que existen condiciones en las que algunos tipos de masajes pueden no ser recomendables o deben realizarse con precaución, incluyendo:") },
      {
        kind: "list", items: bullets([
          "Embarazo: algunos tipos de masajes no son recomendables durante el embarazo, especialmente masajes reductores.",
          "Enfermedades infecciosas: infecciones en la piel o enfermedades contagiosas pueden empeorar con el masaje y representar riesgo para el terapeuta u otros clientes.",
          "Fracturas y lesiones recientes: las áreas afectadas por fracturas, esguinces o lesiones recientes deben evitar masajes hasta sanar completamente.",
          "Problemas circulatorios: personas con trombosis venosa profunda, várices severas u otros trastornos circulatorios deben evitar masajes intensos.",
          "Cáncer: personas en tratamiento oncológico o con diagnóstico reciente deben consultar a su médico antes de recibir masaje.",
          "Enfermedades cardíacas o hipertensión: ciertos masajes pueden aumentar la frecuencia cardíaca o la presión arterial.",
          "Piel sensible o lesiones cutáneas: condiciones como dermatitis, eczema, quemaduras o lesiones pueden agravarse con fricción o presión.",
          "Fiebre o malestar general: realizar masaje durante un episodio febril o malestar puede afectar la recuperación.",
          "Uso de medicamentos anticoagulantes: quienes toman medicamentos que afectan la coagulación deben evitar masajes intensos.",
          "Problemas psicológicos severos: personas con ansiedad severa, PTSD u otras condiciones pueden sentirse incómodas con el contacto físico sin la debida precaución.",
        ]),
      },
    ],
  },
  {
    title: "Políticas y procedimientos",
    blocks: [{
      kind: "list", items: bullets([
        "Reservas y cancelaciones deben realizarse con 48 horas de antelación.",
        "Horario: lunes a viernes de 9:00 a.m. a 8:00 p.m. y sábados de 8:00 a.m. a 4:00 p.m.",
        "Si la cancelación o reprogramación no es comunicada, la sesión se dará por realizada.",
        "Los pagos pueden realizarse en efectivo, transferencia o tarjeta de crédito.",
        "Los precios en Cibao Spa Láser no incluyen ITBIS.",
        "El tiempo de la cita no puede extenderse si afecta el itinerario programado.",
        "Si el retraso es responsabilidad del centro, el tiempo será repuesto.",
        "Si el retraso es responsabilidad del cliente, será atendido solo durante el tiempo restante de su cita.",
      ]),
    }],
  },
  {
    title: "Protección de datos",
    blocks: [{ kind: "p", runs: plain("Cibao Spa Láser podrá enviar información, respuestas a consultas y contactos generales mientras dure nuestra relación y cuente con el consentimiento del destinatario. Los datos personales no serán cedidos a terceros, salvo obligación legal.") }],
  },
  {
    title: "Autorización",
    blocks: [
      { kind: "p", runs: plain("He sido informado/a sobre el procedimiento de masajes, incluyendo sus riesgos, posibles molestias, contraindicaciones y beneficios. He tenido la oportunidad de hacer preguntas y he recibido respuestas satisfactorias.") },
      { kind: "p", runs: plain("Entiendo que los resultados pueden variar de una persona a otra.") },
      { kind: "p", runs: plain("Doy mi consentimiento para realizar el procedimiento en Cibao Spa Láser y libero a Cibao Spa Láser y a su personal de cualquier responsabilidad legal, penal o civil en caso de complicaciones que puedan surgir durante o después del tratamiento, siempre que se haya actuado conforme a los protocolos establecidos.") },
    ],
  },
  {
    title: "Declaración y firma",
    blocks: [{ kind: "p", runs: plain("Declaro que he leído, comprendido y acepto el contenido de este consentimiento informado. Confirmo que la información suministrada es verdadera y completa, y autorizo a Cibao Spa Láser y a su personal a realizar el procedimiento descrito.") }],
  },
]

export async function buildConsentMasajePdf(row: Row, businessName = "Cibao Spa Laser"): Promise<Buffer> {
  return buildConsentPdf(row, businessName, {
    title: "CONSENTIMIENTO INFORMADO PARA MASAJES",
    especialistaLabel: "Especialista en masajes",
    footerLabel: "Consentimiento Masajes",
    sections: MASAJE_SECTIONS,
  })
}

// ── PEELING ──────────────────────────────────────────────────────────────────
const PEELING_SECTIONS: Section[] = [
  { title: "Procedimiento", blocks: [{ kind: "p", runs: plain("Requiero y autorizo a Cibao Spa Láser para que el personal calificado realice en mi persona el tratamiento estético de PEELING, previa evaluación y según mi condición de piel.") }] },
  {
    title: "Propósito del procedimiento",
    blocks: [{
      kind: "list", items: bullets([
        "Favorecer la renovación celular de la piel.",
        "Mejorar la textura, luminosidad y apariencia general del rostro o zona tratada.",
        "Ayudar a disminuir manchas superficiales, poros obstruidos, grasa, comedones, marcas leves de acné o líneas finas, según el tipo de piel y el protocolo aplicado.",
        "Preparar y complementar otros tratamientos estéticos cuando el personal calificado lo considere adecuado.",
      ]),
    }],
  },
  {
    title: "Descripción del procedimiento",
    blocks: [{ kind: "p", runs: plain("El peeling consiste en la aplicación controlada de productos exfoliantes, despigmentantes, enzimáticos o químicos sobre la piel, con el objetivo de producir una renovación superficial o media según la evaluación realizada. Durante el tratamiento puedo sentir ardor, calor, picor, tirantez o molestia temporal. La intensidad del procedimiento dependerá del tipo de piel, sensibilidad, condición tratada y criterio del personal calificado.") }],
  },
  {
    title: "Riesgos, molestias y posibles complicaciones",
    blocks: [{
      kind: "list", items: bullets([
        "Enrojecimiento, ardor, picor, sensibilidad, tirantez, inflamación o calor temporal en la zona tratada.",
        "Resequedad, descamación, costras superficiales o sensación de piel áspera durante los días posteriores.",
        "Oscurecimiento o aclaramiento temporal de la piel, especialmente con exposición al sol o sin protector solar.",
        "Irritación, brote de acné, dermatitis, reacción alérgica o sensibilidad a alguno de los productos utilizados.",
        "Reactivación de herpes en personas con antecedentes de herpes labial o lesiones herpéticas.",
        "Quemaduras superficiales, ampollas, infección, manchas persistentes, cicatrices o cambios de pigmentación (poco frecuentes).",
        "Insatisfacción con los resultados o necesidad de varias sesiones para lograr el objetivo deseado.",
      ]),
    }],
  },
  {
    title: "Contraindicaciones o condiciones que debo informar",
    blocks: [{
      kind: "list", items: bullets([
        "Embarazo, sospecha de embarazo o lactancia.",
        "Uso actual o reciente de isotretinoína, retinoides, ácidos exfoliantes, despigmentantes fuertes o medicamentos fotosensibilizantes.",
        "Herpes activo, heridas abiertas, quemaduras solares, irritación severa, dermatitis, infección cutánea o enfermedad activa de la piel en la zona a tratar.",
        "Alergia conocida a ácidos, productos cosméticos, anestésicos tópicos, despigmentantes o cualquier componente del tratamiento.",
        "Tendencia a cicatrización queloide, manchas postinflamatorias o antecedentes de cicatrices anormales.",
        "Exposición solar intensa, cámaras de bronceado o bronceado reciente.",
        "Tratamientos oncológicos, inmunosupresión, diabetes no controlada, enfermedades autoinmunes, anticoagulantes o condiciones médicas que puedan contraindicar el procedimiento.",
        "Procedimientos recientes en la zona como láser, depilación con cera, microdermoabrasión, dermapen, cirugía, rellenos o toxina botulínica que deban evaluarse antes.",
        "No se realizará peeling si la zona está recién rasurada o recién depilada.",
        "Debe haber transcurrido al menos 1 semana desde el rasurado de la zona a tratar.",
        "Debe haber transcurrido un mínimo de 45 días desde cualquier tratamiento láser realizado en la zona.",
        "Suspender la depilación con cera antes y durante el protocolo de peeling, según indicación de la especialista.",
        "Zona con sensibilidad, irritación, ardor, inflamación, heridas, quemadura solar o reacción activa.",
      ]),
    }],
  },
  {
    title: "Cuidados antes del peeling",
    blocks: [{
      kind: "list", items: bullets([
        "Evitar exposición solar intensa o bronceado antes del procedimiento.",
        "Suspender exfoliantes, retinoides, ácidos, productos irritantes o despigmentantes fuertes según indicación de la especialista.",
        "Informar si estoy usando medicamentos, cremas medicadas, tratamientos dermatológicos o si me he realizado procedimientos recientes.",
        "Asistir con la piel limpia, sin maquillaje pesado, sin cremas irritantes y sin lesiones activas en la zona a tratar.",
        "Si tengo antecedentes de herpes labial, debo informarlo para recibir orientación preventiva antes del tratamiento.",
      ]),
    }],
  },
  {
    title: "Cuidados después del peeling",
    blocks: [{
      kind: "list", items: bullets([
        "Usar protector solar de amplio espectro y reaplicarlo durante el día, especialmente si hay exposición a luz solar o calor.",
        "Evitar sol directo, bronceado, sauna, vapor, piscina, playa, ejercicio intenso o calor excesivo por el tiempo indicado por la especialista.",
        "No retirar costras, no halar la descamación y no rascar la zona tratada.",
        "Mantener la piel hidratada con los productos recomendados y evitar productos irritantes hasta recibir autorización.",
        "No usar exfoliantes, retinoides, ácidos, despigmentantes fuertes, perfumes o maquillaje irritante durante los días indicados.",
        "Informar de inmediato a Cibao Spa Láser si presento dolor intenso, ampollas, secreción, inflamación severa, manchas marcadas, fiebre, infección o cualquier reacción fuera de lo esperado.",
      ]),
    }],
  },
  {
    title: "Políticas y procedimientos",
    blocks: [{
      kind: "list", items: bullets([
        "Reservas, cancelaciones o reprogramaciones deben comunicarse con 48 horas de antelación; de lo contrario la sesión podrá darse por realizada.",
        "Horario: lunes a viernes de 9:00 a.m. a 8:00 p.m.; sábados de 9:00 a.m. a 4:00 p.m.; domingos cerrado.",
        "Los pagos se realizan en efectivo, transferencia o tarjeta de crédito. Los precios no incluyen ITBIS.",
        "El tiempo de la cita no puede extenderse bajo ningún motivo porque perjudica el itinerario programado.",
        "Si hay retraso por responsabilidad del centro, el tiempo será repuesto; si el retraso es del cliente, se atenderá solo el tiempo restante.",
        "La validez de servicios prepagados será según las políticas comerciales vigentes al momento de la compra.",
      ]),
    }],
  },
  {
    title: "Protección de datos",
    blocks: [{ kind: "p", runs: plain("Cibao Spa Láser podrá enviar información, respuestas a consultas y contactos relacionados con nuestros servicios mientras dure nuestra relación y tengamos su consentimiento como destinatario. No se cederán datos a terceros salvo obligación legal.") }],
  },
  {
    title: "Declaración y firma",
    blocks: [{ kind: "p", runs: plain("He podido aclarar todas mis dudas y he entendido totalmente este documento de consentimiento informado para peeling, reafirmándome en todos y cada uno de sus puntos. Confirmo que la información suministrada es verdadera y completa, y autorizo a Cibao Spa Láser y a su personal a realizar el procedimiento descrito.") }],
  },
]

export async function buildConsentPeelingPdf(row: Row, businessName = "Cibao Spa Laser"): Promise<Buffer> {
  return buildConsentPdf(row, businessName, {
    title: "CONSENTIMIENTO INFORMADO PARA PEELING",
    footerLabel: "Consentimiento Peeling",
    sections: PEELING_SECTIONS,
  })
}

// ── ELIMINACIÓN DE TATUAJES Y CEJAS ──────────────────────────────────────────
const TATUAJE_SECTIONS: Section[] = [
  { title: "Procedimiento", blocks: [{ kind: "p", runs: plain("Eliminación de tatuajes y cejas.") }] },
  {
    title: "Descripción del procedimiento",
    blocks: [{ kind: "p", runs: plain("La eliminación de tatuajes y cejas es un tratamiento que utiliza tecnología láser para romper los pigmentos en la piel, permitiendo que el cuerpo los elimine de forma natural. Este procedimiento puede requerir múltiples sesiones según las características del tatuaje o del microblading de cejas.") }],
  },
  {
    title: "Declaraciones del cliente",
    blocks: [{
      kind: "list", ordered: true, items: bullets([
        "Confirmo que Cibao Spa Láser me ha explicado detalladamente, en palabras comprensibles para mí, el efecto y la naturaleza del o los procedimientos a realizar, incluyendo posibles riesgos, molestias, alternativas de tratamiento cuando existan y cuidados posteriores. Todas las preguntas que he formulado libremente sobre el procedimiento han sido contestadas a mi satisfacción.",
        "Acepto y consiento que, al firmar cada sesión recibida, estaré firmando además el consentimiento informado del tratamiento correspondiente.",
        "Comprendo que los procesos estéticos no son una ciencia exacta y que nadie puede garantizar la perfección absoluta. Se me han informado los riesgos, posibles complicaciones y efectos secundarios relacionados con la eliminación de tatuajes y cejas mediante láser.",
        "Entiendo que el procedimiento solicitado tiene como objetivo mejorar mi apariencia física.",
        "Comprendo que los resultados están relacionados directamente con la capacidad de mi organismo para eliminar los pigmentos o materiales aplicados en la piel.",
        "Consiento aportar datos personales antes y después del tratamiento, siendo este material de diagnóstico, registro e historia clínica, propiedad de Cibao Spa Láser.",
        "Acepto que Cibao Spa Láser pueda retrasar o suspender el procedimiento si lo considera necesario.",
        "Me comprometo a seguir fielmente, en la mejor medida de mis posibilidades, las instrucciones impartidas por Cibao Spa Láser antes, durante y después del procedimiento.",
        "Entiendo que el personal médico, especialistas y asistentes se basarán en las declaraciones hechas por mí para determinar si el procedimiento puede ser seguro y efectivo para mi persona.",
        "Entiendo que la eliminación de tatuajes y cejas mediante tratamiento con láser no es una ciencia exacta y que no se me pueden ofrecer garantías absolutas en cuanto a los resultados de este procedimiento.",
      ]),
    }],
  },
  {
    title: "Instrucciones antes del procedimiento",
    blocks: [{
      kind: "list", items: bullets([
        "Evitar la exposición al sol en el área a tratar durante al menos dos semanas antes del procedimiento. La piel bronceada puede aumentar el riesgo de efectos secundarios.",
        "No utilizar cremas bronceadoras ni autobronceadores en la zona afectada al menos dos semanas antes del tratamiento.",
        "Informar al médico o especialista sobre cualquier medicamento que esté tomando, especialmente anticoagulantes, o si tiene algún tratamiento de piel en curso.",
        "Evitar el uso de antiinflamatorios, como aspirina o ibuprofeno, y alcohol 48 horas antes del procedimiento para reducir el riesgo de sangrado y hematomas.",
        "No aplicar cremas, lociones ni maquillaje en el área que será tratada el día del procedimiento.",
        "Mantener la piel bien hidratada en los días previos al procedimiento, salvo indicación contraria.",
        "Informar al profesional sobre cualquier alergia, especialmente a anestésicos locales o productos similares que puedan usarse durante el procedimiento.",
        "Considerar llevar acompañante si se siente ansiedad o preocupación por el procedimiento.",
        "Descansar adecuadamente la noche anterior al procedimiento.",
        "Preparar cualquier pregunta que desee realizar al profesional antes del procedimiento.",
      ]),
    }],
  },
  {
    title: "Cuidados después del tratamiento",
    blocks: [{
      kind: "list", items: bullets([
        "Mantener la zona tratada limpia, lavándola suavemente con jabón suave y agua fría.",
        "Evitar frotar o rascar la zona tratada.",
        "Aplicar la crema o ungüento recomendado por el especialista para mantener la piel hidratada y evitar la formación de costras.",
        "Utilizar productos que no contengan fragancias ni alcohol.",
        "Evitar la exposición solar directa en el área tratada.",
        "Usar sombrero, gorra o protección física cuando sea necesario.",
        "Aplicar protector solar SPF 30 o superior en el área tratada dos semanas después del procedimiento, una vez que haya sanado.",
        "No rascar ni retirar costras, ya que esto puede causar cicatrices o infecciones.",
        "Evitar saunas, jacuzzis, baños calientes o agua caliente durante al menos una semana.",
        "Preferir duchas con agua fría o templada en lugar de baños de inmersión.",
        "Evitar ejercicio intenso durante al menos una semana, ya que el sudor puede irritar la piel y aumentar el riesgo de infección.",
        "No aplicar maquillaje en el área tratada durante una o dos semanas, o hasta que la piel esté completamente sana.",
        "Monitorear cualquier signo de infección, como enrojecimiento excesivo, hinchazón, pus o fiebre.",
        "Contactar al centro o médico si presenta síntomas inusuales o preocupantes.",
        "Seguir siempre las instrucciones específicas del especialista, ya que cada caso puede requerir cuidados particulares.",
        "Evitar productos químicos, retinoides, ácidos o exfoliantes durante las primeras semanas si pueden irritar la piel.",
      ]),
    }],
  },
  {
    title: "Consideraciones generales sobre la eliminación de tatuajes y cejas",
    blocks: [{
      kind: "list", items: bullets([
        "El láser Spectra es una tecnología avanzada utilizada para la eliminación de tatuajes y cejas.",
        "El procedimiento puede ser realizado por el médico dermatólogo o la cosmiatra capacitada.",
        "Existen opciones anestésicas personalizadas que pueden aplicarse con el objetivo de reducir molestias durante la sesión.",
        "Es normal que después de la aplicación del láser aparezca pequeño sangrado, hinchazón o inflamación.",
        "En algunos casos puede formarse una costra fina que suele sanar en aproximadamente 10 a 15 días.",
        "El número de sesiones necesarias para eliminar tatuajes o pigmentos es variable.",
        "Los tatuajes amateurs pueden requerir menos sesiones que los tatuajes profesionales.",
        "Los tatuajes profesionales o pigmentos claros pueden requerir mayor cantidad de sesiones.",
        "El intervalo entre sesiones debe ser de al menos cuatro semanas, aunque en ocasiones puede ser recomendable extenderlo.",
        "No se puede garantizar la eliminación del 100% de la tinta o pigmento.",
        "El láser puede provocar cambios en el color de la piel tratada, como aclaramiento u oscurecimiento.",
        "Estos cambios suelen mejorar con el tiempo, pero excepcionalmente pueden ser permanentes.",
        "Aunque es poco probable, el procedimiento con láser puede dejar cicatrices visibles.",
        "Las cicatrices pueden producirse especialmente si no se siguen los cuidados indicados o no se acude a los controles correspondientes.",
        "Durante el tratamiento no debo exponer al sol la zona tratada al menos dos semanas después de cada sesión, salvo que use protección solar adecuada.",
        "Me comprometo a realizar las curas siguiendo fielmente las instrucciones del especialista y asistir a las revisiones recomendadas.",
      ]),
    }],
  },
  {
    title: "Riesgos y posibles complicaciones",
    blocks: [
      { kind: "p", runs: plain("A pesar de que se tomen precauciones, la eliminación de tatuajes y cejas con láser puede conllevar ciertos riesgos y complicaciones, incluyendo, pero no limitado a:") },
      {
        kind: "list", items: bullets([
          "Enrojecimiento o irritación en el área tratada.",
          "Hinchazón o inflamación alrededor de la zona tratada.",
          "Dolor o molestia durante y después del procedimiento.",
          "Riesgo de formación de cicatrices.",
          "Posibilidad de infección en el sitio tratado.",
          "Cambios temporales o permanentes en la pigmentación de la piel.",
          "Hipopigmentación o hiperpigmentación.",
          "Reacciones alérgicas a anestésicos locales o productos utilizados.",
          "Formación de ampollas.",
          "Formación de costras.",
          "Aumento de sensibilidad al sol en el área tratada.",
          "Quemaduras solares si no se protege adecuadamente la zona.",
          "Falta de efectividad o eliminación incompleta del tatuaje o pigmento.",
          "Daño en capas más profundas de la piel.",
          "Cambios en la textura de la piel, como asperezas o irregularidades.",
          "Formación de queloides en personas predispuestas.",
          "Infección sistémica en casos raros.",
          "Pigmentación irregular o color desigual en la piel.",
          "Riesgo de contaminación si no se siguen protocolos de higiene.",
          "Necrosis de la piel tratada en casos excepcionales.",
          "Ansiedad o insatisfacción si los resultados no cumplen con las expectativas.",
          "Reacciones sistémicas al láser, aunque son poco frecuentes.",
        ]),
      },
    ],
  },
  {
    title: "Políticas y procedimientos",
    blocks: [{
      kind: "list", items: bullets([
        "Reservas y cancelaciones deben realizarse con 48 horas de antelación.",
        "Horario: lunes a viernes de 9:00 a.m. a 8:00 p.m. y sábados de 8:00 a.m. a 4:00 p.m.",
        "Si la cancelación o reprogramación no es comunicada, la sesión se dará por realizada.",
        "Los pagos pueden realizarse en efectivo, transferencia o tarjeta de crédito.",
        "Los precios en Cibao Spa Láser no incluyen ITBIS.",
        "El tiempo de la cita no puede extenderse si afecta el itinerario programado.",
        "Si el retraso es responsabilidad del centro, el tiempo será repuesto.",
        "Si el retraso es responsabilidad del cliente, será atendido solo durante el tiempo restante de su cita.",
      ]),
    }],
  },
  {
    title: "Protección de datos",
    blocks: [{ kind: "p", runs: plain("Cibao Spa Láser podrá enviar información, respuestas a consultas y contactos generales mientras dure nuestra relación y cuente con el consentimiento del destinatario. Los datos personales no serán cedidos a terceros, salvo obligación legal.") }],
  },
  {
    title: "Autorización",
    blocks: [
      { kind: "p", runs: plain("He sido informado/a sobre el procedimiento de eliminación de tatuajes y cejas, incluyendo sus riesgos, posibles complicaciones y beneficios. He tenido la oportunidad de hacer preguntas y he recibido respuestas satisfactorias.") },
      { kind: "p", runs: plain("Entiendo que los resultados pueden variar de una persona a otra y que no se garantiza la eliminación completa del tatuaje, cejas o pigmento.") },
      { kind: "p", runs: plain("Doy mi consentimiento para realizar el procedimiento en Cibao Spa Láser y libero a Cibao Spa Láser y a su personal de cualquier responsabilidad legal, penal o civil en caso de complicaciones que puedan surgir durante o después del tratamiento, siempre que se haya actuado conforme a los protocolos establecidos.") },
    ],
  },
  {
    title: "Declaración y firma",
    blocks: [{ kind: "p", runs: plain("Declaro que he leído, comprendido y acepto el contenido de este consentimiento informado. Confirmo que la información suministrada es verdadera y completa, y autorizo a Cibao Spa Láser y a su personal a realizar el procedimiento descrito.") }],
  },
]

export async function buildConsentTatuajeCejaPdf(row: Row, businessName = "Cibao Spa Laser"): Promise<Buffer> {
  return buildConsentPdf(row, businessName, {
    title: "CONSENTIMIENTO INFORMADO PARA ELIMINACIÓN DE TATUAJES Y CEJAS",
    footerLabel: "Consentimiento Tatuajes/Cejas",
    sections: TATUAJE_SECTIONS,
  })
}
