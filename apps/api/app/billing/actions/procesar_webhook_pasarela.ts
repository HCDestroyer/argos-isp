import { DomainAction, type Transaccion } from '#shared/domain_action'
import logger from '@adonisjs/core/services/logger'
import { aTexto, dec } from '#ledger/dinero'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import {
    FirmaInvalida,
    pasarela,
    proveedorConfigurado,
    type NotificacionPasarela,
} from '#billing/pasarelas/pasarela'

/**
 * `pasarela.procesar_webhook` (`POST /pasarela/webhook/:proveedor`, público pero firmado).
 *
 * 1. El adaptador verifica la firma HMAC y la ventana de tiempo (401 `firma_invalida`). Solo se
 *    acepta el proveedor configurado.
 * 2. Idempotente por id del evento del proveedor (`billing.pasarela_eventos`): un webhook
 *    repetido (o dos a la vez) responde lo mismo y no registra otro pago. Además el pago lleva
 *    `referencia = id del cobro en el proveedor`, única por método.
 * 3. `pagado`: `RegistrarPago` anidada con método `pasarela`, el monto pagado, la comisión del
 *    proveedor y las facturas del cobro → asiento `Bancos (neto) + Comisiones / CxC`,
 *    `pago.registrado` y reactivación del servicio en la misma transacción. `fallido`/`expirado`:
 *    solo cambia el estado del cobro.
 * 4. Un cobro desconocido se registra y se responde 200 (`ignorado`) para que el proveedor no
 *    reintente sin fin; la conciliación lo reporta.
 * 5. Monto distinto del cobro: no registra el pago (`ignorado: monto_distinto`, aviso en el log); la
 *    conciliación lo reporta como `pago_sin_registrar` para que contabilidad lo resuelva.
 * 6. Retención de IVA de la emisora (H51, `retenido_iva`): el pago entra por el neto
 *    (monto − retención) con una constancia `RET_IVA_TAR` por la retención (1.1.05), así aplica el
 *    bruto a la deuda y el banco queda por lo que de verdad llega.
 * 7. `reembolsado`: anula el pago del cobro (`AnularPago` anidada: la deuda vuelve y el servicio se
 *    re-evalúa). `disputa` (contracargo): sin acción automática; queda registrada y avisada en el
 *    log, y la conciliación la lista para contabilidad.
 */

export interface EntradaWebhookPasarela {
    proveedor: string
    cuerpo: string
    cabeceras: Record<string, string | undefined>
    ahora?: Date
}

export interface ResultadoWebhookPasarela {
    recibido: true
    duplicado: boolean
    id_evento: string
    cobro_id: number | null
    pago_id: number | null
    estado: string
    ignorado?: string
}

export default class ProcesarWebhookPasarela extends DomainAction<
    EntradaWebhookPasarela,
    ResultadoWebhookPasarela
> {
    readonly nombre = 'pasarela.procesar_webhook'

    protected async handle(input: EntradaWebhookPasarela, t: Transaccion): Promise<ResultadoWebhookPasarela> {
        if (input.proveedor !== proveedorConfigurado()) {
            throw new FirmaInvalida(`La pasarela ${input.proveedor} no está configurada`)
        }
        const adaptador = await pasarela(input.proveedor)
        const aviso = adaptador.verificarWebhook({
            cuerpo: input.cuerpo,
            cabeceras: input.cabeceras,
            ahora: input.ahora,
        })
        if (!aviso.id_evento || !aviso.id_proveedor) {
            throw new FirmaInvalida('Notificación sin id de evento o de cobro')
        }

        // un webhook simultáneo con el mismo id espera aquí a que el primero termine
        const nuevo = (await t.trx.rawQuery(
            `INSERT INTO billing.pasarela_eventos (proveedor, id_evento, id_proveedor, estado, payload)
             VALUES (?, ?, ?, ?, ?::jsonb)
             ON CONFLICT (proveedor, id_evento) DO NOTHING
             RETURNING id`,
            [
                input.proveedor,
                aviso.id_evento,
                aviso.id_proveedor,
                aviso.estado,
                JSON.stringify(aviso.payload),
            ],
        )) as { rows: Array<{ id: number }> }
        if (nuevo.rows.length === 0) {
            const previo = await t.trx
                .from('billing.pasarela_eventos')
                .where('proveedor', input.proveedor)
                .where('id_evento', aviso.id_evento)
                .select('resultado')
                .firstOrFail()
            return { ...(previo.resultado as ResultadoWebhookPasarela), duplicado: true }
        }
        const eventoId = nuevo.rows[0]!.id
        t.fijarEntidad('evento_pasarela', eventoId)

        const resultado = await this.aplicar(t, input.proveedor, aviso)
        await t.trx
            .from('billing.pasarela_eventos')
            .where('id', eventoId)
            .update({ resultado: JSON.stringify(resultado) })
        return resultado
    }

    private async aplicar(
        t: Transaccion,
        proveedor: string,
        aviso: NotificacionPasarela,
    ): Promise<ResultadoWebhookPasarela> {
        const base = {
            recibido: true as const,
            duplicado: false,
            id_evento: aviso.id_evento,
            estado: aviso.estado,
        }
        const cobro = (await t.trx
            .from('billing.pasarela_cobros')
            .where('proveedor', proveedor)
            .where('id_proveedor', aviso.id_proveedor)
            .forUpdate()
            .select('id', 'empresa_id', 'cliente_id', 'estado', 'pago_id', 'facturas', 'monto')
            .first()) as {
            monto: string
            id: number
            empresa_id: number
            cliente_id: number
            estado: string
            pago_id: number | null
            facturas: Array<number | string>
        } | null
        if (aviso.estado === 'disputa') {
            logger.warn(
                {
                    proveedor,
                    id_proveedor: aviso.id_proveedor,
                    disputa: aviso.referencia_evento,
                    cobro_id: cobro?.id,
                },
                'Contracargo abierto en la pasarela: revisar con contabilidad (sin acción automática)',
            )
            return {
                ...base,
                cobro_id: cobro?.id ?? null,
                pago_id: cobro?.pago_id ?? null,
                ignorado: 'disputa',
            }
        }
        if (!cobro) return { ...base, cobro_id: null, pago_id: null, ignorado: 'cobro_desconocido' }
        t.fijarEntidad('cobro_pasarela', cobro.id)
        t.fijarEmpresa(Number(cobro.empresa_id))

        if (aviso.estado === 'reembolsado') {
            if (cobro.pago_id === null) {
                return { ...base, cobro_id: cobro.id, pago_id: null, ignorado: 'reembolso_sin_pago' }
            }
            const pago = (await t.trx
                .from('billing.pagos')
                .where('id', cobro.pago_id)
                .select('estado')
                .first()) as {
                estado: string
            } | null
            if (pago?.estado === 'anulado') {
                return { ...base, cobro_id: cobro.id, pago_id: cobro.pago_id, ignorado: 'pago_ya_anulado' }
            }
            await new AnularPago().execute(
                {
                    pago_id: cobro.pago_id,
                    motivo: `Reembolso en ${proveedor}${aviso.referencia_evento ? ` (${aviso.referencia_evento})` : ''}`,
                },
                t.ctx,
                { trx: t.trx },
            )
            return { ...base, cobro_id: cobro.id, pago_id: cobro.pago_id }
        }

        if (cobro.estado === 'pagado') {
            return { ...base, cobro_id: cobro.id, pago_id: cobro.pago_id, ignorado: 'cobro_ya_pagado' }
        }
        if (aviso.estado !== 'pagado') {
            if (aviso.estado === 'fallido' || aviso.estado === 'expirado') {
                await t.trx
                    .from('billing.pasarela_cobros')
                    .where('id', cobro.id)
                    .update({
                        estado: aviso.estado,
                        version: t.trx.knexRawQuery('version + 1'),
                        updated_at: t.trx.knexRawQuery('now()'),
                    } as Record<string, unknown>)
            }
            return { ...base, cobro_id: cobro.id, pago_id: null }
        }

        if (!dec(aviso.monto).equals(dec(cobro.monto))) {
            logger.warn(
                { proveedor, cobro_id: cobro.id, cobro: aTexto(cobro.monto), pagado: aviso.monto },
                'Pago en línea por un monto distinto del cobro: no se registra (la conciliación lo reporta)',
            )
            return { ...base, cobro_id: cobro.id, pago_id: null, ignorado: 'monto_distinto' }
        }
        // H51: la retención de IVA de la emisora entra como constancia (1.1.05); al banco llega el neto
        const retenido = dec(aviso.retenido_iva ?? '0')
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: cobro.cliente_id,
                metodo: 'pasarela',
                monto: aTexto(dec(aviso.monto).minus(retenido)),
                retenciones: retenido.gt(0)
                    ? [
                          {
                              codigo: 'RET_IVA_TAR',
                              numero: `${proveedor}:${aviso.id_proveedor}`,
                              fecha: null,
                              monto: aTexto(retenido),
                          },
                      ]
                    : undefined,
                comision: dec(aviso.comision).gt(0) ? aviso.comision : null,
                pasarela: proveedor,
                referencia: aviso.id_proveedor,
                facturas: cobro.facturas.map(Number),
                nota: `Pago en línea (cobro ${cobro.id})`,
                // el pago es de la empresa del cobro en línea (no mezcla empresas)
                empresa_id: Number(cobro.empresa_id),
            },
            t.ctx,
            { trx: t.trx },
        )
        await t.trx
            .from('billing.pasarela_cobros')
            .where('id', cobro.id)
            .update({
                estado: 'pagado',
                pago_id: pago.id,
                monto_pagado: aviso.monto,
                comision: aviso.comision,
                pagado_en: aviso.ocurrido_en,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        return { ...base, cobro_id: cobro.id, pago_id: pago.id }
    }
}
