import type { Transaccion } from '#shared/domain_action'

/**
 * Acuse de un aviso de WhatsApp que Iris tenía en cola (contrato Iris 0.6.0 §6.6): lo aplican el
 * receptor de webhooks (`aviso.entregado`, `aviso.fallido`) y la conciliación de los envíos que
 * esperan hace más de 24 h (`ConciliarAvisosIris`). Solo se llama dentro de una acción.
 *
 * - Solo mueve un envío `whatsapp` que sigue `encolado`: `entregado` → `enviado` (con
 *   `entregado_en` y `leido_en`), `fallido` → `fallido` con el motivo de Iris (las dos emiten
 *   `notificacion.enviada`), `bloqueado` (solo por `GET /mensajeria/avisos/:id`, Iris 0.6.1) →
 *   `omitido` con el motivo, sin evento (como un `202 bloqueado`).
 * - Idempotente: un acuse repetido o atrasado no cambia nada (`cambio: false`). Un `leido_en` que
 *   llega después de la entrega solo completa esa columna.
 * - Sin respaldo por correo: el aviso ya salió por todos los canales del cliente al programarse.
 */

export interface Acuse {
    envioId: number
    tipo: 'entregado' | 'fallido' | 'bloqueado'
    avisoId: string | null
    entregadoEn?: string | null
    leidoEn?: string | null
    /** `vencido`, `numero_invalido`, `rechazado_por_canal`, `agotado` */
    motivo?: string | null
    detalle?: string | null
}

export interface ResultadoAcuse {
    encontrado: boolean
    cambio: boolean
    cliente_id: number | null
    empresa_id: number | null
    estado: string | null
}

function instante(valor: string | null | undefined): string | null {
    return valor && !Number.isNaN(Date.parse(valor)) ? new Date(valor).toISOString() : null
}

export async function aplicarAcuseIris(t: Transaccion, acuse: Acuse): Promise<ResultadoAcuse> {
    const envio = (await t.trx
        .from('notify.envios')
        .where('id', acuse.envioId)
        .where('canal', 'whatsapp')
        .forUpdate()
        .select('id', 'cliente_id', 'empresa_id', 'evento', 'estado', 'proveedor_id', 'leido_en')
        .first()) as {
        id: number
        cliente_id: number | null
        empresa_id: number | null
        evento: string
        estado: string
        proveedor_id: string | null
        leido_en: Date | null
    } | null
    if (!envio) return { encontrado: false, cambio: false, cliente_id: null, empresa_id: null, estado: null }
    const base = {
        encontrado: true,
        cliente_id: envio.cliente_id === null ? null : Number(envio.cliente_id),
        empresa_id: envio.empresa_id === null ? null : Number(envio.empresa_id),
    }
    const leido = instante(acuse.leidoEn)

    if (envio.estado !== 'encolado') {
        if (acuse.tipo === 'entregado' && envio.estado === 'enviado' && leido && !envio.leido_en) {
            await t.trx.from('notify.envios').where('id', envio.id).update({ leido_en: leido })
            return { ...base, cambio: true, estado: envio.estado }
        }
        return { ...base, cambio: false, estado: envio.estado }
    }

    const comun = {
        proveedor_id: envio.proveedor_id ?? acuse.avisoId,
        updated_at: t.trx.knexRawQuery('now()'),
    }
    if (acuse.tipo === 'bloqueado') {
        await t.trx
            .from('notify.envios')
            .where('id', envio.id)
            .update({
                ...comun,
                estado: 'omitido',
                motivo: `Iris: ${acuse.motivo ?? 'bloqueado'}`.slice(0, 500),
            })
        return { ...base, cambio: true, estado: 'omitido' }
    }
    if (acuse.tipo === 'entregado') {
        const entregado = instante(acuse.entregadoEn)
        await t.trx
            .from('notify.envios')
            .where('id', envio.id)
            .update({
                ...comun,
                estado: 'enviado',
                error: null,
                enviado_en: entregado ?? t.trx.knexRawQuery('now()'),
                entregado_en: entregado ?? t.trx.knexRawQuery('now()'),
                leido_en: leido,
            })
    } else {
        const motivo = acuse.motivo ?? 'desconocido'
        await t.trx
            .from('notify.envios')
            .where('id', envio.id)
            .update({
                ...comun,
                estado: 'fallido',
                error: `Iris: ${motivo}${acuse.detalle ? ` (${acuse.detalle})` : ''}`.slice(0, 2000),
            })
    }
    const estado = acuse.tipo === 'entregado' ? 'enviado' : 'fallido'
    if (base.cliente_id !== null) {
        await t.emit('notificacion.enviada', {
            cliente_id: base.cliente_id,
            canal: 'whatsapp',
            evento_origen: envio.evento,
            estado,
        })
    }
    return { ...base, cambio: true, estado }
}
