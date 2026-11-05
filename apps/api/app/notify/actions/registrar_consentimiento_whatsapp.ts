import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
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
    /**
     * Empresa del permiso (obligatoria en Iris, contrato 0.6.1). Por defecto: la empresa activa del
     * contexto, la única de los servicios no retirados del cliente o la única empresa activa de la
     * instalación; si no se puede saber, 422 `empresa_requerida`.
     */
    empresa_id?: number | null
}

/**
 * `notificaciones.registrar_consentimiento`: permiso de contacto por WhatsApp hacia Iris (contrato
 * Iris 0.6.0 §6.4, pedido A21). El registro vive **solo en Iris**: esta acción lo deja en la cola
 * `notify.consentimientos_iris` y `iris:worker` lo manda a `POST /mensajeria/consentimientos` con
 * `Idempotency-Key = argos:consentimiento:<empresa_id>:<cliente_id>:whatsapp:<ocurrido_en>`. Con el conector
 * apagado (o con contrato < 0.6.0) queda pendiente y sale al activarse.
 *
 * - Idempotente por esa clave: la misma marca repetida no crea otra fila.
 * - `baja` deja de pedir avisos por WhatsApp al instante (`notify.contacto_iris`), sin esperar a
 *   Iris; un `acepta` más nuevo que la última baja la levanta en Argos (Iris decide igual: una
 *   baja dada en el chat manda, §6.4).
 * - Empresa obligatoria (Iris 0.6.1): la de la entrada, la activa o la única posible (`empresaDelConsentimiento`).
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
        const empresaId = await empresaDelConsentimiento(t.trx, input, t.ctx.empresaId ?? null)
        t.fijarEmpresa(empresaId)

        const ocurrido = new Date(input.ocurrido_en ?? Date.now()).toISOString()
        const clave = claveConsentimiento(empresaId, input.cliente_id, 'whatsapp', ocurrido)
        const insertadas = (await t.trx.rawQuery(
            `INSERT INTO notify.consentimientos_iris
                (empresa_id, cliente_id, canal, estado, origen, ocurrido_en, idempotency_key, registrado_por, request_id)
             VALUES (?, ?, 'whatsapp', ?, ?, ?, ?, ?, ?)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING id`,
            [
                empresaId,
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

/** Empresa del permiso de contacto (ver `EntradaConsentimiento.empresa_id`). */
async function empresaDelConsentimiento(
    trx: TransactionClientContract,
    input: EntradaConsentimiento,
    activa: number | null,
): Promise<number> {
    const pedida = input.empresa_id ?? activa
    if (pedida) {
        const existe = await trx.from('core.empresas').where('id', pedida).select('id').first()
        if (!existe) throw new ReglaNegocio(`La empresa ${pedida} no existe`, 'empresa_requerida')
        return Number(pedida)
    }
    const deServicios = (await trx
        .from('core.servicios')
        .where('cliente_id', input.cliente_id)
        .whereNot('estado', 'retirado')
        .distinct('empresa_id')) as Array<{ empresa_id: number }>
    if (deServicios.length === 1) return Number(deServicios[0]!.empresa_id)
    if (deServicios.length === 0) {
        const activas = (await trx.from('core.empresas').where('activa', true).select('id')) as Array<{
            id: number
        }>
        if (activas.length === 1) return Number(activas[0]!.id)
    }
    throw new ReglaNegocio(
        'Indica la empresa del permiso de contacto (el cliente tiene servicios en varias o no se puede deducir)',
        'empresa_requerida',
    )
}
