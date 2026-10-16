import { DomainAction, type Transaccion } from '#shared/domain_action'
import { dec } from '#ledger/dinero'
import RegistrarPago from '#billing/actions/registrar_pago'
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
            .select('id', 'cliente_id', 'estado', 'pago_id', 'facturas')
            .first()) as {
            id: number
            cliente_id: number
            estado: string
            pago_id: number | null
            facturas: Array<number | string>
        } | null
        if (!cobro) return { ...base, cobro_id: null, pago_id: null, ignorado: 'cobro_desconocido' }
        t.fijarEntidad('cobro_pasarela', cobro.id)

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

        const pago = await new RegistrarPago().execute(
            {
                cliente_id: cobro.cliente_id,
                metodo: 'pasarela',
                monto: aviso.monto,
                comision: dec(aviso.comision).gt(0) ? aviso.comision : null,
                pasarela: proveedor,
                referencia: aviso.id_proveedor,
                facturas: cobro.facturas.map(Number),
                nota: `Pago en línea (cobro ${cobro.id})`,
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
