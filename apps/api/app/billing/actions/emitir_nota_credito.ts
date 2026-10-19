import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { CERO, D as Decimal, aTexto, dec, redondear, tieneCentavosExactos, type Dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { hoyGuatemala } from '#ledger/fechas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { aplicarAnticipos, bloquearCliente, sumarAPagado, type FacturaPendiente } from '#billing/cobros'
import { ESTADOS_PENDIENTES, pendienteDe, verFactura, type EstadoFactura } from '#billing/facturas'
import { repartirProporcional, verNotaCredito, type NotaCreditoFila } from '#billing/notas_credito'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import { IVA_POR_CERTIFICAR } from '#billing/fel_facturas'
import { valorParametro } from '#fiscal/parametros'
import { configuracionFel } from '#fiscal/fel/configuracion'
import { dentroDeVentana, dteVigente, insertarDte, referenciaA } from '#fiscal/fel/dte'
import { DteEnProceso, NotaFueraDePlazo } from '#fiscal/fel/errores'

async function idCuenta(t: Transaccion, codigo: string): Promise<number> {
    const fila = (await t.trx
        .from('ledger.cuentas')
        .where('codigo', codigo)
        .where('pais', 'GT')
        .select('id')
        .firstOrFail()) as { id: number }
    return Number(fila.id)
}
import type { ResultadoEvaluarEstado } from '#billing/actions/evaluar_estado_servicio'

/**
 * `facturas.nota_credito` (`POST /facturas/:id/notas-credito { monto, motivo }`): nota de crédito
 * interna (sin FEL; semana 5) por una parte o todo el saldo de una factura viva.
 *
 * - 404 si la factura no existe; 409 `factura_anulada` o `factura_sin_saldo` (pagada).
 * - `monto` > 0, a centavos y nunca mayor al saldo de la factura (422 `monto`).
 * - Asiento `nota_credito`: Debe lo que a la factura le queda acreditado (Ingresos, IVA, Otros
 *   ingresos, Recargos…, menos las notas anteriores) en proporción `monto / restante`; la nota
 *   que agota lo acreditable toma el resto exacto de cada cuenta. Haber CxC del cliente. La nota
 *   guarda su IVA.
 * - Suma `monto` a `pagado` de la factura (puede quedar `pagada`), emite `nota_credito.emitida` y
 *   re-evalúa el servicio: si ya no le quedan vencidas se reactiva en la misma transacción.
 *   Las promesas activas del cliente se revisan al consumir el evento (grupo `billing`).
 * - FEL (contrato de localización fiscal §8.3, §10.1 y §10.9): sobre una factura con DTE
 *   certificado la nota es una **NCRE** referida a ella, solo dentro de `nota_ventana_meses` (422
 *   `nota_fuera_de_plazo`), con el IVA en `2.1.02` y su DTE en cola. Sobre un aviso sin DTE es una
 *   nota **interna** que debita `2.1.11`. Con el DTE de la factura aún en proceso: 409
 *   `dte_en_proceso`. El asiento de la nota es inmediato también en `obligatoria` (desvío anotado en
 *   §16 del contrato): la NCRE se certifica después, como la contingencia.
 * - `lineas[] { linea_id, monto }`: nota por línea, con el IVA de cada línea (la que agota una línea
 *   toma su IVA restante exacto). No se combina después de notas proporcionales (409
 *   `nota_por_linea_no_disponible`).
 */

export interface EntradaNotaCredito {
    factura_id: number
    /** con `lineas`, opcional: es la suma de las líneas */
    monto?: string | null
    motivo: string
    /** nota por línea (contrato §10.9): acredita conceptos concretos con su IVA */
    lineas?: Array<{ linea_id: number; monto: string }> | null
    /**
     * Decisión del PM (lealtad §15.2): la nota puede pasar el saldo de la factura (también una pagada)
     * hasta lo que le queda acreditable; el excedente queda como crédito del cliente en Anticipos
     * (`a_favor`) y se aplica a sus facturas por `aplicarAnticipos`. La usa el canje de lealtad.
     */
    excedente_a_anticipos?: boolean
}

export type ServicioEvaluadoNota = Pick<
    ResultadoEvaluarEstado,
    'servicio_id' | 'estado' | 'de' | 'cambiado' | 'motivo'
>

export interface ResultadoNotaCredito extends NotaCreditoFila {
    factura: Awaited<ReturnType<typeof verFactura>>
    servicios: ServicioEvaluadoNota[]
}

interface FacturaNota extends FacturaPendiente {
    tipo: 'servicio' | 'mora'
    aviso_cobro: boolean
    estado: EstadoFactura
    vence_en: string
}

export default class EmitirNotaCredito extends DomainAction<EntradaNotaCredito, ResultadoNotaCredito> {
    readonly nombre = 'facturas.nota_credito'

    protected async handle(input: EntradaNotaCredito, t: Transaccion): Promise<ResultadoNotaCredito> {
        t.fijarEntidad('factura', input.factura_id)
        const motivo = input.motivo?.trim() ?? ''
        const porLinea = (input.lineas ?? []).length > 0
        const montoPedido = porLinea
            ? (input.lineas ?? []).reduce((suma, l) => suma.plus(this.validarMonto(l.monto, motivo)), CERO)
            : this.validarMonto(input.monto ?? '', motivo)
        if (porLinea && input.monto && !dec(input.monto).equals(montoPedido)) {
            throw new ValidacionFallida([
                { field: 'monto', message: 'El monto debe ser la suma de las líneas', rule: 'suma_lineas' },
            ])
        }
        const monto = montoPedido

        const previa = await t.trx
            .from('billing.facturas')
            .where('id', input.factura_id)
            .select('cliente_id')
            .first()
        if (!previa) throw new NoEncontrado(`La factura ${input.factura_id} no existe`)
        await bloquearCliente(t.trx, previa.cliente_id)

        const factura = (await t.trx
            .from('billing.facturas')
            .where('id', input.factura_id)
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
                'aviso_cobro',
                t.trx.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
            )
            .firstOrFail()) as FacturaNota
        const empresaId = Number(factura.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (factura.estado === 'anulada') {
            throw new Conflicto(`La factura ${factura.id} está anulada`, 'factura_anulada', 'Factura anulada')
        }
        const conExcedente = input.excedente_a_anticipos === true
        const saldo = ESTADOS_PENDIENTES.includes(factura.estado) ? pendienteDe(factura) : CERO
        if (!conExcedente && (!ESTADOS_PENDIENTES.includes(factura.estado) || saldo.lte(0))) {
            throw new Conflicto(
                `La factura ${factura.id} no tiene saldo pendiente`,
                'factura_sin_saldo',
                'Factura sin saldo',
            )
        }
        if (conExcedente) {
            // tope: lo que a la factura le queda por acreditar (su total menos sus notas vivas)
            const notas = (await t.trx
                .from('billing.notas_credito as n')
                .where('n.factura_id', factura.id)
                .whereNotExists((q) =>
                    q.from('billing.notas_credito_anulaciones as x').whereRaw('x.nota_id = n.id'),
                )
                .select(t.trx.raw('coalesce(sum(n.monto), 0)::text as monto'))
                .first()) as { monto: string }
            const acreditable = dec(factura.total).minus(notas.monto)
            if (monto.gt(acreditable)) {
                throw new ValidacionFallida([
                    {
                        field: 'monto',
                        message: `El monto (Q${aTexto(monto)}) excede lo acreditable de la factura (Q${aTexto(acreditable)})`,
                        rule: 'saldo_factura',
                    },
                ])
            }
        } else if (monto.gt(saldo)) {
            throw new ValidacionFallida([
                {
                    field: 'monto',
                    message: `El monto (Q${aTexto(monto)}) excede el saldo de la factura (Q${aTexto(saldo)})`,
                    rule: 'saldo_factura',
                },
            ])
        }

        // FEL: ¿la factura ya tiene su DTE certificado? (NCRE) ¿o es un aviso sin DTE? (nota interna)
        const dteFactura = await dteVigente(
            t.trx,
            factura.tipo === 'mora' ? 'nota_debito' : 'factura',
            factura.id,
        )
        if (dteFactura && dteFactura.estado !== 'certificado') {
            throw new DteEnProceso(dteFactura.id, dteFactura.estado)
        }
        const fecha = hoyGuatemala()
        if (dteFactura) {
            const meses = await valorParametro<number>(empresaId, 'nota_ventana_meses', fecha, t.trx)
            if (
                !dentroDeVentana(dteFactura.certificado_en ?? dteFactura.fecha_emision, fecha, Number(meses))
            ) {
                throw new NotaFueraDePlazo(Number(meses))
            }
        }
        const certificada = Boolean(dteFactura)

        let debitos: Array<{ cuenta_id: number | string; cuenta_codigo: string; debe: Dec }>
        let lineasNota: Array<{ linea_id: number; monto: Dec; iva: Dec }> = []
        if (porLinea) {
            const r = await this.debitosPorLinea(t, factura, input.lineas ?? [], certificada)
            debitos = r.debitos
            lineasNota = r.lineas
        } else {
            debitos = repartirProporcional(await this.lineasAcreditadas(t, factura, certificada), monto)
        }
        const iva = debitos
            .filter((d) => d.cuenta_codigo === CUENTAS.IVA_DEBITO || d.cuenta_codigo === IVA_POR_CERTIFICAR)
            .reduce((suma, d) => suma.plus(d.debe), CERO)

        const aplicado = monto.gt(saldo) ? saldo : monto
        const aFavor = monto.minus(aplicado)
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.notas_credito')
            .insert({
                empresa_id: empresaId,
                factura_id: factura.id,
                cliente_id: factura.cliente_id,
                servicio_id: factura.servicio_id,
                fecha,
                subtotal: aTexto(monto.minus(iva)),
                iva: aTexto(iva),
                monto: aTexto(monto),
                a_favor: aTexto(aFavor),
                motivo,
                created_by: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const notaId = fila!.id
        if (lineasNota.length > 0) {
            await t.trx
                .insertQuery()
                .table('billing.notas_credito_lineas')
                .multiInsert(
                    lineasNota.map((l) => ({
                        nota_id: notaId,
                        linea_id: l.linea_id,
                        monto: aTexto(l.monto),
                        iva: aTexto(l.iva),
                    })),
                )
        }

        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha,
                descripcion: `Nota de crédito ${notaId} · factura ${factura.id}: ${motivo}`,
                origen_tipo: 'nota_credito',
                origen_id: notaId,
                movimientos: [
                    ...debitos.map((d) => ({ cuenta: d.cuenta_id, debe: aTexto(d.debe) })),
                    ...(aplicado.gt(0)
                        ? [
                              {
                                  cuenta: CUENTAS.CXC_CLIENTES,
                                  haber: aTexto(aplicado),
                                  cliente_id: factura.cliente_id,
                              },
                          ]
                        : []),
                    ...(aFavor.gt(0)
                        ? [
                              {
                                  cuenta: CUENTAS.ANTICIPOS_CLIENTES,
                                  haber: aTexto(aFavor),
                                  cliente_id: factura.cliente_id,
                              },
                          ]
                        : []),
                ],
            },
            t.ctx,
            { trx: t.trx },
        )

        if (dteFactura) {
            const config = await configuracionFel(empresaId, t.trx)
            if (config.modo === 'desactivada') {
                // después de un DTE solo hay NCRE: una nota interna sobre un documento certificado no existe
                throw new Conflicto(
                    `La factura ${factura.id} está certificada y la FEL de la empresa está desactivada: la nota debe ser una NCRE; activa la FEL para emitirla`,
                    'nota_requiere_ncre',
                    'Nota requiere NCRE',
                )
            }
            {
                await insertarDte(t.trx, {
                    empresa_id: empresaId,
                    documento_tipo: 'nota_credito',
                    documento_id: notaId,
                    tipo_dte: 'NCRE',
                    proveedor: config.proveedor ?? dteFactura.proveedor,
                    ambiente: config.ambiente,
                    receptor: dteFactura.receptor,
                    referencia: referenciaA(dteFactura, motivo),
                    total: aTexto(monto),
                    iva: aTexto(iva),
                    estado: config.contingencia_activa ? 'contingencia' : 'pendiente',
                    contingencia: config.contingencia_activa,
                })
            }
        }

        const antes = { estado: factura.estado, pagado: factura.pagado }
        if (aplicado.gt(0)) {
            const estado = await sumarAPagado(t.trx, factura, aplicado)
            await t.registrarCambios({ tipo: 'factura', id: factura.id }, antes, {
                estado,
                pagado: factura.pagado,
            })
        }
        // el saldo a favor paga ya otras facturas pendientes del cliente en la empresa (como un anticipo)
        if (aFavor.gt(0)) await aplicarAnticipos(t, factura.cliente_id, empresaId)
        await t.emit('nota_credito.emitida', {
            nota_credito_id: notaId,
            empresa_id: empresaId,
            factura_id: factura.id,
            servicio_id: factura.servicio_id,
            cliente_id: factura.cliente_id,
            monto: aTexto(monto),
            motivo,
        })

        const servicios: ServicioEvaluadoNota[] = []
        if (factura.servicio_id) {
            const r = await new EvaluarEstadoServicio().execute({ servicio_id: factura.servicio_id }, t.ctx, {
                trx: t.trx,
            })
            servicios.push({
                servicio_id: r.servicio_id,
                estado: r.estado,
                de: r.de,
                cambiado: r.cambiado,
                motivo: r.motivo,
            })
        }

        return {
            ...(await verNotaCredito(notaId, t.trx)),
            factura: await verFactura(factura.id, t.trx),
            servicios,
        }
    }

    private validarMonto(valor: string, motivo: string): Dec {
        const errores = []
        let monto: Dec | null = null
        try {
            monto = dec(valor)
        } catch {
            errores.push({ field: 'monto', message: 'Monto inválido', rule: 'dinero' })
        }
        if (monto && (monto.lte(0) || !tieneCentavosExactos(monto))) {
            errores.push({
                field: 'monto',
                message: 'El monto debe ser mayor a 0 con hasta 2 decimales',
                rule: 'dinero',
            })
        }
        if (motivo.length < 3) {
            errores.push({
                field: 'motivo',
                message: 'El motivo es obligatorio (mínimo 3 caracteres)',
                rule: 'motivo',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        return monto!
    }

    /**
     * Nota por línea: cada línea acredita hasta lo que le queda (su total menos sus notas por línea
     * anteriores) con su IVA (`monto − monto / 1.12`; la que agota la línea toma el IVA restante
     * exacto). Debe la cuenta de ingreso de la línea y la de IVA que corresponde.
     */
    private async debitosPorLinea(
        t: Transaccion,
        factura: FacturaNota,
        pedidas: Array<{ linea_id: number; monto: string }>,
        certificada: boolean,
    ) {
        const proporcionales = await t.trx
            .from('billing.notas_credito as n')
            .where('n.factura_id', factura.id)
            .whereNotExists((q) => q.from('billing.notas_credito_lineas as l').whereRaw('l.nota_id = n.id'))
            .whereNotExists((q) =>
                q.from('billing.notas_credito_anulaciones as x').whereRaw('x.nota_id = n.id'),
            )
            .first()
        if (proporcionales) {
            throw new Conflicto(
                `La factura ${factura.id} ya tiene notas por monto: la siguiente también va por monto`,
                'nota_por_linea_no_disponible',
                'Nota por línea no disponible',
            )
        }
        const lineas = (await t.trx
            .from('billing.facturas_lineas as l')
            .where('l.factura_id', factura.id)
            .select(
                'l.id',
                'l.tipo',
                'l.gravable',
                'l.total',
                'l.iva',
                'l.descuento',
                t.trx.raw(
                    '(select coalesce(sum(d.iva), 0) from billing.facturas_lineas d where d.linea_id = l.id)::text as iva_descuento',
                ),
                t.trx.raw(
                    '(select coalesce(sum(nl.monto), 0) from billing.notas_credito_lineas nl where nl.linea_id = l.id and not exists (select 1 from billing.notas_credito_anulaciones x where x.nota_id = nl.nota_id))::text as acreditado',
                ),
                t.trx.raw(
                    '(select coalesce(sum(nl.iva), 0) from billing.notas_credito_lineas nl where nl.linea_id = l.id and not exists (select 1 from billing.notas_credito_anulaciones x where x.nota_id = nl.nota_id))::text as iva_acreditado',
                ),
            )) as Array<{
            id: number
            tipo: string
            gravable: boolean
            total: string
            iva: string
            descuento: string
            iva_descuento: string
            acreditado: string
            iva_acreditado: string
        }>
        const porId = new Map(lineas.map((l) => [Number(l.id), l]))
        const errores: Array<{ field: string; message: string; rule: string }> = []
        const resultado: Array<{ linea_id: number; monto: Dec; iva: Dec }> = []
        const porCuenta = new Map<string, Dec>()
        const sumar = (cuenta: string, monto: Dec) =>
            porCuenta.set(cuenta, (porCuenta.get(cuenta) ?? CERO).plus(monto))
        const cuentaIva = certificada || !factura.aviso_cobro ? CUENTAS.IVA_DEBITO : IVA_POR_CERTIFICAR
        pedidas.forEach((p, i) => {
            const linea = porId.get(Number(p.linea_id))
            if (linea?.tipo === 'descuento') {
                errores.push({
                    field: `lineas.${i}.linea_id`,
                    message: 'Una línea de descuento no se acredita: acredita la línea que descuenta',
                    rule: 'linea',
                })
                return
            }
            if (!linea) {
                errores.push({
                    field: `lineas.${i}.linea_id`,
                    message: 'La línea no es de esta factura',
                    rule: 'linea',
                })
                return
            }
            const monto = dec(p.monto)
            // la línea vale su neto: total menos sus descuentos (y su IVA, el del neto)
            const restante = dec(linea.total).minus(linea.descuento).minus(linea.acreditado)
            if (monto.gt(restante)) {
                errores.push({
                    field: `lineas.${i}.monto`,
                    message: `La línea solo admite Q${aTexto(restante)}`,
                    rule: 'saldo_linea',
                })
                return
            }
            const ivaRestante = dec(linea.iva).plus(linea.iva_descuento).minus(linea.iva_acreditado)
            const iva = !linea.gravable
                ? CERO
                : monto.equals(restante)
                  ? ivaRestante
                  : Decimal.min(redondear(monto.minus(monto.div('1.12'))), ivaRestante)
            resultado.push({ linea_id: Number(linea.id), monto, iva })
            const ingreso =
                linea.tipo === 'servicio'
                    ? CUENTAS.INGRESOS_INTERNET
                    : linea.tipo === 'mora'
                      ? CUENTAS.RECARGOS_MORA
                      : CUENTAS.OTROS_INGRESOS
            sumar(ingreso, monto.minus(iva))
            if (iva.gt(0)) sumar(cuentaIva, iva)
        })
        if (errores.length > 0) throw new ValidacionFallida(errores)
        const debitos = [...porCuenta.entries()]
            .filter(([, debe]) => debe.gt(0))
            .map(([codigo, debe]) => ({ cuenta_id: codigo, cuenta_codigo: codigo, debe }))
        return { debitos, lineas: resultado }
    }

    /**
     * Lo que el asiento vigente de la factura acreditó (todo menos la CxC), menos lo que ya
     * debitaron sus notas anteriores: el restante acreditable de cada cuenta.
     */
    private async lineasAcreditadas(t: Transaccion, factura: FacturaNota, certificada: boolean) {
        const lineas = (await t.trx
            .from('ledger.asientos as a')
            .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where('a.origen_tipo', factura.tipo === 'mora' ? 'mora' : 'factura')
            .where('a.origen_id', factura.id)
            .whereNull('a.reversa_de')
            .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
            .where('m.haber', '>', 0)
            .whereNot('c.codigo', CUENTAS.CXC_CLIENTES)
            .groupBy('m.cuenta_id', 'c.codigo')
            .orderByRaw('min(m.id)')
            .select(
                'm.cuenta_id',
                'c.codigo as cuenta_codigo',
                t.trx.raw('sum(m.haber)::text as haber'),
            )) as Array<{
            cuenta_id: number
            cuenta_codigo: string
            haber: string
        }>
        // lo que las notas anteriores (vigentes) ya debitaron de cada cuenta de la factura
        const previas = (await t.trx
            .from('ledger.asientos as a')
            .join('billing.notas_credito as n', 'n.id', 'a.origen_id')
            .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
            .where('a.origen_tipo', 'nota_credito')
            .where('n.factura_id', factura.id)
            .whereNull('a.reversa_de')
            .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
            .where('m.debe', '>', 0)
            .groupBy('m.cuenta_id')
            .select('m.cuenta_id', t.trx.raw('sum(m.debe)::text as debe'))) as Array<{
            cuenta_id: number
            debe: string
        }>
        const yaDebitado = new Map(previas.map((p) => [Number(p.cuenta_id), dec(p.debe)]))
        // descuentos de la factura (5.1.01 al debe): lo acreditable del servicio es el neto
        const descuentos = (await t.trx
            .from('ledger.asientos as a')
            .join('ledger.movimientos as m', 'm.asiento_id', 'a.id')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where('a.origen_tipo', factura.tipo === 'mora' ? 'mora' : 'factura')
            .where('a.origen_id', factura.id)
            .whereNull('a.reversa_de')
            .whereNotExists((q) => q.from('ledger.asientos as r').whereRaw('r.reversa_de = a.id'))
            .where('c.codigo', CUENTAS.DESCUENTOS)
            .select(t.trx.raw('coalesce(sum(m.debe), 0)::text as debe'))
            .first()) as { debe: string }
        const servicio = lineas.find((l) => l.cuenta_codigo === CUENTAS.INGRESOS_INTERNET)
        if (servicio && dec(descuentos.debe).gt(0)) {
            servicio.haber = aTexto(dec(servicio.haber).minus(descuentos.debe))
        }
        if (certificada) {
            // aviso certificado: su IVA ya se reclasificó a 2.1.02; lo que las notas internas
            // debitaron de 2.1.11 antes de certificar también cuenta como IVA ya acreditado
            const transicion = lineas.find((l) => l.cuenta_codigo === IVA_POR_CERTIFICAR)
            if (transicion) {
                const idDebito = await idCuenta(t, CUENTAS.IVA_DEBITO)
                const idTransicion = Number(transicion.cuenta_id)
                transicion.cuenta_id = idDebito
                transicion.cuenta_codigo = CUENTAS.IVA_DEBITO
                yaDebitado.set(
                    idDebito,
                    (yaDebitado.get(idDebito) ?? CERO).plus(yaDebitado.get(idTransicion) ?? CERO),
                )
            }
        }
        const restantes = lineas.map((l) => {
            const resto = dec(l.haber).minus(yaDebitado.get(Number(l.cuenta_id)) ?? CERO)
            return { ...l, haber: aTexto(resto.gt(0) ? resto : CERO) }
        })
        if (lineas.length === 0) {
            throw new Conflicto(
                `La factura ${factura.id} no tiene asiento vigente en el libro`,
                'factura_sin_asiento',
                'Factura sin asiento',
            )
        }
        return restantes
    }
}
