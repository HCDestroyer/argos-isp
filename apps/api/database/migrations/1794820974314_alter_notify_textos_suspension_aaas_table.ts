import { BaseSchema } from '@adonisjs/lucid/schema'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Textos de fábrica que engañaban (A6):
 *
 * - `servicio.estado_cambiado` (correo y Telegram): decía «suspendido por saldo pendiente. Se
 *   reactiva automáticamente al registrar tu pago» también en una suspensión manual, que el pago no
 *   reactiva (`core/transicion_manual.ts`); igual con «limitada por saldo pendiente». Ahora elige el
 *   texto con `{{estado.por_falta_de_pago}}`, como WhatsApp.
 * - `alerta.aaa.caido` (Telegram del equipo): decía que los routers autentican con sus secrets
 *   locales, que solo existen si alguien importó el `.rsc` de `emergencia:secrets-ppp`. Ahora dice
 *   que los que se reconectan quedan rechazados y apunta a `docs/runbooks/aaa-caido.md`.
 *
 * El seeder nunca pisa una plantilla existente (`onConflict().ignore()`), así que las instalaciones
 * ya sembradas siguen con el texto viejo. Esta migración solo cambia la fila cuyo `cuerpo` es
 * **exactamente** el original de fábrica: una plantilla personalizada desde el panel (aunque sea un
 * espacio) no se toca. Sube `version` (un editor abierto recibe 409) y deja el diff en
 * `audit.cambios` (actor `sistema`). No cambia `activa` ni `asunto`. Idempotente. El `down` no
 * revierte: volver al texto engañoso no tiene sentido.
 *
 * Los textos van copiados aquí y no importados de `plantillas_base.ts`: la migración debe seguir
 * haciendo lo mismo aunque la base cambie después.
 */
export const TEXTOS: Array<{ evento: string; canal: string; original: string; nuevo: string }> = [
    {
        evento: 'alerta.aaa.caido',
        canal: 'telegram',
        original:
            'ALERTA · RADIUS (aaa) caído\nNodo: {{alerta.nodo}}\nDesde: {{alerta.desde}}{{#alerta.ultimo_error}}\nÚltimo error: {{alerta.ultimo_error}}{{/alerta.ultimo_error}}\nLos routers autentican con sus secrets locales hasta que vuelva.',
        nuevo: 'ALERTA · RADIUS (aaa) caído\nNodo: {{alerta.nodo}}\nDesde: {{alerta.desde}}{{#alerta.ultimo_error}}\nÚltimo error: {{alerta.ultimo_error}}{{/alerta.ultimo_error}}\nLos clientes conectados siguen navegando, pero los que se reconecten quedan rechazados mientras no responda (salvo que el router tenga un segundo nodo /radius; los routers en modo PPPoE local no dependen de aaa).\nQué hacer: docs/runbooks/aaa-caido.md. Si no vuelve en 15 min, cargar los secrets de emergencia (emergencia:secrets-ppp) en el router afectado: no existen hasta que alguien los importa.',
    },
    {
        evento: 'servicio.estado_cambiado',
        canal: 'correo',
        original:
            'Hola {{cliente.nombre}}:\n\n{{#estado.es_activo}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} está activo de nuevo. ¡Gracias!{{/estado.es_activo}}{{#estado.es_limitado}}La velocidad de tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue limitada por saldo pendiente.{{/estado.es_limitado}}{{#estado.es_suspendido}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue suspendido por saldo pendiente. Se reactiva automáticamente al registrar tu pago.{{/estado.es_suspendido}}{{#estado.es_retirado}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue dado de baja.{{/estado.es_retirado}}{{#empresa.portal_url}}\nConsulta y paga en {{empresa.portal_url}}{{/empresa.portal_url}}\n\n{{empresa.nombre}}{{#empresa.telefono}} · {{empresa.telefono}}{{/empresa.telefono}}',
        nuevo: 'Hola {{cliente.nombre}}:\n\n{{#estado.es_activo}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} está activo de nuevo. ¡Gracias!{{/estado.es_activo}}{{#estado.es_limitado}}La velocidad de tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue limitada{{#estado.por_falta_de_pago}} por saldo pendiente.{{/estado.por_falta_de_pago}}{{^estado.por_falta_de_pago}}. Si tienes dudas, comunícate con nosotros.{{/estado.por_falta_de_pago}}{{/estado.es_limitado}}{{#estado.es_suspendido}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue suspendido{{#estado.por_falta_de_pago}} por saldo pendiente. Se reactiva automáticamente al registrar tu pago.{{/estado.por_falta_de_pago}}{{^estado.por_falta_de_pago}}. Para reactivarlo, comunícate con nosotros.{{/estado.por_falta_de_pago}}{{/estado.es_suspendido}}{{#estado.es_retirado}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue dado de baja.{{/estado.es_retirado}}{{#empresa.portal_url}}\nConsulta y paga en {{empresa.portal_url}}{{/empresa.portal_url}}\n\n{{empresa.nombre}}{{#empresa.telefono}} · {{empresa.telefono}}{{/empresa.telefono}}',
    },
    {
        evento: 'servicio.estado_cambiado',
        canal: 'telegram',
        original:
            '{{#estado.es_activo}}Servicio reactivado{{/estado.es_activo}}{{#estado.es_limitado}}Servicio limitado{{/estado.es_limitado}}{{#estado.es_suspendido}}Servicio suspendido{{/estado.es_suspendido}}{{#estado.es_retirado}}Servicio retirado{{/estado.es_retirado}}\n\n{{#estado.es_activo}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} está activo de nuevo. ¡Gracias!{{/estado.es_activo}}{{#estado.es_limitado}}La velocidad de tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue limitada por saldo pendiente.{{/estado.es_limitado}}{{#estado.es_suspendido}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue suspendido por saldo pendiente. Se reactiva automáticamente al registrar tu pago.{{/estado.es_suspendido}}{{#estado.es_retirado}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue dado de baja.{{/estado.es_retirado}}{{#empresa.portal_url}}\nConsulta y paga en {{empresa.portal_url}}{{/empresa.portal_url}}\n\n{{empresa.nombre}}',
        nuevo: '{{#estado.es_activo}}Servicio reactivado{{/estado.es_activo}}{{#estado.es_limitado}}Servicio limitado{{/estado.es_limitado}}{{#estado.es_suspendido}}Servicio suspendido{{/estado.es_suspendido}}{{#estado.es_retirado}}Servicio retirado{{/estado.es_retirado}}\n\n{{#estado.es_activo}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} está activo de nuevo. ¡Gracias!{{/estado.es_activo}}{{#estado.es_limitado}}La velocidad de tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue limitada{{#estado.por_falta_de_pago}} por saldo pendiente.{{/estado.por_falta_de_pago}}{{^estado.por_falta_de_pago}}. Si tienes dudas, comunícate con nosotros.{{/estado.por_falta_de_pago}}{{/estado.es_limitado}}{{#estado.es_suspendido}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue suspendido{{#estado.por_falta_de_pago}} por saldo pendiente. Se reactiva automáticamente al registrar tu pago.{{/estado.por_falta_de_pago}}{{^estado.por_falta_de_pago}}. Para reactivarlo, comunícate con nosotros.{{/estado.por_falta_de_pago}}{{/estado.es_suspendido}}{{#estado.es_retirado}}Tu servicio{{#servicio.plan}} {{servicio.plan}}{{/servicio.plan}} fue dado de baja.{{/estado.es_retirado}}{{#empresa.portal_url}}\nConsulta y paga en {{empresa.portal_url}}{{/empresa.portal_url}}\n\n{{empresa.nombre}}',
    },
]
const REQUEST_ID = 'migracion:1794820974314_alter_notify_textos_suspension_aaas_table'

export default class extends BaseSchema {
    async up() {
        this.defer(async (db) => {
            for (const texto of TEXTOS) {
                const resultado = await db.rawQuery(
                    `UPDATE notify.plantillas
                            SET cuerpo = ?, version = version + 1, updated_at = now()
                          WHERE evento = ? AND canal = ? AND cuerpo = ?
                      RETURNING id`,
                    [texto.nuevo, texto.evento, texto.canal, texto.original],
                )
                const filas = resultado.rows as Array<{ id: number }>
                for (const fila of filas) await this.auditar(db, Number(fila.id), texto.original, texto.nuevo)
            }
        })
    }

    private async auditar(db: QueryClientContract, id: number, antes: string, despues: string) {
        await db.rawQuery(
            `INSERT INTO audit.cambios (entidad_tipo, entidad_id, campo, antes, despues, actor_tipo, request_id)
             VALUES ('plantilla_notificacion', ?, 'cuerpo', ?::jsonb, ?::jsonb, 'sistema', ?)`,
            [id, JSON.stringify(antes), JSON.stringify(despues), REQUEST_ID],
        )
    }

    async down() {
        // Sin reverso: ver el comentario de arriba.
    }
}
