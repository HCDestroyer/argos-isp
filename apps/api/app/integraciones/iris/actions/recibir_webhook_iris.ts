import { DomainAction, type Transaccion } from '#shared/domain_action'
import { envioDeClaveAviso } from '#notify/canales/whatsapp'
import { aplicarAcuseIris } from '#notify/acuses_iris'

/** Eventos de Iris → Argos (contrato Iris 0.6.0 §6.6). */
export const EVENTOS_DE_IRIS = ['aviso.entregado', 'aviso.fallido', 'contacto.baja'] as const

const CANALES_CONTACTO = ['whatsapp', 'telegram', 'correo'] as const
const ORIGENES_BAJA = ['cliente', 'agente'] as const

export interface EntradaRecibirWebhookIris {
    /** `X-Webhook-Id` (o `id` del cuerpo) */
    webhook_id: string
    evento: string
    ocurrido_en: string | null
    payload: Record<string, unknown>
    /** cuerpo completo tal como llegó (se guarda) */
    cuerpo: Record<string, unknown>
}

export interface ResultadoRecibirWebhookIris {
    duplicado: boolean
    estado: 'procesado' | 'ignorado'
    /**
     * `acuse_aplicado` | `sin_cambio` | `envio_no_encontrado` (aviso.*), `baja_registrada` |
     * `baja_anterior` (contacto.baja), `cliente_no_encontrado`, `evento_desconocido`, `payload_invalido`
     */
    resultado: string
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor !== '' ? valor : null
}

function entero(valor: unknown): number | null {
    const n = Number(valor)
    return valor !== null && valor !== undefined && valor !== '' && Number.isSafeInteger(n) && n > 0
        ? n
        : null
}

function instante(valor: unknown): string | null {
    const t = texto(valor)
    return t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null
}

function unoDe<T extends string>(valor: unknown, permitidos: readonly T[]): T | null {
    return typeof valor === 'string' && (permitidos as readonly string[]).includes(valor)
        ? (valor as T)
        : null
}

/**
 * Webhook firmado de Iris → Argos (contrato Iris 0.6.0 §6.6). La firma, el desfase y el conector
 * apagado los revisa la ruta (`receptor.ts`) antes de llamar aquí.
 *
 * - Deduplica por `X-Webhook-Id` (`integraciones.iris_recibidos`): repetido → `duplicado`, nada más.
 * - `aviso.entregado` / `aviso.fallido`: encuentra el envío de notify por `idempotency_key`
 *   (`argos:aviso:<plantilla>:<envio_id>`) y le aplica el acuse (`#notify/acuses_iris`): `enviado` o
 *   `fallido` con el motivo, y `notificacion.enviada`. Un acuse de un envío que ya no está en cola no
 *   cambia nada.
 * - `contacto.baja`: guarda la baja en `notify.contacto_iris` (si no hay una más nueva) y queda en la
 *   línea de tiempo del cliente (esta fila de auditoría, entidad `cliente`, y el diff en
 *   `audit.cambios`). Con canal `whatsapp`, notify deja de pedir avisos por WhatsApp a ese cliente;
 *   no apaga el correo ni el Telegram de Argos (§6.4).
 * - Eventos y campos desconocidos se registran como `ignorado`. Nunca cambia estados de servicios,
 *   facturas ni pagos.
 */
export default class RecibirWebhookIris extends DomainAction<
    EntradaRecibirWebhookIris,
    ResultadoRecibirWebhookIris
> {
    readonly nombre = 'iris.recibir_webhook'

    protected async handle(
        input: EntradaRecibirWebhookIris,
        t: Transaccion,
    ): Promise<ResultadoRecibirWebhookIris> {
        const conocido = (EVENTOS_DE_IRIS as readonly string[]).includes(input.evento)
        const ocurrido = instante(input.ocurrido_en)
        const filas = (await t.trx.rawQuery(
            `INSERT INTO integraciones.iris_recibidos (webhook_id, evento, ocurrido_en, estado, cuerpo)
             VALUES (?, ?, ?, ?, ?::jsonb)
             ON CONFLICT (webhook_id) DO NOTHING
             RETURNING id`,
            [
                input.webhook_id,
                input.evento,
                ocurrido,
                conocido ? 'procesado' : 'ignorado',
                JSON.stringify(input.cuerpo),
            ] as any[],
        )) as { rows: Array<{ id: number }> }
        const id = filas.rows[0]?.id
        if (!id) {
            return { duplicado: true, estado: conocido ? 'procesado' : 'ignorado', resultado: 'duplicado' }
        }
        t.fijarEntidad('webhook_iris', Number(id))
        t.fijarEmpresa(null)

        let salida: ResultadoRecibirWebhookIris
        let enlace: { empresa_id?: number | null; cliente_id?: number | null; envio_id?: number | null } = {}
        if (input.evento === 'aviso.entregado' || input.evento === 'aviso.fallido') {
            const clave = envioDeClaveAviso(input.payload.idempotency_key)
            if (!clave) {
                salida = { duplicado: false, estado: 'ignorado', resultado: 'payload_invalido' }
            } else {
                const acuse = await aplicarAcuseIris(t, {
                    envioId: clave.envioId,
                    tipo: input.evento === 'aviso.entregado' ? 'entregado' : 'fallido',
                    avisoId:
                        texto(input.payload.aviso_id) ?? entero(input.payload.aviso_id)?.toString() ?? null,
                    entregadoEn: texto(input.payload.entregado_en),
                    leidoEn: texto(input.payload.leido_en),
                    motivo: texto(input.payload.motivo),
                    detalle: texto(input.payload.detalle),
                })
                if (acuse.empresa_id !== null) t.fijarEmpresa(acuse.empresa_id)
                enlace = {
                    empresa_id: acuse.empresa_id,
                    cliente_id: acuse.cliente_id,
                    envio_id: clave.envioId,
                }
                salida = {
                    duplicado: false,
                    estado: acuse.encontrado ? 'procesado' : 'ignorado',
                    resultado: !acuse.encontrado
                        ? 'envio_no_encontrado'
                        : acuse.cambio
                          ? 'acuse_aplicado'
                          : 'sin_cambio',
                }
            }
        } else if (input.evento === 'contacto.baja') {
            const r = await this.baja(t, input, ocurrido)
            enlace = { empresa_id: r.empresaId, cliente_id: r.clienteId }
            salida = {
                duplicado: false,
                estado: r.procesado ? 'procesado' : 'ignorado',
                resultado: r.resultado,
            }
        } else {
            salida = { duplicado: false, estado: 'ignorado', resultado: 'evento_desconocido' }
        }

        await t.trx
            .from('integraciones.iris_recibidos')
            .where('id', id)
            .update({
                estado: salida.estado,
                resultado: salida.resultado,
                empresa_id: enlace.empresa_id ?? null,
                cliente_id: enlace.cliente_id ?? null,
                envio_id: enlace.envio_id ?? null,
            })
        return salida
    }

    private async baja(
        t: Transaccion,
        input: EntradaRecibirWebhookIris,
        ocurridoWebhook: string | null,
    ): Promise<{
        procesado: boolean
        resultado: string
        clienteId: number | null
        empresaId: number | null
    }> {
        const p = input.payload
        const clienteId = entero(p.cliente_id)
        const canal = unoDe(p.canal, CANALES_CONTACTO)
        const ocurrido = instante(p.ocurrido_en) ?? ocurridoWebhook ?? new Date().toISOString()
        if (!clienteId || !canal) {
            return { procesado: false, resultado: 'payload_invalido', clienteId: null, empresaId: null }
        }
        const cliente = await t.trx.from('core.clientes').where('id', clienteId).select('id').first()
        if (!cliente) {
            return { procesado: false, resultado: 'cliente_no_encontrado', clienteId: null, empresaId: null }
        }
        let empresaId = entero(p.empresa_id)
        if (empresaId && !(await t.trx.from('core.empresas').where('id', empresaId).select('id').first())) {
            empresaId = null
        }
        t.fijarEntidad('cliente', clienteId)
        t.fijarEmpresa(empresaId)

        const antes = (await t.trx
            .from('notify.contacto_iris')
            .where('cliente_id', clienteId)
            .where('canal', canal)
            .forUpdate()
            .select('estado', 'ocurrido_en')
            .first()) as { estado: string; ocurrido_en: Date } | null
        if (antes && new Date(antes.ocurrido_en).getTime() > Date.parse(ocurrido)) {
            // Un alta más nueva (de Argos, ya enviada a Iris) manda sobre esta baja atrasada
            return { procesado: true, resultado: 'baja_anterior', clienteId, empresaId }
        }
        const origen = unoDe(p.origen, ORIGENES_BAJA) ?? 'cliente'
        await t.trx.rawQuery(
            `INSERT INTO notify.contacto_iris (cliente_id, canal, estado, ocurrido_en, origen, empresa_id, webhook_id)
             VALUES (?, ?, 'baja', ?, ?, ?, ?)
             ON CONFLICT (cliente_id, canal) DO UPDATE SET
                estado = 'baja', ocurrido_en = EXCLUDED.ocurrido_en, origen = EXCLUDED.origen,
                empresa_id = EXCLUDED.empresa_id, webhook_id = EXCLUDED.webhook_id, updated_at = now()`,
            [clienteId, canal, ocurrido, `iris_${origen}`, empresaId, input.webhook_id] as any[],
        )
        await t.registrarCambios(
            { tipo: 'cliente', id: clienteId },
            { [`avisos_${canal}_iris`]: antes?.estado ?? null },
            { [`avisos_${canal}_iris`]: 'baja' },
        )
        return { procesado: true, resultado: 'baja_registrada', clienteId, empresaId }
    }
}
