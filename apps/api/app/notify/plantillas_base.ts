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

export const PLANTILLAS_BASE: PlantillaBase[] = [
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
    ...ambos(
        'comprobante.aprobado',
        'Comprobante de pago aprobado',
        'Verificamos tu comprobante de pago. Ya está aplicado a tu cuenta.',
    ),
    ...ambos(
        'comprobante.rechazado',
        'Comprobante de pago rechazado',
        'No pudimos validar tu comprobante de pago{{#comprobante.motivo}}: {{comprobante.motivo}}{{/comprobante.motivo}}. Comunícate con nosotros.',
    ),
]
