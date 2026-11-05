import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { claveConsentimiento, verConsentimiento, type VistaConsentimiento } from '#notify/consentimientos'

export interface EntradaConsentimiento {
    cliente_id: number
    /** `acepta`: marcó «Acepta avisos por WhatsApp»; `baja`: la desmarcó */
    estado: 'acepta' | 'baja'
    /** `argos_panel` (alta o edición del cliente, A4) o `argos_portal` (el cliente, A5) */
    origen: 'argos_panel' | 'argos_portal'
    /** cuándo lo marcó (por defecto, ahora); entra en la `Idempotency-Key` */
    ocurrido_en?: Date | string
}

/**
 * `notificaciones.registrar_consentimiento`: permiso de contacto por WhatsApp hacia Iris (contrato
 * Iris 0.6.0 §6.4, pedido A21). El registro vive **solo en Iris**: esta acción lo deja en la cola
 * `notify.consentimientos_iris` y `iris:worker` lo manda a `POST /mensajeria/consentimientos` con
 * `Idempotency-Key = argos:consentimiento:<cliente_id>:whatsapp:<ocurrido_en>`. Con el conector
 * apagado (o con contrato < 0.6.0) queda pendiente y sale al activarse.
 *
 * - Idempotente por esa clave: la misma marca repetida no crea otra fila.
 * - `baja` deja de pedir avisos por WhatsApp al instante (`notify.contacto_iris`), sin esperar a
 *   Iris; un `acepta` más nuevo que la última baja la levanta en Argos (Iris decide igual: una
 *   baja dada en el chat manda, §6.4).
 * - Queda en la línea de tiempo del cliente (entidad `cliente` y diff en `audit.cambios`). Sin
 *   evento: no cambia estado de negocio de Argos.
 */
export default class RegistrarConsentimientoWhatsapp extends DomainAction<
    EntradaConsentimiento,
    VistaConsentimiento
> {
    readonly nombre = 'notificaciones.registrar_consentimiento'

    protected async handle(input: EntradaConsentimiento, t: Transaccion): Promise<VistaConsentimiento> {
        const cliente = await t.trx.from('core.clientes').where('id', input.cliente_id).select('id').first()
        if (!cliente) throw new NoEncontrado(`El cliente ${input.cliente_id} no existe`)
        t.fijarEntidad('cliente', input.cliente_id)
        t.fijarEmpresa(null)

        const ocurrido = new Date(input.ocurrido_en ?? Date.now()).toISOString()
        const clave = claveConsentimiento(input.cliente_id, 'whatsapp', ocurrido)
        const insertadas = (await t.trx.rawQuery(
            `INSERT INTO notify.consentimientos_iris
                (cliente_id, canal, estado, origen, ocurrido_en, idempotency_key, registrado_por, request_id)
             VALUES (?, 'whatsapp', ?, ?, ?, ?, ?, ?)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING id`,
            [
                input.cliente_id,
                input.estado,
                input.origen,
                ocurrido,
                clave,
                usuarioDelActor(t.ctx.actor),
                t.ctx.requestId,
            ] as any[],
        )) as { rows: Array<{ id: number }> }
        if (insertadas.rows.length === 0) {
            return verConsentimiento(t.trx, clave)
        }

        const antes = (await t.trx
            .from('notify.contacto_iris')
            .where('cliente_id', input.cliente_id)
            .where('canal', 'whatsapp')
            .forUpdate()
            .select('estado', 'ocurrido_en')
            .first()) as { estado: string; ocurrido_en: Date } | null
        if (!antes || new Date(antes.ocurrido_en).getTime() <= Date.parse(ocurrido)) {
            await t.trx.rawQuery(
                `INSERT INTO notify.contacto_iris (cliente_id, canal, estado, ocurrido_en, origen)
                 VALUES (?, 'whatsapp', ?, ?, ?)
                 ON CONFLICT (cliente_id, canal) DO UPDATE SET
                    estado = EXCLUDED.estado, ocurrido_en = EXCLUDED.ocurrido_en, origen = EXCLUDED.origen,
                    webhook_id = NULL, updated_at = now()`,
                [input.cliente_id, input.estado, ocurrido, input.origen] as any[],
            )
            await t.registrarCambios(
                { tipo: 'cliente', id: input.cliente_id },
                { avisos_whatsapp_iris: antes?.estado ?? null },
                { avisos_whatsapp_iris: input.estado },
            )
        }
        return verConsentimiento(t.trx, clave)
    }
}
