import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { dec } from '#ledger/dinero'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { aplicarAnticipos, bloquearCliente, revertirAplicacionesDeNotas } from '#billing/cobros'
import { columnasFactura, type FacturaFila } from '#billing/facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import { hoyGuatemala } from '#ledger/fechas'
import { ERROR_DOCUMENTO_ANULADO, dteVigente, finPlazoAnulacion, type DteFila } from '#fiscal/fel/dte'
import { AnulacionFueraDePlazo, DteEnProceso } from '#fiscal/fel/errores'
import { diferimientoDeFactura } from '#ledger/diferidos'
import { aperturaCerradaPara, asientoDeApertura } from '#ledger/apertura'

/**
 * H50 / H64 (decisiones del líder): si el saldo de una importada (`CxC / 2.9.01`) ya entró en un
 * cierre de apertura (cierre vigente con fecha ≥ la de su asiento), anularla lo devolvería a 2.9.01 y
 * reabriría el saldo trasladado a patrimonio: se acredita con una nota de crédito (rebaja de ventas
 * del periodo). 409 `importada_con_apertura_cerrada`. Una importada posterior al último cierre se
 * anula normal contra 2.9.01 (corrige la importación).
 */
async function exigirAnulableImportada(t: Transaccion, facturaId: number, empresaId: number) {
    // el asiento de la importada lleva el saldo al haber de 2.9.01 (H66: decide su registro, no su fecha)
    const importada = await asientoDeApertura(t.trx, ['factura', 'mora'], facturaId)
    if (!importada) return
    if (!(await aperturaCerradaPara(t.trx, empresaId, importada))) return
    throw new Conflicto(
        `La factura ${facturaId} es importada y su saldo ya entró en el cierre de apertura: acredítala con una nota de crédito (rebaja de ventas del periodo)`,
        'importada_con_apertura_cerrada',
        'Importada con la apertura cerrada',
    )
}

/** Bloquea el DTE sin esperar: si el worker lo está enviando, 409 `dte_en_proceso`. */
async function bloquearDte(t: Transaccion, dteId: number): Promise<void> {
    try {
        await t.trx.rawQuery('SELECT id FROM fiscal.dte WHERE id = ? FOR UPDATE NOWAIT', [dteId])
    } catch {
        throw new DteEnProceso(dteId)
    }
}

/**
 * `facturas.anular` (`POST /facturas/:id/anular`, permiso `facturas.anular`, con motivo).
 *
 * - Saldo a favor de notas de crédito aplicado a la factura (lealtad §15.2): se revierte primero (fila de
 *   reverso en `notas_credito_aplicaciones` y asiento `CxC / Anticipos`), vuelve a Anticipos y, al
 *   final, se aplica a la otra deuda del cliente.
 * - 409 `factura_con_pagos` si la factura (o una de sus moras) tiene pagos aplicados: hay que
 *   anular el pago primero. 409 `factura_con_notas_credito` si tiene notas de crédito (se
 *   acredita el resto con otra nota). 409 `factura_anulada` si ya estaba anulada.
 * - Pasa a `anulada` con quién/cuándo/motivo; nunca se borra. Sus recargos de mora pendientes
 *   se anulan con ella (cada uno con su reverso y su evento).
 * - Revierte su asiento (`factura` o `mora`) con `RevertirAsiento`: el saldo del cliente baja.
 * - Evento `factura.anulada` y re-evaluación del servicio: si ya no le quedan vencidas, se
 *   reactiva en la misma transacción.
 * - La `clave_unica` del periodo sigue ocupada: `generarFacturas` no vuelve a emitir ese periodo.
 * - FEL (contrato de localización fiscal §8.3): con DTE certificado, dentro de
 *   `dte_anulacion_plazo` el DTE pasa a `anulacion_pendiente` y la factura se anula cuando el
 *   certificador lo confirma (`fel.anular_dte`, en dos pasos); fuera de plazo 422
 *   `anulacion_fuera_de_plazo` (sugiere nota de crédito). Un DTE aún sin certificar se descarta
 *   (`rechazado` local, `documento_anulado`). La reclasificación del IVA del aviso se revierte con la
 *   factura: `2.1.11` y `2.1.02` quedan como antes de emitirla. Una `por_certificar` (sin asiento)
 *   no emite `factura.anulada`.
 */

export interface EntradaAnularFactura {
    factura_id: number
    motivo: string
    /**
     * interno: el certificador ya confirmó la anulación del DTE (`fel.anular_dte`); se completa la
     * anulación de la factura
     */
    tras_anular_dte?: boolean
}

export default class AnularFactura extends DomainAction<EntradaAnularFactura, FacturaFila> {
    readonly nombre = 'facturas.anular'

    protected async handle(input: EntradaAnularFactura, t: Transaccion): Promise<FacturaFila> {
        t.fijarEntidad('factura', input.factura_id)
        const previa = await t.trx
            .from('billing.facturas')
            .where('id', input.factura_id)
            .select('cliente_id')
            .first()
        if (!previa) throw new NoEncontrado(`La factura ${input.factura_id} no existe`)
        // fase 5 (§10.10): el ingreso de una factura diferida está en 2.1.12; anularla o acreditarla
        // dejaría el diferimiento sin ingreso que devolver (confirmar con contador cómo revertirlo)
        const diferida = await diferimientoDeFactura(t.trx, input.factura_id)
        if (diferida) {
            throw new Conflicto(
                `La factura ${input.factura_id} tiene su ingreso diferido (diferimiento ${diferida.id})`,
                'factura_diferida',
                'Factura diferida',
            )
        }
        await bloquearCliente(t.trx, previa.cliente_id)

        const facturas = (await t.trx
            .from('billing.facturas')
            .where((q) => q.where('id', input.factura_id).orWhere('factura_origen_id', input.factura_id))
            .orderBy('id', 'asc')
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'cliente_id',
                'servicio_id',
                'tipo',
                'estado',
                'total',
                'pagado',
                'vencida_en',
                t.trx.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
            )) as Array<{
            id: number
            empresa_id: number
            cliente_id: number
            servicio_id: number | null
            tipo: 'servicio' | 'mora'
            estado: string
            total: string
            pagado: string
            vencida_en: Date | null
            vence_en: string
        }>
        const factura = facturas.find((f) => f.id === input.factura_id)!
        exigirAccesoEmpresa(t.ctx, Number(factura.empresa_id))
        t.fijarEmpresa(Number(factura.empresa_id))
        if (factura.estado === 'anulada') {
            throw new Conflicto(
                `La factura ${factura.id} ya está anulada`,
                'factura_anulada',
                'Factura anulada',
            )
        }
        // desvío (g) de la fase 4: el castigo cerró su saldo en el libro; anularla lo dejaría colgado
        const castigadas = facturas.filter((f) => f.estado === 'castigada')
        if (castigadas.length > 0) {
            throw new Conflicto(
                `La factura ${factura.id} está castigada (${castigadas.map((f) => `factura ${f.id}`).join(', ')}); se corrige con un ajuste`,
                'factura_castigada',
                'Factura castigada',
            )
        }
        const conNotas = await t.trx
            .from('billing.notas_credito as n')
            .whereIn(
                'n.factura_id',
                facturas.map((f) => f.id),
            )
            .whereNotExists((q) =>
                q.from('billing.notas_credito_anulaciones as x').whereRaw('x.nota_id = n.id'),
            )
            .orderBy('id', 'asc')
            .select('id', 'factura_id')
        if (conNotas.length > 0) {
            throw new Conflicto(
                `La factura ${factura.id} tiene notas de crédito (${conNotas
                    .map((n) => `nota ${n.id} de la factura ${n.factura_id}`)
                    .join(', ')}); acredita el resto con otra nota en lugar de anularla`,
                'factura_con_notas_credito',
                'Factura con notas de crédito',
            )
        }
        // decisión del líder: el saldo a favor de notas que recibió vuelve a Anticipos (fila de reverso y
        // asiento CxC / Anticipos); si además tiene pagos, sigue la regla de pagos (409)
        const revertidas = await revertirAplicacionesDeNotas(
            t,
            facturas.filter((f) => f.estado !== 'anulada'),
            `anulación de la factura ${factura.id}: ${input.motivo.trim()}`,
        )
        const conPagos = facturas.filter((f) => f.estado !== 'anulada' && dec(f.pagado).gt(0))
        if (conPagos.length > 0) {
            throw new Conflicto(
                `La factura ${factura.id} tiene pagos aplicados (${conPagos
                    .map((f) => `factura ${f.id}: Q${f.pagado}`)
                    .join(', ')}); anula primero el pago`,
                'factura_con_pagos',
                'Factura con pagos',
            )
        }

        const motivo = input.motivo.trim()
        const anular = facturas.filter((f) => f.estado !== 'anulada')

        // FEL: el DTE de cada documento del grupo (la factura y sus moras con NDEB)
        const dtes: DteFila[] = []
        for (const f of anular) {
            const dte = await dteVigente(t.trx, f.tipo === 'mora' ? 'nota_debito' : 'factura', f.id)
            if (dte) dtes.push(dte)
        }
        const certificados = dtes.filter(
            (d) => d.estado === 'certificado' || d.estado === 'anulacion_pendiente',
        )
        if (!input.tras_anular_dte && certificados.length > 0) {
            const principal = certificados.find((d) => d.documento_id === factura.id)
            if (!principal || certificados.length > 1) {
                throw new Conflicto(
                    `La factura ${factura.id} tiene recargos de mora certificados como nota de débito: anúlalos primero`,
                    'factura_con_ndeb',
                    'Factura con nota de débito',
                )
            }
            if (principal.estado === 'anulacion_pendiente') {
                throw new Conflicto(
                    `La anulación del DTE de la factura ${factura.id} ya se envió al certificador`,
                    'anulacion_en_proceso',
                    'Anulación en proceso',
                )
            }
            // el plazo corre desde la emisión del documento (decisión del líder; días hábiles en la fase 6)
            const emision = (await t.trx
                .from('billing.facturas')
                .where('id', factura.id)
                .select('emitida_en')
                .firstOrFail()) as { emitida_en: Date }
            const limite = finPlazoAnulacion(new Date(emision.emitida_en))
            if (hoyGuatemala() > limite) throw new AnulacionFueraDePlazo(limite)
            await bloquearDte(t, principal.id)
            await t.trx
                .from('fiscal.dte')
                .where('id', principal.id)
                .update({
                    estado: 'anulacion_pendiente',
                    motivo_anulacion: motivo,
                    proximo_intento: t.trx.knexRawQuery('now()'),
                    intentos: 0,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.registrarCambios(
                { tipo: 'dte', id: principal.id },
                { estado: 'certificado' },
                { estado: 'anulacion_pendiente' },
            )
            t.fijarEntidad('factura', factura.id)
            if (revertidas.size > 0) await aplicarAnticipos(t, factura.cliente_id, Number(factura.empresa_id))
            return (await t.trx
                .from('billing.facturas as f')
                .where('f.id', factura.id)
                .select(...columnasFactura(t.trx))
                .firstOrFail()) as FacturaFila
        }
        // DTE que aún no se enviaron: se descartan sin enviar
        for (const dte of dtes.filter((d) =>
            ['pendiente', 'error_temporal', 'contingencia'].includes(d.estado),
        )) {
            await bloquearDte(t, dte.id)
            await t.trx
                .from('fiscal.dte')
                .where('id', dte.id)
                .update({
                    estado: 'rechazado',
                    ultimo_error: ERROR_DOCUMENTO_ANULADO,
                    definitivo: true,
                    proximo_intento: null,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.emit('dte.rechazado', {
                dte_id: dte.id,
                empresa_id: dte.empresa_id,
                documento_tipo: dte.documento_tipo,
                documento_id: dte.documento_id,
                error: `${ERROR_DOCUMENTO_ANULADO}: la factura se anuló antes de certificarse`,
                definitivo: true,
            })
        }
        const reclasificaciones = (await t.trx
            .from('ledger.asientos as a')
            .where('a.origen_tipo', 'reclasificacion')
            .whereIn(
                'a.origen_id',
                dtes.map((d) => d.id),
            )
            .whereNull('a.reversa_de')
            .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
            .orderBy('a.id', 'asc')
            .select('a.id')) as Array<{ id: number }>
        for (const asiento of reclasificaciones) {
            await new RevertirAsiento().execute(
                {
                    asiento_id: asiento.id,
                    motivo: `anulación del DTE de la factura ${factura.id}: ${motivo}`,
                    por_anulacion: true,
                },
                t.ctx,
                { trx: t.trx },
            )
        }
        for (const f of anular) await exigirAnulableImportada(t, f.id, Number(f.empresa_id))
        for (const f of anular) {
            const asientos = (await t.trx
                .from('ledger.asientos as a')
                .where('a.origen_tipo', f.tipo === 'mora' ? 'mora' : 'factura')
                .where('a.origen_id', f.id)
                .whereNull('a.reversa_de')
                .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
                .orderBy('a.id', 'asc')
                .select('a.id')) as Array<{ id: number }>
            for (const asiento of asientos) {
                await new RevertirAsiento().execute(
                    {
                        asiento_id: asiento.id,
                        motivo: `anulación de la factura ${f.id}: ${motivo}`,
                        por_anulacion: true,
                    },
                    t.ctx,
                    { trx: t.trx },
                )
            }
            await t.trx
                .from('billing.facturas')
                .where('id', f.id)
                .update({
                    estado: 'anulada',
                    anulada_en: t.trx.knexRawQuery('now()'),
                    anulada_por: usuarioDelActor(t.ctx.actor),
                    motivo_anulacion:
                        f.id === factura.id ? motivo : `anulación de la factura ${factura.id}: ${motivo}`,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.registrarCambios(
                { tipo: 'factura', id: f.id },
                { estado: f.estado },
                { estado: 'anulada' },
            )
            if (f.estado === 'por_certificar') continue
            await t.emit('factura.anulada', {
                factura_id: f.id,
                empresa_id: Number(f.empresa_id),
                servicio_id: f.servicio_id,
                cliente_id: f.cliente_id,
                total: f.total,
                vence: f.vence_en,
            })
        }
        t.fijarEntidad('factura', factura.id)

        // el saldo a favor que volvió a Anticipos se aplica a la otra deuda del cliente
        if (revertidas.size > 0) await aplicarAnticipos(t, factura.cliente_id, Number(factura.empresa_id))
        if (factura.servicio_id) {
            await new EvaluarEstadoServicio().execute({ servicio_id: factura.servicio_id }, t.ctx, {
                trx: t.trx,
            })
        }
        const fila = (await t.trx
            .from('billing.facturas as f')
            .where('f.id', factura.id)
            .select(...columnasFactura(t.trx))
            .firstOrFail()) as FacturaFila
        return fila
    }
}
