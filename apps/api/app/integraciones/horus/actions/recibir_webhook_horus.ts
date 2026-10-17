import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { guardarDato } from '#integraciones/horus/datos'

/** Eventos de Horus (§3.4) → eventos internos de Argos. */
export const MAPA_EVENTOS_HORUS = {
    'finding.opened': 'horus.hallazgo_abierto',
    'finding.resolved': 'horus.hallazgo_resuelto',
    'customer.security_state_changed': 'horus.estado_seguridad_cambiado',
    'router.status_changed': 'horus.router_estado_cambiado',
    'infra_service.state_changed': 'horus.servicio_infra_cambiado',
} as const

/** Eventos de prueba de Horus: se responden y no hacen nada más. */
export const EVENTOS_PRUEBA_HORUS = ['ping', 'test'] as const

export interface EntradaRecibirWebhook {
    /** `id` del cuerpo (o `X-Webhook-Id`) */
    webhook_id: string
    /** `event` del cuerpo */
    evento: string
    ocurrido_en: string | null
    data: Record<string, any>
    /** cuerpo completo tal como llegó (se guarda) */
    cuerpo: Record<string, unknown>
}

export interface ResultadoRecibirWebhook {
    duplicado: boolean
    estado: 'procesado' | 'ignorado'
    evento_interno: string | null
}

type Contexto = {
    servicio_id: number | null
    cliente_id: number | null
    empresa_id: number | null
    ip: string | null
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor !== ''
        ? valor
        : valor === null || valor === undefined
          ? null
          : String(valor)
}

function entero(valor: unknown): number | null {
    const n = Number(valor)
    return valor !== null && valor !== undefined && valor !== '' && Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Servicio, cliente y empresa de Argos según `external` del webhook (§3.4; `company_id` desde
 * 1.2.0). El servicio se verifica contra `core.servicios`: su cliente y su empresa mandan sobre lo
 * que diga Horus. Sin servicio, la empresa de `company_id` si existe.
 */
async function contextoDe(trx: TransactionClientContract, data: Record<string, any>): Promise<Contexto> {
    const externo = (data.external ?? {}) as Record<string, unknown>
    const ip = texto(data.customer?.address)
    const servicioId = entero(externo.service_id)
    if (servicioId) {
        const servicio = (await trx
            .from('core.servicios')
            .where('id', servicioId)
            .select('cliente_id', 'empresa_id')
            .first()) as { cliente_id: number; empresa_id: number } | null
        if (servicio) {
            return {
                servicio_id: servicioId,
                cliente_id: Number(servicio.cliente_id),
                empresa_id: Number(servicio.empresa_id),
                ip,
            }
        }
    }
    let empresaId = entero(externo.company_id)
    if (empresaId) {
        const existe = await trx.from('core.empresas').where('id', empresaId).select('id').first()
        if (!existe) empresaId = null
    }
    const clienteId = entero(externo.customer_id)
    let cliente: number | null = null
    if (clienteId) {
        const existe = await trx.from('core.clientes').where('id', clienteId).select('id').first()
        cliente = existe ? clienteId : null
    }
    return { servicio_id: null, cliente_id: cliente, empresa_id: empresaId, ip }
}

/**
 * Webhook firmado de Horus → Argos (`contratos/horus.md` §3.4). La firma, el desfase y el
 * conector apagado los revisa la ruta antes de llamar aquí.
 *
 * - Deduplica por `webhook_id` (`integraciones.horus_recibidos`): repetido → `duplicado`, nada más.
 * - `ping` y `test` se registran y no hacen nada más. Eventos desconocidos se registran como
 *   `ignorado`; campos desconocidos se ignoran (§4).
 * - Los de §3.4 se traducen a eventos internos (`horus.*`) por el outbox, en la misma
 *   transacción: notify los convierte en alertas al equipo y la ficha del servicio los muestra.
 *   **Ningún evento de Horus cambia el estado de un servicio** (solo `evaluarEstadoServicio`).
 * - `customer.security_state_changed` además deja el estado como último dato conocido de la
 *   columna "Seguridad".
 */
export default class RecibirWebhookHorus extends DomainAction<
    EntradaRecibirWebhook,
    ResultadoRecibirWebhook
> {
    readonly nombre = 'horus.recibir_webhook'

    protected async handle(input: EntradaRecibirWebhook, t: Transaccion): Promise<ResultadoRecibirWebhook> {
        const { trx } = t
        const interno =
            (
                MAPA_EVENTOS_HORUS as Record<
                    string,
                    (typeof MAPA_EVENTOS_HORUS)[keyof typeof MAPA_EVENTOS_HORUS]
                >
            )[input.evento] ?? null
        const prueba = (EVENTOS_PRUEBA_HORUS as readonly string[]).includes(input.evento)
        const estado: ResultadoRecibirWebhook['estado'] = interno || prueba ? 'procesado' : 'ignorado'
        const data = input.data ?? {}
        const contexto = interno ? await contextoDe(trx, data) : null
        t.fijarEmpresa(contexto?.empresa_id ?? null)

        const ocurrido =
            input.ocurrido_en && !Number.isNaN(Date.parse(input.ocurrido_en)) ? input.ocurrido_en : null
        const filas = (await trx.rawQuery(
            `INSERT INTO integraciones.horus_recibidos
                (webhook_id, evento, ocurrido_en, estado, evento_interno, empresa_id, servicio_id, cuerpo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb)
             ON CONFLICT (webhook_id) DO NOTHING
             RETURNING id`,
            [
                input.webhook_id,
                input.evento,
                ocurrido,
                estado,
                interno,
                contexto?.empresa_id ?? null,
                contexto?.servicio_id ?? null,
                JSON.stringify(input.cuerpo),
            ] as any[],
        )) as { rows: Array<{ id: number }> }
        const id = filas.rows[0]?.id
        if (!id) return { duplicado: true, estado, evento_interno: interno }
        t.fijarEntidad('webhook_horus', Number(id))
        if (!interno || !contexto) return { duplicado: false, estado, evento_interno: null }

        const comun = { webhook_id: input.webhook_id, ...contexto }
        switch (interno) {
            case 'horus.hallazgo_abierto':
            case 'horus.hallazgo_resuelto': {
                const f = (data.finding ?? {}) as Record<string, unknown>
                await t.emit(interno, {
                    ...comun,
                    hallazgo: {
                        id: texto(f.id),
                        tipo: texto(f.kind),
                        severidad: texto(f.severity),
                        resumen: texto(f.summary),
                        abierto_en: texto(f.opened_at),
                        reabierto: f.reopened === true,
                    },
                })
                break
            }
            case 'horus.estado_seguridad_cambiado': {
                const estadoSeguridad = texto(data.state) ?? 'desconocido'
                await t.emit(interno, {
                    ...comun,
                    estado: estadoSeguridad,
                    estado_anterior: texto(data.previous_state),
                    hallazgos_abiertos: Number.isInteger(data.open_findings)
                        ? Number(data.open_findings)
                        : null,
                })
                if (contexto.servicio_id) {
                    await guardarDato(
                        'seguridad',
                        `servicio:${contexto.servicio_id}`,
                        contexto.servicio_id,
                        {
                            estado: estadoSeguridad,
                            hallazgos_abiertos: Number.isInteger(data.open_findings)
                                ? Number(data.open_findings)
                                : null,
                            severidad_maxima: null,
                            desde: ocurrido,
                            fuente: 'webhook',
                        },
                        trx,
                    )
                }
                break
            }
            case 'horus.router_estado_cambiado': {
                const r = (data.router ?? {}) as Record<string, unknown>
                await t.emit(interno, {
                    webhook_id: input.webhook_id,
                    router: {
                        id: texto(r.id) ?? '?',
                        nombre: texto(r.name),
                        estado: texto(r.status) ?? 'desconocido',
                        estado_anterior: texto(r.previous_status),
                        motivo: texto(r.reason),
                    },
                })
                break
            }
            case 'horus.servicio_infra_cambiado': {
                const s = (data.service ?? {}) as Record<string, unknown>
                await t.emit(interno, {
                    webhook_id: input.webhook_id,
                    servicio_infra: {
                        id: texto(s.id) ?? '?',
                        nombre: texto(s.name),
                        estado: texto(s.status) ?? 'desconocido',
                        estado_anterior: texto(s.previous_status),
                        motivo: texto(s.reason),
                    },
                })
                break
            }
        }
        return { duplicado: false, estado, evento_interno: interno }
    }
}
