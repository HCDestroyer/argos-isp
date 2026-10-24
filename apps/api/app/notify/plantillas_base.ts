import type { CanalNotificacion } from '#shared/eventos'

/**
 * Plantillas iniciales de `notify.plantillas`. El seeder las inserta solo si no existen
 * (`evento + canal`): las ediciones hechas desde el panel no se pisan.
 * Variables: `app/notify/README.md`.
 */
export interface PlantillaBase {
    evento: string
    canal: CanalNotificacion
    asunto: string | null
    cuerpo: string
}

const pie = '\n\n{{empresa.nombre}}{{#empresa.telefono}} · {{empresa.telefono}}{{/empresa.telefono}}'
const portal = '{{#empresa.portal_url}}\nConsulta y paga en {{empresa.portal_url}}{{/empresa.portal_url}}'
const puntosEnPortal =
    '{{#empresa.portal_url}}\nConsulta tus puntos en {{empresa.portal_url}}{{/empresa.portal_url}}'

function ambos(evento: string, asunto: string, cuerpo: string): PlantillaBase[] {
    return [
        { evento, canal: 'correo', asunto, cuerpo: `Hola {{cliente.nombre}}:\n\n${cuerpo}${pie}` },
        // Telegram: el bot puede ser único para varias empresas; el mensaje firma con la empresa.
        { evento, canal: 'telegram', asunto: null, cuerpo: `${asunto}\n\n${cuerpo}\n\n{{empresa.nombre}}` },
    ]
}

const recordatorio = (orden: number) =>
    ambos(
        `recordatorio.${orden}`,
        'Recordatorio: tu factura {{factura.numero}} {{factura.vence_relativo}}',
        'Tu factura {{factura.numero}}{{#factura.periodo}} del periodo {{factura.periodo}}{{/factura.periodo}} {{factura.vence_relativo}} ({{factura.vence}}). Saldo pendiente: {{factura.saldo_q}}.' +
            '{{#factura.vencida}} Paga hoy para evitar la suspensión de tu servicio.{{/factura.vencida}}' +
            portal,
    )

/** Recordatorios iniciales: 3 días antes, el día y 3 días después del vencimiento, a las 09:00. */
export const RECORDATORIOS_BASE = [
    { orden: 1, dias: -3, hora: '09:00' },
    { orden: 2, dias: 0, hora: '09:00' },
    { orden: 3, dias: 3, hora: '09:00' },
]

/**
 * Aviso fiscal (contrato de localización fiscal §14): Telegram al chat del equipo y correo a
 * contabilidad, con la configuración de canales de la empresa del evento. Mismo texto en los dos.
 */
function alertaFiscal(evento: string, asunto: string, cuerpo: string): PlantillaBase[] {
    return [
        { evento, canal: 'telegram', asunto: null, cuerpo: `${asunto}\n\n${cuerpo}` },
        {
            evento,
            canal: 'correo',
            asunto,
            cuerpo: `Equipo de contabilidad:\n\n${cuerpo}\n\nAviso automático de ArgosIsp para {{empresa.nombre}}.`,
        },
    ]
}

/** Aviso informativo solo a contabilidad (correo), con la configuración de la empresa del evento. */
function avisoContabilidad(evento: string, asunto: string, cuerpo: string): PlantillaBase[] {
    return [
        {
            evento,
            canal: 'correo',
            asunto,
            cuerpo: `Equipo de contabilidad:\n\n${cuerpo}\n\nAviso automático de ArgosIsp para {{empresa.nombre}}.`,
        },
    ]
}

/** Alerta de sorteos al chat del equipo de la empresa (Telegram). */
function alertaSorteo(fase: string, cuerpo: string): PlantillaBase {
    return {
        evento: `alerta.sorteo.${fase}`,
        canal: 'telegram',
        asunto: null,
        cuerpo: `SORTEO · {{empresa.nombre}} · ${cuerpo}`,
    }
}

/**
 * Alertas internas al chat del equipo (`TELEGRAM_CHAT_EQUIPO`, tarea 7). Telegram; los avisos
 * fiscales (`alertaFiscal`) también por correo a contabilidad. Variables:
 * `alerta.*` (ver `app/notify/alertas.ts`) y `empresa.*`. Si la plantilla está desactivada o no
 * existe se usa este mismo texto: una alerta interna nunca se pierde por falta de plantilla.
 */
export const PLANTILLAS_ALERTA: PlantillaBase[] = [
    {
        evento: 'alerta.aaa.caido',
        canal: 'telegram',
        asunto: null,
        cuerpo:
            'ALERTA · RADIUS (aaa) caído\nNodo: {{alerta.nodo}}\nDesde: {{alerta.desde}}' +
            '{{#alerta.ultimo_error}}\nÚltimo error: {{alerta.ultimo_error}}{{/alerta.ultimo_error}}' +
            '\nLos routers autentican con sus secrets locales hasta que vuelva.',
    },
    {
        evento: 'alerta.aaa.recuperado',
        canal: 'telegram',
        asunto: null,
        cuerpo:
            'RESUELTO · RADIUS (aaa) recuperado\nNodo: {{alerta.nodo}}\nCaído desde: {{alerta.desde}} hasta {{alerta.hasta}} ({{alerta.duracion}})' +
            '{{#alerta.ultimo_error}}\nÚltimo error: {{alerta.ultimo_error}}{{/alerta.ultimo_error}}',
    },
    {
        evento: 'alerta.coa.fallido',
        canal: 'telegram',
        asunto: null,
        cuerpo:
            'ALERTA · {{alerta.tipo}} sin respuesta del router {{alerta.nas_ip}}\nServicio: {{alerta.servicio_id}}\nError: {{alerta.error}}' +
            '\nLos siguientes fallos de este router en {{alerta.ventana_min}} min no se repiten aquí (quedan en audit.red).',
    },
    {
        evento: 'alerta.routeros.fallido',
        canal: 'telegram',
        asunto: null,
        cuerpo:
            'ALERTA · El router {{alerta.router}} no aceptó cambios por la API REST\nOperación: {{alerta.operacion}}' +
            '{{#alerta.servicio_id}}\nServicio: {{alerta.servicio_id}}{{/alerta.servicio_id}}\nError: {{alerta.error}}' +
            '\nFalló tras 3 reintentos; el reconciliador corrige el router cuando vuelva a responder. Los siguientes fallos de este router en {{alerta.ventana_min}} min no se repiten aquí (quedan en audit.red).',
    },
    {
        evento: 'alerta.routeros.velocidad',
        canal: 'telegram',
        asunto: null,
        cuerpo:
            'ALERTA · Configuración de velocidad inválida en el router {{alerta.router}}\nValidación: {{alerta.validacion}}' +
            '{{#alerta.servicio_id}}\nServicio: {{alerta.servicio_id}}{{/alerta.servicio_id}}\nDetalle: {{alerta.error}}' +
            '\nEl router responde: hay que corregir el plan o el modo de control de velocidad (contratos/velocidad.md). Los siguientes fallos de esta validación en {{alerta.ventana_min}} min no se repiten aquí.',
    },
    {
        evento: 'alerta.caja.diferencia',
        canal: 'telegram',
        asunto: null,
        cuerpo:
            'ALERTA · Cierre de caja con {{#alerta.faltante}}faltante{{/alerta.faltante}}{{^alerta.faltante}}sobrante{{/alerta.faltante}}' +
            '\nCaja: {{alerta.caja_id}}{{#alerta.cajero_id}} · cajero {{alerta.cajero_id}}{{/alerta.cajero_id}}' +
            '\nEsperado: {{alerta.esperado_q}}\nContado: {{alerta.contado_q}}\nDiferencia: {{alerta.diferencia_q}}',
    },
    {
        evento: 'alerta.cron.atrasado',
        canal: 'telegram',
        asunto: null,
        cuerpo:
            'ALERTA · {{alerta.descripcion}} no se ejecutó a su hora\nDebía correr: {{alerta.esperado}}\nÚltima ejecución: {{alerta.ultima}}' +
            '\nRevisa el proceso billing-worker.',
    },
    {
        evento: 'alerta.cron.recuperado',
        canal: 'telegram',
        asunto: null,
        cuerpo: 'RESUELTO · {{alerta.descripcion}} volvió a ejecutarse\nÚltima ejecución: {{alerta.ultima}}',
    },
    ...alertaFiscal(
        'alerta.libro.integridad_rota',
        'URGENTE · Integridad del libro contable rota ({{empresa.nombre}})',
        'La verificación de la cadena de sellos del libro contable de {{empresa.nombre}} encontró una diferencia: un asiento ya sellado no coincide con su sello.' +
            '\nSello: {{alerta.sello}}{{#alerta.asiento_id}}\nAsiento: {{alerta.asiento_id}}{{/alerta.asiento_id}}' +
            '\nHuella esperada: {{alerta.esperado}}\nHuella obtenida: {{alerta.obtenido}}' +
            '\nEl cierre del mes queda bloqueado hasta revisarlo. Revisa Contabilidad → Integridad del libro en el panel y no registres correcciones a mano en la base de datos.',
    ),
    ...alertaFiscal(
        'alerta.dte.rechazado',
        '{{#alerta.definitivo}}DTE rechazado{{/alerta.definitivo}}{{^alerta.definitivo}}DTE sin certificar tras agotar los reintentos{{/alerta.definitivo}} · {{alerta.documento}} ({{empresa.nombre}})',
        '{{#alerta.definitivo}}El certificador rechazó el DTE de {{alerta.documento}}.{{/alerta.definitivo}}' +
            '{{^alerta.definitivo}}El DTE de {{alerta.documento}} no se pudo certificar: se agotaron los reintentos sin respuesta válida del certificador.{{/alerta.definitivo}}' +
            '\nDTE: {{alerta.dte_id}}{{#alerta.receptor}}\nReceptor: {{alerta.receptor}}{{/alerta.receptor}}{{#alerta.total_q}}\nTotal: {{alerta.total_q}}{{/alerta.total_q}}' +
            '\nError: {{alerta.error}}' +
            '{{#alerta.definitivo}}\nCorrige el dato que indica el error (por ejemplo, el NIT o el nombre del cliente) y reintenta el DTE desde el panel: se envía con otro identificador.{{/alerta.definitivo}}' +
            '{{^alerta.definitivo}}\nRevisa la conexión con el certificador y las credenciales FEL de la empresa; luego reintenta el DTE desde el panel. Si el certificador sigue caído, valora activar la contingencia.{{/alerta.definitivo}}' +
            '\nLos siguientes rechazos de esta empresa en {{alerta.ventana_min}} min no se repiten aquí: están en el panel, en la lista de DTE rechazados.',
    ),
    ...alertaFiscal(
        'alerta.fel.contingencia_activada',
        'Contingencia FEL activada ({{empresa.nombre}})',
        'Se activó la contingencia FEL de {{empresa.nombre}} el {{alerta.desde}}.{{#alerta.motivo}}\nMotivo: {{alerta.motivo}}{{/alerta.motivo}}' +
            '\nLas facturas se emiten igual y sus DTE quedan en cola; se certifican cuando se desactive la contingencia. Regulariza dentro del plazo que indique el contador.',
    ),
    ...alertaFiscal(
        'alerta.fel.contingencia_desactivada',
        'Contingencia FEL desactivada ({{empresa.nombre}})',
        'Se desactivó la contingencia FEL de {{empresa.nombre}} el {{alerta.hasta}}{{#alerta.duracion}} (estuvo activa desde el {{alerta.desde}}, {{alerta.duracion}}){{/alerta.duracion}}.' +
            '{{#alerta.motivo}}\nMotivo: {{alerta.motivo}}{{/alerta.motivo}}' +
            '\nLos DTE en contingencia se envían al certificador en la próxima corrida de la cola FEL. Revisa en el panel que todos queden certificados.',
    ),
    ...alertaFiscal(
        'alerta.nota_credito.anulada',
        'Nota de crédito {{alerta.nota_credito_id}} anulada ({{empresa.nombre}})',
        'Se anuló la nota de crédito {{alerta.nota_credito_id}} de la factura {{alerta.factura}} por {{alerta.monto_q}}{{#alerta.cliente}} (cliente {{alerta.cliente}}){{/alerta.cliente}}.' +
            '{{#alerta.motivo}}\nMotivo: {{alerta.motivo}}{{/alerta.motivo}}' +
            '\nSu asiento se revirtió y el monto volvió al saldo de la factura. Si el crédito sigue siendo válido, emite una nota nueva con los datos corregidos.',
    ),
    // Calendario fiscal (fase 7 PR A, contrato §14 y §21): la empresa y su NIT en el texto.
    ...alertaFiscal(
        'alerta.fiscal.vencimiento_proximo',
        '{{#alerta.hoy}}HOY · {{/alerta.hoy}}Declaración por vencer: {{alerta.impuesto}}, {{alerta.periodo}} ({{empresa.nombre}})',
        'La declaración {{alerta.impuesto}} del periodo {{alerta.periodo}} de {{empresa.nombre}}{{#empresa.nit}} (NIT {{empresa.nit}}){{/empresa.nit}} {{alerta.cuando}}: {{alerta.vence}}.' +
            '\nFormulario: {{#alerta.formulario}}{{alerta.formulario}}{{/alerta.formulario}}{{^alerta.formulario}}por confirmar con el contador{{/alerta.formulario}}' +
            '\nPresenta la declaración ante la SAT antes de esa fecha. {{^alerta.hoy}}Mientras siga pendiente en el calendario fiscal, se vuelve a avisar al acercarse el vencimiento (7, 3 y 1 días antes y el mismo día).{{/alerta.hoy}}{{#alerta.hoy}}Hoy es el último día para presentar.{{/alerta.hoy}}',
    ),
    ...alertaFiscal(
        'alerta.fiscal.limite_pc',
        '{{#alerta.supera}}Límite del pequeño contribuyente superado: debe pasar al régimen general{{/alerta.supera}}{{^alerta.supera}}Pequeño contribuyente al {{alerta.umbral_texto}} del límite anual{{/alerta.supera}} ({{empresa.nombre}})',
        'Lo facturado por {{empresa.nombre}}{{#empresa.nit}} (NIT {{empresa.nit}}){{/empresa.nit}} en {{alerta.anio}} suma {{alerta.acumulado_q}}{{#alerta.porcentaje}}, el {{alerta.porcentaje}}{{/alerta.porcentaje}} del límite anual del pequeño contribuyente ({{alerta.limite_q}}).' +
            '{{#alerta.supera}}\nLa empresa superó el límite: {{empresa.nombre}} debe pasar al régimen general del IVA. Coordina con el contador la actualización ante la SAT y, ya hecha, cambia el régimen en la configuración fiscal del panel. ArgosIsp no cambia el régimen por su cuenta.{{/alerta.supera}}' +
            '{{^alerta.supera}}{{#alerta.disponible_q}}\nQuedan {{alerta.disponible_q}} antes del límite.{{/alerta.disponible_q}} Al llegar al 100 % la empresa debe pasar al régimen general del IVA: revisa con el contador desde cuándo hacer el cambio.{{/alerta.supera}}',
    ),
    // Declaraciones (fase 7 PR C): cascada de remanentes (H34), pago y anulación del pago.
    ...alertaFiscal(
        'alerta.declaracion.rectificativa',
        '{{#alerta.presentada}}Rectificativa por presentar{{/alerta.presentada}}{{^alerta.presentada}}Declaración rectificada{{/alerta.presentada}}: {{alerta.impuesto}}, {{alerta.periodo}} ({{empresa.nombre}})',
        'La revisión de {{alerta.causa_impuesto}} {{alerta.causa_periodo}}{{#alerta.causa_version}} (versión {{alerta.causa_version}}){{/alerta.causa_version}} de {{empresa.nombre}}{{#empresa.nit}} (NIT {{empresa.nit}}){{/empresa.nit}} cambió el remanente que arrastra {{alerta.periodo}}, y el sistema recalculó y revisó ese mes en la versión {{alerta.version}}{{#alerta.version_anterior}} (sustituye a la versión {{alerta.version_anterior}}){{/alerta.version_anterior}}.' +
            '\nNuevo monto a pagar: {{alerta.a_pagar_q}}.' +
            '{{#alerta.presentada}}\n{{alerta.periodo}} ya estaba presentado{{#alerta.formulario_anterior}} (formulario {{alerta.formulario_anterior}}{{#alerta.presentada_el}}, presentado el {{alerta.presentada_el}}{{/alerta.presentada_el}}){{/alerta.formulario_anterior}}: quedó como «rectificativa por presentar» en el calendario fiscal. Presenta la rectificativa ante la SAT y registra su presentación en el panel. Los pagos ya registrados no cambian.{{/alerta.presentada}}' +
            '{{^alerta.presentada}}\nEse mes no estaba presentado: presenta la versión {{alerta.version}}. Los pagos ya registrados no cambian.{{/alerta.presentada}}',
    ),
    ...alertaFiscal(
        'alerta.declaracion.pagada',
        'Pago registrado: {{alerta.impuesto}}, {{alerta.periodo}} ({{empresa.nombre}})',
        'Se registró el pago de la declaración {{alerta.impuesto}} del periodo {{alerta.periodo}} (versión {{alerta.version}}) de {{empresa.nombre}}{{#empresa.nit}} (NIT {{empresa.nit}}){{/empresa.nit}}: {{alerta.total_q}}{{#alerta.fecha}} el {{alerta.fecha}}{{/alerta.fecha}}.' +
            '{{#alerta.impuesto_q}}\nImpuesto: {{alerta.impuesto_q}}{{/alerta.impuesto_q}}{{#alerta.mora_q}}\nMora: {{alerta.mora_q}}{{#alerta.dias_atraso}} ({{alerta.dias_atraso}} días de atraso){{/alerta.dias_atraso}}{{/alerta.mora_q}}{{#alerta.multa_q}}\nMulta: {{alerta.multa_q}}{{/alerta.multa_q}}' +
            '{{#alerta.boleta}}\nBoleta: {{alerta.boleta}}{{/alerta.boleta}}\nVencía el {{alerta.vence}}.',
    ),
    ...alertaFiscal(
        'alerta.declaracion.pago_anulado',
        'Pago anulado: {{alerta.impuesto}}, {{alerta.periodo}} ({{empresa.nombre}})',
        'Se anuló el pago{{#alerta.boleta}} con boleta {{alerta.boleta}}{{/alerta.boleta}}{{#alerta.fecha}} del {{alerta.fecha}}{{/alerta.fecha}} de la declaración {{alerta.impuesto}} del periodo {{alerta.periodo}} (versión {{alerta.version}}) de {{empresa.nombre}}{{#empresa.nit}} (NIT {{empresa.nit}}){{/empresa.nit}}, por {{alerta.total_q}}.' +
            '{{#alerta.motivo}}\nMotivo: {{alerta.motivo}}{{/alerta.motivo}}' +
            '\nSu asiento se revirtió{{#alerta.asiento_id}} (asiento {{alerta.asiento_id}}){{/alerta.asiento_id}} y la declaración quedó sin pago registrado: si el pago se hizo, regístralo de nuevo con los datos correctos.',
    ),
    // Declaraciones calculadas y presentadas: solo a contabilidad.
    ...avisoContabilidad(
        'alerta.declaracion.calculada',
        'Declaración calculada: {{alerta.impuesto}}, {{alerta.periodo}} ({{empresa.nombre}})',
        'Se calculó la declaración {{alerta.impuesto}} del periodo {{alerta.periodo}}{{#alerta.rectificativa}} (versión {{alerta.version}}){{/alerta.rectificativa}} de {{empresa.nombre}}{{#empresa.nit}} (NIT {{empresa.nit}}){{/empresa.nit}}.' +
            '\nMonto a pagar según el borrador: {{alerta.monto_q}}.{{#alerta.vence}}\nVence el {{alerta.vence}}.{{/alerta.vence}}' +
            '\nRevisa el borrador en el panel (Fiscal → Declaraciones) y márcalo como revisado para liquidar y bloquear los impuestos del periodo.',
    ),
    ...avisoContabilidad(
        'alerta.declaracion.presentada',
        'Declaración presentada: {{alerta.impuesto}}, {{alerta.periodo}} ({{empresa.nombre}})',
        'Se registró la presentación de la declaración {{alerta.impuesto}} del periodo {{alerta.periodo}} (versión {{alerta.version}}) de {{empresa.nombre}}{{#empresa.nit}} (NIT {{empresa.nit}}){{/empresa.nit}}' +
            '{{#alerta.formulario}}, formulario {{alerta.formulario}}{{/alerta.formulario}}{{#alerta.presentada_el}}, el {{alerta.presentada_el}}{{/alerta.presentada_el}}.' +
            '\nMonto declarado: {{alerta.monto_q}}.{{#alerta.vence}} Vence el {{alerta.vence}}: registra el pago cuando se haga.{{/alerta.vence}}',
    ),
    // Libro contable y cierres (fase 6, A3).
    ...alertaFiscal(
        'alerta.libro.proceso_bloqueado',
        '{{alerta.descripcion}} quedó detenida por un bloqueo del libro ({{empresa.nombre}})',
        '{{alerta.descripcion}} de {{empresa.nombre}} no contabilizó {{alerta.documentos}} {{alerta.que_documentos}} porque la fecha contable {{alerta.fecha}} cae bajo el {{alerta.tipo_texto}}{{#alerta.hasta}} (hasta el {{alerta.hasta}}){{/alerta.hasta}}.' +
            '{{#alerta.ejemplos}}\nEjemplos ({{alerta.que_documentos}}): {{alerta.ejemplos}}{{#alerta.mas_ejemplos}}…{{/alerta.mas_ejemplos}}{{/alerta.ejemplos}}' +
            '\nNada se pierde: quedan pendientes y cada corrida los vuelve a intentar. Si el periodo debe seguir cerrado, contabilidad decide cómo registrar estos documentos (por ejemplo, una excepción del bloqueo); si no, ajusta el bloqueo en el panel. Las corridas siguientes con el mismo bloqueo no se repiten aquí; se avisa cuando una corrida termine sin bloqueos.',
    ),
    ...alertaFiscal(
        'alerta.libro.proceso_desbloqueado',
        'RESUELTO · {{alerta.descripcion}} ya no está bloqueada ({{empresa.nombre}})',
        'La corrida del {{alerta.ultima}} de {{alerta.descripcion}} de {{empresa.nombre}} terminó sin documentos bloqueados por el libro.' +
            '\nEstuvo detenida desde el {{alerta.desde}} ({{alerta.duracion}}, {{alerta.eventos}} corridas con bloqueo).',
    ),
    ...alertaFiscal(
        'alerta.libro.checks_anomalias',
        'Verificación del {{alerta.tipo_texto}} {{alerta.periodo}} con {{alerta.cantidad}} {{#alerta.varias}}anomalías{{/alerta.varias}}{{^alerta.varias}}anomalía{{/alerta.varias}} ({{empresa.nombre}})',
        'La verificación del {{alerta.tipo_texto}} {{alerta.periodo}} de {{empresa.nombre}} encontró {{#alerta.varias}}controles{{/alerta.varias}}{{^alerta.varias}}un control{{/alerta.varias}} en anomalía sin supervisar: {{alerta.anomalias}}.' +
            '\nRevísalos en el tablero de cierre del panel: corrige el origen o márcalos como supervisados con su justificación antes de cerrar el periodo. Si la misma lista vuelve a salir, no se repite este aviso.',
    ),
    ...avisoContabilidad(
        'alerta.libro.bloqueo_cambiado',
        '{{#alerta.quitado}}Se quitó el {{alerta.tipo_texto}}{{/alerta.quitado}}{{^alerta.quitado}}{{alerta.tipo_texto}} hasta el {{alerta.hasta}}{{/alerta.quitado}} ({{empresa.nombre}})',
        '{{#alerta.quitado}}Se quitó el {{alerta.tipo_texto}} de {{empresa.nombre}}{{#alerta.anterior}} (estaba hasta el {{alerta.anterior}}){{/alerta.anterior}}.{{/alerta.quitado}}' +
            '{{^alerta.quitado}}El {{alerta.tipo_texto}} de {{empresa.nombre}} quedó hasta el {{alerta.hasta}}{{#alerta.anterior}} (antes: {{alerta.anterior}}){{/alerta.anterior}}{{^alerta.anterior}} (antes no había){{/alerta.anterior}}.{{/alerta.quitado}}' +
            '{{#alerta.es_duro}}\nEl cierre definitivo no admite excepciones: los periodos hasta esa fecha ya no se pueden modificar.{{/alerta.es_duro}}',
    ),
    ...avisoContabilidad(
        'alerta.libro.emitido',
        '{{#alerta.reimpresion}}Reimpresión: {{/alerta.reimpresion}}{{alerta.libro}} {{alerta.periodo}} ({{empresa.nombre}})',
        'Se emitió el {{alerta.libro}} de {{alerta.periodo}} de {{empresa.nombre}}{{#empresa.nit}} (NIT {{empresa.nit}}){{/empresa.nit}} en {{alerta.formato}}, folios {{alerta.folio_inicial}} a {{alerta.folio_final}}.' +
            '{{#alerta.reimpresion}}\nEs una reimpresión: reemplaza a la emisión {{alerta.reimpresion_de}} del mismo rango.{{/alerta.reimpresion}}' +
            '\nHuella SHA-256 del archivo: {{alerta.sha256}}\nDescárgalo desde el historial de emisiones del tablero fiscal.',
    ),
    ...avisoContabilidad(
        'alerta.ejercicio.cerrado',
        'Ejercicio {{alerta.anio}} cerrado ({{empresa.nombre}})',
        'Se cerró el ejercicio {{alerta.anio}} de {{empresa.nombre}}{{#empresa.nit}} (NIT {{empresa.nit}}){{/empresa.nit}}.' +
            '\n{{#alerta.perdida}}Pérdida{{/alerta.perdida}}{{^alerta.perdida}}Resultado{{/alerta.perdida}} del ejercicio (después del ISR): {{alerta.resultado_q}}' +
            '{{#alerta.isr_q}}\nISR: {{alerta.isr_q}}{{/alerta.isr_q}}{{#alerta.reserva_legal_q}}\nReserva legal: {{alerta.reserva_legal_q}}{{/alerta.reserva_legal_q}}' +
            '\nLos asientos del ejercicio ya no se pueden modificar; una corrección va en el ejercicio siguiente.',
    ),
    ...alertaFiscal(
        'alerta.ejercicio.reabierto',
        'Ejercicio {{alerta.anio}} reabierto ({{empresa.nombre}})',
        'Se reabrió el ejercicio {{alerta.anio}} de {{empresa.nombre}}{{#empresa.nit}} (NIT {{empresa.nit}}){{/empresa.nit}}.{{#alerta.motivo}}\nMotivo: {{alerta.motivo}}{{/alerta.motivo}}' +
            '\nSu cierre se revirtió: revisa las correcciones y vuelve a cerrarlo desde el tablero de cierre.',
    ),
    // Sorteos (lealtad fase 3): al chat del equipo de la empresa. El ganador recibe su propio aviso.
    alertaSorteo(
        'bases_publicadas',
        'Se publicaron las bases de {{alerta.nombre}}{{#alerta.fecha_sorteo}}; el sorteo es el {{alerta.fecha_sorteo}}{{/alerta.fecha_sorteo}}.\nHuella de las bases: {{alerta.bases_hash}}',
    ),
    alertaSorteo(
        'corte_cerrado',
        'Se cerró el corte de {{alerta.nombre}}: {{alerta.participantes}} participantes con {{alerta.boletos}} boletos.\nHuella de la lista: {{alerta.lista_hash}}',
    ),
    alertaSorteo(
        'ejecutado',
        'Se ejecutó {{alerta.nombre}}: {{alerta.titulares}} ganadores titulares y {{alerta.suplentes}} suplentes.\nSigue con «Notificar ganadores» en el panel: cada ganador recibe su código y su plazo para reclamar.',
    ),
    alertaSorteo(
        'cancelado',
        'Se canceló {{alerta.nombre}}.{{#alerta.motivo}}\nMotivo: {{alerta.motivo}}{{/alerta.motivo}}',
    ),
    alertaSorteo(
        'entrega_anulada',
        'Se anuló la entrega del premio del puesto {{alerta.posicion}} de {{alerta.nombre}}{{#alerta.cliente}} (cliente {{alerta.cliente}}){{/alerta.cliente}}.{{#alerta.motivo}}\nMotivo: {{alerta.motivo}}{{/alerta.motivo}}\nSu asiento se revirtió; el premio vuelve a quedar pendiente de entrega.',
    ),
    alertaSorteo(
        'premio_no_reclamado',
        'El ganador del puesto {{alerta.posicion}} de {{alerta.nombre}}{{#alerta.cliente}} ({{alerta.cliente}}){{/alerta.cliente}} no reclamó el premio {{alerta.premio_posicion}}.{{#alerta.motivo}}\nMotivo: {{alerta.motivo}}{{/alerta.motivo}}' +
            '{{#alerta.hay_suplente}}\nEl premio pasó al siguiente suplente, que ya recibió su aviso.{{/alerta.hay_suplente}}{{^alerta.hay_suplente}}\nNo quedan suplentes: decide el destino del premio según las bases.{{/alerta.hay_suplente}}',
    ),
    alertaSorteo(
        'acta_cerrada',
        'Se cerró el acta de {{alerta.nombre}}.\nHuella del acta: {{alerta.acta_hash}}',
    ),
    // Horus Flow (contratos/horus.md §3.4): avisos, nunca cortes.
    {
        evento: 'alerta.horus.hallazgo',
        canal: 'telegram',
        asunto: null,
        cuerpo:
            'HORUS · {{empresa.nombre}} · Hallazgo de seguridad {{alerta.severidad}}: {{alerta.tipo}}' +
            '{{#alerta.servicio}}\nServicio: {{alerta.servicio}}{{/alerta.servicio}}' +
            '{{#alerta.ip}}\nIP: {{alerta.ip}}{{/alerta.ip}}{{#alerta.resumen}}\n{{alerta.resumen}}{{/alerta.resumen}}' +
            '\nArgos no corta el servicio por esto: revísalo en Horus.',
    },
    {
        evento: 'alerta.horus.hallazgo_resuelto',
        canal: 'telegram',
        asunto: null,
        cuerpo:
            'RESUELTO · HORUS · {{empresa.nombre}} · Hallazgo {{alerta.tipo}}' +
            '{{#alerta.servicio}}\nServicio: {{alerta.servicio}}{{/alerta.servicio}}\nAbierto: {{alerta.desde}} ({{alerta.duracion}})',
    },
    {
        evento: 'alerta.horus.router',
        canal: 'telegram',
        asunto: null,
        cuerpo:
            'HORUS · Router {{alerta.nombre}} {{alerta.estado}}' +
            '{{#alerta.motivo}}\nMotivo: {{alerta.motivo}}{{/alerta.motivo}}',
    },
    {
        evento: 'alerta.horus.router_recuperado',
        canal: 'telegram',
        asunto: null,
        cuerpo: 'RESUELTO · HORUS · Router {{alerta.nombre}} {{alerta.estado}}\nCaído desde: {{alerta.desde}} ({{alerta.duracion}})',
    },
    {
        evento: 'alerta.horus.infra',
        canal: 'telegram',
        asunto: null,
        cuerpo:
            'HORUS · Servicio {{alerta.nombre}} {{alerta.estado}}' +
            '{{#alerta.motivo}}\nMotivo: {{alerta.motivo}}{{/alerta.motivo}}',
    },
    {
        evento: 'alerta.horus.infra_recuperado',
        canal: 'telegram',
        asunto: null,
        cuerpo: 'RESUELTO · HORUS · Servicio {{alerta.nombre}} {{alerta.estado}}\nCon falla desde: {{alerta.desde}} ({{alerta.duracion}})',
    },
]

export const PLANTILLAS_BASE: PlantillaBase[] = [
    ...PLANTILLAS_ALERTA,
    ...recordatorio(1),
    ...recordatorio(2),
    ...recordatorio(3),
    ...ambos(
        'factura.emitida',
        'Factura {{factura.numero}} por {{factura.total_q}}',
        'Emitimos tu factura {{factura.numero}}{{#factura.periodo}} del periodo {{factura.periodo}}{{/factura.periodo}} por {{factura.total_q}}. Vence el {{factura.vence}}.' +
            portal,
    ),
    ...ambos(
        'factura.vencida',
        'Factura {{factura.numero}} vencida',
        'Tu factura {{factura.numero}} venció el {{factura.vence}}. Saldo pendiente: {{factura.saldo_q}}. Evita la suspensión de tu servicio pagando hoy.' +
            portal,
    ),
    ...ambos(
        'servicio.estado_cambiado',
        '{{#estado.es_activo}}Servicio reactivado{{/estado.es_activo}}{{#estado.es_limitado}}Servicio limitado{{/estado.es_limitado}}{{#estado.es_suspendido}}Servicio suspendido{{/estado.es_suspendido}}{{#estado.es_retirado}}Servicio retirado{{/estado.es_retirado}}',
        '{{#estado.es_activo}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} está activo de nuevo. ¡Gracias!{{/estado.es_activo}}' +
            '{{#estado.es_limitado}}La velocidad de tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue limitada por saldo pendiente.{{/estado.es_limitado}}' +
            '{{#estado.es_suspendido}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue suspendido por saldo pendiente. Se reactiva automáticamente al registrar tu pago.{{/estado.es_suspendido}}' +
            '{{#estado.es_retirado}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue dado de baja.{{/estado.es_retirado}}' +
            portal,
    ),
    ...ambos(
        'pago.registrado',
        'Pago recibido: {{pago.monto_q}}',
        'Recibimos tu pago de {{pago.monto_q}} el {{pago.fecha}}. ¡Gracias!' +
            // Cobro repartido entre empresas: un aviso por empresa, cada uno con su parte
            '{{#cobro.repartido}}\n\nEste pago es la parte de {{empresa.nombre}} de tu pago total de {{cobro.monto_q}}; el resto lo aplicó {{cobro.otras_empresas}}, que te envía su propio aviso.{{/cobro.repartido}}',
    ),
    ...ambos(
        'promesa.creada',
        'Promesa de pago registrada',
        'Registramos tu promesa de pago por {{promesa.monto_q}} con vencimiento el {{promesa.vence}}. Tu servicio queda activo hasta esa fecha.',
    ),
    ...ambos(
        'promesa.cumplida',
        'Promesa de pago cumplida',
        'Tu promesa de pago por {{promesa.monto_q}} quedó cumplida. ¡Gracias!',
    ),
    ...ambos(
        'promesa.incumplida',
        'Promesa de pago vencida',
        'Tu promesa de pago por {{promesa.monto_q}} venció el {{promesa.vence}} sin completarse. Tu servicio puede ser suspendido.' +
            portal,
    ),
    // Pago de terceros: a cada dueño de factura distinto del pagador (avisos_pago.ts)
    ...ambos(
        'pago.registrado.tercero',
        'Pago recibido de tu factura {{pago.facturas_cliente}}',
        'Recibimos el pago de {{#pago.varias_facturas}}tus facturas{{/pago.varias_facturas}}{{^pago.varias_facturas}}tu factura{{/pago.varias_facturas}} {{pago.facturas_cliente}}' +
            '{{#pago.monto_cliente_q}} por {{pago.monto_cliente_q}}{{/pago.monto_cliente_q}}, hecho por {{pagador.nombre}}. ¡Gracias!',
    ),
    ...ambos(
        'comprobante.recibido',
        'Recibimos tu comprobante de pago',
        'Recibimos tu comprobante de pago{{#comprobante.monto_q}} por {{comprobante.monto_q}}{{/comprobante.monto_q}}' +
            '{{#comprobante.referencia}} (referencia {{comprobante.referencia}}){{/comprobante.referencia}}. Lo revisaremos y te avisaremos cuando quede aplicado a tu cuenta.',
    ),
    // Al aprobar, este es el único aviso de pago del pagador (pago.registrado se omite, avisos_pago.ts)
    ...ambos(
        'comprobante.aprobado',
        'Comprobante de pago aprobado',
        'Verificamos tu comprobante de pago{{#pago.monto_q}} por {{pago.monto_q}}{{/pago.monto_q}}. Ya está aplicado a tu cuenta. ¡Gracias!',
    ),
    ...ambos(
        'comprobante.rechazado',
        'Comprobante de pago rechazado',
        'No pudimos validar tu comprobante de pago{{#comprobante.motivo}}: {{comprobante.motivo}}{{/comprobante.motivo}}. Comunícate con nosotros.',
    ),
    // Lealtad (contratos/lealtad.md §16, fase 1; app/notify/lealtad.ts). Los demás lealtad.* no
    // avisan al cliente: ver "Avisos de lealtad" en el README.
    ...ambos(
        'lealtad.puntos_acumulados',
        'Ganaste {{lealtad.puntos_texto}}',
        'Sumaste {{lealtad.puntos_texto}}{{#lealtad.programa}} en {{lealtad.programa}}{{/lealtad.programa}}. Tu saldo es de {{lealtad.saldo_texto}}.' +
            '{{#lealtad.vence}} Estos puntos vencen el {{lealtad.vence}}.{{/lealtad.vence}}' +
            puntosEnPortal,
    ),
    ...ambos(
        'lealtad.puntos_por_vencer',
        'Tienes {{lealtad.puntos_texto}} por vencer',
        'Tu lote de {{lealtad.puntos_texto}}{{#lealtad.programa}} de {{lealtad.programa}}{{/lealtad.programa}} vence el {{lealtad.vence}}. Úsalo antes de esa fecha para no perderlo. Tu saldo es de {{lealtad.saldo_texto}}.' +
            puntosEnPortal,
    ),
    // Al referidor (no al referido): incluye los puntos que ganó, así que su puntos_acumulados no se avisa
    ...ambos(
        'lealtad.referido_calificado',
        '¡Tu referido ya es parte de {{empresa.nombre}}!',
        '{{#referido.nombre}}{{referido.nombre}}, a quien recomendaste,{{/referido.nombre}}{{^referido.nombre}}La persona que recomendaste{{/referido.nombre}} cumplió los requisitos del programa de referidos.' +
            '{{#referido.puntos}} Ganaste {{referido.puntos_texto}}; tu saldo es de {{lealtad.saldo_texto}}.{{/referido.puntos}}' +
            ' ¡Gracias por recomendarnos!' +
            puntosEnPortal,
    ),
    // Canjes (lealtad fase 2): al cliente del canje. El reservado de un premio de sorteo no se avisa.
    ...ambos(
        'lealtad.canje_reservado',
        'Canje registrado: {{canje.premio}}',
        'Canjeaste {{#canje.puntos_texto}}{{canje.puntos_texto}} por {{/canje.puntos_texto}}{{canje.premio}}.' +
            '{{#canje.es_descuento}} El descuento se aplicará en tu próxima factura.{{/canje.es_descuento}}' +
            '{{^canje.es_descuento}} Te avisaremos cuando quede aplicado.{{/canje.es_descuento}}' +
            ' Tu saldo es de {{lealtad.saldo_texto}}.' +
            puntosEnPortal,
    ),
    ...ambos(
        'lealtad.canje_aplicado',
        'Aplicamos tu canje: {{canje.premio}}',
        '{{#canje.descuento_q}}Aplicamos un descuento de {{canje.descuento_q}} por tu canje de {{canje.premio}}' +
            '{{#factura.numero}} en tu factura {{factura.numero}}{{/factura.numero}}' +
            '{{^factura.numero}}{{#canje.periodo}} en tu servicio de {{canje.periodo}}{{/canje.periodo}}{{/factura.numero}}.{{/canje.descuento_q}}' +
            '{{^canje.descuento_q}}Tu canje de {{canje.premio}} ya quedó aplicado.' +
            '{{#canje.es_mejora_plan}} Tu servicio tiene la mejora de plan por el tiempo del premio.{{/canje.es_mejora_plan}}' +
            '{{#canje.es_boletos}} Tus boletos ya participan en el sorteo.{{/canje.es_boletos}}{{/canje.descuento_q}}' +
            ' ¡Gracias por ser parte del programa!' +
            puntosEnPortal,
    ),
    ...ambos(
        'lealtad.canje_revertido',
        'Canje revertido: {{canje.premio}}',
        'Revertimos tu canje de {{canje.premio}}{{#canje.motivo}} (motivo: {{canje.motivo}}){{/canje.motivo}}.' +
            '{{#canje.puntos_texto}} Devolvimos {{canje.puntos_texto}} a tu saldo, que ahora es de {{lealtad.saldo_texto}}.{{/canje.puntos_texto}}' +
            ' Si tienes dudas, comunícate con nosotros.' +
            puntosEnPortal,
    ),
    // Sorteos (lealtad fase 3): al ganador, con su código y su plazo; los demás sorteo.* son internos.
    ...ambos(
        'sorteo.ganador_notificado',
        '¡Ganaste en {{sorteo.nombre}}!',
        '¡Felicidades! Resultaste ganador{{#sorteo.sustituye}} como suplente: el premio no fue reclamado a tiempo y ahora es tuyo{{/sorteo.sustituye}} en el sorteo {{sorteo.nombre}}.' +
            '\nPremio: {{sorteo.premio}}{{#sorteo.premio_valor_q}} (valor {{sorteo.premio_valor_q}}){{/sorteo.premio_valor_q}}' +
            '\nTu código de ganador: {{sorteo.codigo}}' +
            '\nReclámalo antes del {{sorteo.reclamar_antes}} con tu código y tu documento de identificación. Si no lo reclamas a tiempo, el premio pasa al siguiente suplente.' +
            '{{#empresa.soporte.texto}}\nPara coordinar la entrega: {{empresa.soporte.texto}}{{/empresa.soporte.texto}}',
    ),
    ...ambos(
        'sorteo.premio_entregado',
        'Entregamos tu premio de {{sorteo.nombre}}',
        'Registramos la entrega de tu premio{{#sorteo.premio}} {{sorteo.premio}}{{/sorteo.premio}} del sorteo {{sorteo.nombre}}. ¡Felicidades y gracias por participar!',
    ),
    // Bonificaciones (periodo o cargo en Q0): no hay factura, así que se avisa por qué.
    ...ambos(
        'bonificacion.registrada',
        'Sin costo: {{bonificacion.concepto}}',
        '{{#bonificacion.es_cargo}}El cargo {{bonificacion.concepto}} no tiene costo para ti{{/bonificacion.es_cargo}}' +
            '{{^bonificacion.es_cargo}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}}{{#bonificacion.periodo}} de {{bonificacion.periodo}}{{/bonificacion.periodo}} no tiene costo ({{bonificacion.origen_texto}}){{/bonificacion.es_cargo}}' +
            '{{#bonificacion.bruto_q}}: te bonificamos {{bonificacion.bruto_q}}{{/bonificacion.bruto_q}}. Por eso no recibirás factura por este concepto.',
    ),
]
