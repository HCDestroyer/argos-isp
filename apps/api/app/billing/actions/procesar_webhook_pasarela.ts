import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import logger from '@adonisjs/core/services/logger'
import { aTexto, dec } from '#ledger/dinero'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
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
 * 7. `reembolsado`: total → anula el pago del cobro (`AnularPago` anidada: la deuda vuelve y el
 *    servicio se re-evalúa); parcial (H60) → anula y registra en la misma transacción un pago nuevo por
 *    lo que queda (ver `reembolsar`). `disputa` (contracargo): sin acción automática; queda registrada y avisada en el
 *    log, y la conciliación la lista para contabilidad.
 * 8. Un error de negocio al aplicar un aviso auténtico (H61) se responde 2xx con `ignorado:
 *    error_de_negocio` y `error`, queda en el evento y en el log: el proveedor no reintenta sin fin y la
 *    conciliación lo reporta.
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
    /** error de negocio que impidió aplicar el aviso (respondido 2xx para que el proveedor no reintente) */
    error?: string
    /** reembolso parcial (H60): el pago nuevo por lo que queda */
    pago_reemplazo_id?: number
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

        let resultado: ResultadoWebhookPasarela
        // todo lo que aplica el aviso va en un savepoint: si falla por negocio, se deshace entero
        await t.trx.rawQuery('SAVEPOINT webhook_aplicar')
        try {
            resultado = await this.aplicar(t, input.proveedor, aviso)
            await t.trx.rawQuery('RELEASE SAVEPOINT webhook_aplicar')
        } catch (error) {
            await t.trx.rawQuery('ROLLBACK TO SAVEPOINT webhook_aplicar')
            // H61: un aviso auténtico con un error de negocio responde 2xx (si no, el proveedor reintenta
            // sin fin) y deja la alerta en el log y en el evento; la conciliación lo reporta
            if (!(error instanceof Problema) || error.status >= 500) throw error
            logger.warn(
                {
                    proveedor: input.proveedor,
                    id_evento: aviso.id_evento,
                    id_proveedor: aviso.id_proveedor,
                    error: error.tipo,
                },
                `Aviso de la pasarela sin aplicar: ${error.detalle ?? error.message}`,
            )
            resultado = {
                recibido: true,
                duplicado: false,
                id_evento: aviso.id_evento,
                estado: aviso.estado,
                cobro_id: null,
                pago_id: null,
                ignorado: 'error_de_negocio',
                error: `${error.tipo.split(':').at(-1)}: ${error.detalle ?? error.message}`,
            }
        }
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
            if (cobro?.pago_id) await this.avisarDisputa(t, proveedor, aviso, cobro)
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

        if (aviso.estado === 'reembolsado') return this.reembolsar(t, proveedor, aviso, cobro, base)

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

    /**
     * `pago.disputa_abierta` en la misma transacción que registra el aviso: una vez por pago (el
     * primer aviso de contracargo del cobro; los `dispute.update` siguientes no lo repiten).
     */
    private async avisarDisputa(
        t: Transaccion,
        proveedor: string,
        aviso: NotificacionPasarela,
        cobro: { id: number; empresa_id: number; cliente_id: number; pago_id: number | null },
    ) {
        const previos = (await t.trx
            .from('billing.pasarela_eventos')
            .where({ proveedor, id_proveedor: aviso.id_proveedor, estado: 'disputa' })
            .whereNot('id_evento', aviso.id_evento)
            .count('* as n')
            .first()) as { n: number | string }
        if (Number(previos.n) > 0) return
        const pago = (await t.trx
            .from('billing.pagos')
            .where('id', cobro.pago_id!)
            .select('monto')
            .firstOrFail()) as {
            monto: string
        }
        const razon = (aviso.payload as Record<string, unknown>).reason
        t.fijarEmpresa(Number(cobro.empresa_id))
        await t.emit('pago.disputa_abierta', {
            pago_id: Number(cobro.pago_id),
            empresa_id: Number(cobro.empresa_id),
            cobro_id: Number(cobro.id),
            cliente_id: Number(cobro.cliente_id),
            monto: aTexto(pago.monto),
            proveedor,
            motivo: typeof razon === 'string' && razon ? razon : null,
        })
    }

    /**
     * Reembolso hecho en el proveedor (H60). Total (lo reembolsado ≥ el pago vigente): anula el pago.
     * Parcial: anula el pago vigente y, en la misma transacción, registra uno nuevo por lo que queda
     * (pago − reembolsado) a las mismas facturas, con la misma comisión (§15 #104) y sus constancias,
     * referencia `<referencia>:reembolso:<id>`; el cobro apunta al pago nuevo. Así la deuda vuelve solo
     * por lo reembolsado. H65: se aplica aunque lo que queda sea menor que la comisión (el banco recibe
     * un neto negativo). H70: constancias siempre en proporción a lo que queda (§15 #105). H71: con
     * `monto_cuenta`, el banco baja por lo debitado a la cuenta y la diferencia es comisión devuelta.
     * Idempotente por id del reembolso.
     */
    private async reembolsar(
        t: Transaccion,
        proveedor: string,
        aviso: NotificacionPasarela,
        cobro: { id: number; empresa_id: number; cliente_id: number; pago_id: number | null },
        base: { recibido: true; duplicado: boolean; id_evento: string; estado: string },
    ): Promise<ResultadoWebhookPasarela> {
        if (cobro.pago_id === null) {
            return { ...base, cobro_id: cobro.id, pago_id: null, ignorado: 'reembolso_sin_pago' }
        }
        const refundId = aviso.referencia_evento ?? aviso.id_evento
        const aplicado = await t.trx
            .from('billing.pasarela_eventos')
            .where({ proveedor, id_proveedor: aviso.id_proveedor, estado: 'reembolsado' })
            .whereNot('id_evento', aviso.id_evento)
            .whereRaw(`payload->'refund'->>'id' = ?`, [refundId])
            .whereRaw(`coalesce(resultado->>'ignorado', '') = ''`)
            .select('id')
            .first()
        if (aplicado) {
            return { ...base, cobro_id: cobro.id, pago_id: cobro.pago_id, ignorado: 'reembolso_ya_aplicado' }
        }
        const pago = (await t.trx
            .from('billing.pagos')
            .where('id', cobro.pago_id)
            .select(
                'id',
                'estado',
                'monto',
                'retenido',
                'comision',
                'referencia',
                'cliente_id',
                'proveedor_cobro_id',
            )
            .firstOrFail()) as {
            id: number
            estado: string
            monto: string
            retenido: string
            comision: string
            referencia: string | null
            cliente_id: number
            proveedor_cobro_id: number | null
        }
        if (pago.estado === 'anulado') {
            return { ...base, cobro_id: cobro.id, pago_id: cobro.pago_id, ignorado: 'pago_ya_anulado' }
        }
        const reembolsado = dec(aviso.monto)
        const queda = dec(pago.monto).minus(reembolsado)
        // H71: lo devuelto al cliente vuelve a la deuda; el banco baja por lo debitado a la cuenta del
        // comercio (`account_refunded_amount_in_cents`) y la diferencia es comisión devuelta (5.1.02).
        // Sin el monto de la cuenta, la de antes: la comisión se conserva (parcial) o se revierte (total).
        // Con proveedor de cobro la comisión real sale en la liquidación: no se ajusta aquí.
        const devuelta =
            aviso.monto_cuenta && pago.proveedor_cobro_id === null && reembolsado.gt(0)
                ? reembolsado.minus(aviso.monto_cuenta)
                : null
        const comision = dec(pago.comision)
        // comisión que queda de gasto tras el reembolso (H71)
        const comisionFinal = devuelta === null ? comision : comision.minus(devuelta)
        if (devuelta !== null && (devuelta.isNegative() || comisionFinal.isNegative())) {
            throw new Problema(
                422,
                'reembolso_monto_cuenta',
                'Monto de la cuenta inválido',
                `El reembolso ${refundId} debita Q${aTexto(aviso.monto_cuenta!)} a la cuenta y devuelve Q${aTexto(reembolsado)} al cliente: la comisión devuelta (Q${aTexto(devuelta)}) no cabe en la comisión del pago (Q${aTexto(comision)})`,
            )
        }
        const facturas = (await t.trx
            .from('billing.pagos_aplicaciones')
            .where('pago_id', pago.id)
            .orderBy('id', 'asc')
            .select('factura_id')) as Array<{ factura_id: number }>
        const constancias = (await t.trx
            .from('ledger.constancias_retencion')
            .where({ pago_id: pago.id, direccion: 'recibida' })
            .select(
                'impuesto_codigo',
                'numero',
                t.trx.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`),
                'monto',
            )) as Array<{
            impuesto_codigo: string
            numero: string
            fecha: string
            monto: string
        }>
        const motivo = `Reembolso en ${proveedor} (${refundId})`
        await new AnularPago().execute(
            {
                pago_id: pago.id,
                motivo:
                    reembolsado.gt(0) && queda.gt(0)
                        ? `${motivo}: parcial de Q${aTexto(reembolsado)}`
                        : motivo,
            },
            t.ctx,
            { trx: t.trx },
        )
        // total (o sin monto en el aviso): solo se anula; la anulación revierte la comisión entera y, con
        // el monto de la cuenta (H71), la que no se devolvió vuelve a gasto contra el banco
        if (reembolsado.lte(0) || queda.lte(0)) {
            if (devuelta !== null && comisionFinal.gt(0)) {
                await this.comisionRetenida(t, pago.id, Number(cobro.empresa_id), comisionFinal, refundId)
            }
            return { ...base, cobro_id: cobro.id, pago_id: pago.id }
        }

        // H70 · §15 #105 (decisión del líder, provisional): las constancias se prorratean siempre por lo
        // que queda / pago, sin umbral; el reembolso total las deja en 0 (solo se anula)
        const factor = queda.div(pago.monto)
        const retenciones = constancias
            .map((c) => ({
                codigo: c.impuesto_codigo,
                numero: c.numero,
                fecha: c.fecha,
                monto: aTexto(dec(c.monto).times(factor)),
            }))
            .filter((c) => dec(c.monto).gt(0))
        const retenidoReemplazo = retenciones.reduce((a, c) => a.plus(c.monto), dec('0'))
        const reemplazo = await new RegistrarPago().execute(
            {
                cliente_id: Number(pago.cliente_id),
                metodo: 'pasarela',
                monto: aTexto(queda.minus(retenidoReemplazo)),
                // H65: la comisión se mantiene como gasto aunque supere lo que queda (§15 #104), menos la
                // que el proveedor devolvió (H71)
                comision: comisionFinal.gt(0) ? aTexto(comisionFinal) : null,
                reemplazo_de_reembolso: true,
                pasarela: proveedor,
                referencia: `${pago.referencia ?? aviso.id_proveedor}:reembolso:${refundId}`,
                facturas: facturas.map((f) => Number(f.factura_id)),
                retenciones: retenciones.length > 0 ? retenciones : undefined,
                nota: `Pago en línea (cobro ${cobro.id}) tras el reembolso parcial ${refundId} del pago ${pago.id}`,
                empresa_id: Number(cobro.empresa_id),
            },
            t.ctx,
            { trx: t.trx },
        )
        await t.trx
            .from('billing.pasarela_cobros')
            .where('id', cobro.id)
            .update({
                pago_id: reemplazo.id,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        return { ...base, cobro_id: cobro.id, pago_id: pago.id, pago_reemplazo_id: reemplazo.id }
    }

    /**
     * Reembolso total con el monto de la cuenta (H71): la anulación revirtió la comisión entera; la que
     * el proveedor no devolvió es gasto contra el mismo banco que recibió el pago (asiento `ajuste`
     * sin documento, como un asiento manual sobre bancos).
     */
    private async comisionRetenida(
        t: Transaccion,
        pagoId: number,
        empresaId: number,
        monto: ReturnType<typeof dec>,
        refundId: string,
    ) {
        const banco = (await t.trx
            .from('ledger.asientos as a')
            .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where({ 'a.origen_tipo': 'pago', 'a.origen_id': pagoId })
            .whereNull('a.reversa_de')
            .where('c.codigo', 'like', '1.1.02%')
            .orderBy('m.id', 'asc')
            .select('m.cuenta_id')
            .first()) as { cuenta_id: number } | null
        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha: hoyGuatemala(),
                descripcion: `Comisión no devuelta del pago ${pagoId} en el reembolso ${refundId}`,
                origen_tipo: 'ajuste',
                movimientos: [
                    { cuenta: CUENTAS.COMISIONES_PASARELAS, debe: aTexto(monto) },
                    {
                        cuenta: banco ? Number(banco.cuenta_id) : CUENTAS.BANCO_PRINCIPAL,
                        haber: aTexto(monto),
                    },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
    }
}
