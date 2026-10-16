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

function ambos(evento: string, asunto: string, cuerpo: string): PlantillaBase[] {
    return [
        { evento, canal: 'correo', asunto, cuerpo: `Hola {{cliente.nombre}}:\n\n${cuerpo}${pie}` },
        { evento, canal: 'telegram', asunto: null, cuerpo: `${asunto}\n\n${cuerpo}` },
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
 * Alertas internas al chat del equipo (`TELEGRAM_CHAT_EQUIPO`, tarea 7). Solo Telegram. Variables:
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
        'Recibimos tu pago de {{pago.monto_q}} el {{pago.fecha}}. ¡Gracias!',
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
]
