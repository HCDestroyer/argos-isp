import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { CERO, aTexto, dec, tieneCentavosExactos, type Dec } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { resolverOrigenEgreso, type MetodoEgreso } from '#ledger/egresos'
import { verProveedor } from '#ledger/proveedores'
import { comprasPendientes, verPagoProveedor, type PagoProveedorVista } from '#ledger/pagos_proveedores'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * `compras.pagar` (`POST /pagos-proveedores`): paga compras al crédito de un proveedor (contrato
 * de localización fiscal §3.4).
 *
 * - De dónde sale el dinero: caja (con su turno abierto: baja el esperado del cierre), banco del
 *   libro o cuenta bancaria propia, como los egresos; de la empresa del proveedor (422
 *   `cuenta_de_otra_empresa`).
 * - Se aplica primero a las `compras` pedidas (en ese orden) y luego a la más antigua por
 *   vencimiento. No se paga de más: el monto no puede pasar del saldo pendiente (422
 *   `pago_excede_saldo`); un anticipo a proveedor no existe todavía (confirmar con contador).
 * - Asiento `pago_proveedor`: `2.1.03 Proveedores (auxiliar) / Caja | Banco`. Solo inserción.
 */

export interface EntradaPagoProveedor {
    proveedor_id: number
    monto: string
    metodo: MetodoEgreso
    caja_id?: number | null
    banco_id?: number | null
    cuenta_bancaria_id?: number | null
    fecha?: string | null
    referencia?: string | null
    descripcion?: string | null
    compras?: number[] | null
}

/** Advisory lock de una compra: sus pagos y su anulación no corren a la vez. */
/**
 * Lock por compra: lo toman el pago, su anulación, la anulación de la compra y su constancia emitida.
 * Espacio propio (3012 lo usa `cartera.provisionar` por empresa: compartirlo serializaba de más).
 */
export const LOCK_COMPRA = 3020

export default class RegistrarPagoProveedor extends DomainAction<EntradaPagoProveedor, PagoProveedorVista> {
    readonly nombre = 'compras.pagar'

    protected async handle(input: EntradaPagoProveedor, t: Transaccion): Promise<PagoProveedorVista> {
        const errores: ErrorCampo[] = []
        const monto = dec(input.monto)
        if (monto.lte(0) || !tieneCentavosExactos(monto)) {
            errores.push({
                field: 'monto',
                message: 'El monto debe ser mayor que 0 con hasta 2 decimales',
                rule: 'monto',
            })
        }
        const hoy = hoyGuatemala()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy
        if (fecha > hoy) {
            errores.push({ field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const proveedor = await verProveedor(input.proveedor_id, t.trx)
        const empresaId = proveedor.empresa_id
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const origen = await resolverOrigenEgreso(t.trx, t.ctx, input)
        if (origen.empresa_id !== empresaId) {
            throw new ValidacionFallida([
                {
                    field:
                        input.metodo === 'caja'
                            ? 'caja_id'
                            : input.metodo === 'banco'
                              ? 'banco_id'
                              : 'cuenta_bancaria_id',
                    message: `El pago sale de la empresa ${origen.empresa_id} y el proveedor es de la empresa ${empresaId}`,
                    rule: 'cuenta_de_otra_empresa',
                },
            ])
        }

        const pendientes = await comprasPendientes(t.trx, proveedor.id)
        const pedidas = input.compras ?? []
        for (const [i, compraId] of pedidas.entries()) {
            if (!pendientes.some((c) => c.id === compraId)) {
                throw new ValidacionFallida([
                    {
                        field: `compras.${i}`,
                        message: `La compra ${compraId} no es una compra al crédito con saldo de ${proveedor.nombre}`,
                        rule: 'compra_sin_saldo',
                    },
                ])
            }
        }
        const orden = [
            ...pedidas.map((id) => pendientes.find((c) => c.id === id)!),
            ...pendientes.filter((c) => !pedidas.includes(c.id)),
        ]
        // las compras que se tocan quedan bloqueadas: una anulación simultánea espera
        for (const compra of orden) {
            await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_COMPRA, compra.id])
        }
        const vigentes = await comprasPendientes(t.trx, proveedor.id)
        const saldoDe = new Map(vigentes.map((c) => [c.id, c.saldo]))
        const total = vigentes.reduce((s, c) => s.plus(c.saldo), CERO)
        if (monto.gt(total)) {
            throw new Problema(
                422,
                'pago_excede_saldo',
                'Pago mayor que lo pendiente',
                `${proveedor.nombre} tiene Q${aTexto(total)} pendientes; no se le pagan Q${aTexto(monto)}`,
                [{ field: 'monto', message: `Pendiente: Q${aTexto(total)}`, rule: 'pago_excede_saldo' }],
            )
        }
        const aplicaciones: Array<{ compra_id: number; monto: Dec }> = []
        let restante = monto
        for (const compra of orden) {
            if (restante.lte(0)) break
            const saldo = saldoDe.get(compra.id) ?? CERO
            if (saldo.lte(0)) continue
            const usar = saldo.lt(restante) ? saldo : restante
            aplicaciones.push({ compra_id: compra.id, monto: usar })
            restante = restante.minus(usar)
        }
        // observación del auditor: no se paga una compra antes de su fecha contable (2.1.03 negativo)
        const anteriores = aplicaciones
            .map((a) => vigentes.find((c) => c.id === a.compra_id)!)
            .filter((c) => fecha < c.fecha)
        if (anteriores.length > 0) {
            throw new Problema(
                422,
                'pago_anterior_a_compra',
                'Pago anterior a la compra',
                `El pago del ${fecha} aplicaría a ${anteriores.length === 1 ? 'una compra posterior' : 'compras posteriores'}: ${anteriores.map((c) => `${c.id} (${c.fecha})`).join(', ')}`,
                anteriores.map((c) => ({
                    field: 'fecha',
                    message: `La compra ${c.id} es del ${c.fecha}`,
                    rule: 'pago_anterior_a_compra',
                })),
            )
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.pagos_proveedores')
            .insert({
                empresa_id: empresaId,
                proveedor_id: proveedor.id,
                fecha,
                metodo: input.metodo,
                caja_id: origen.caja_id,
                turno_id: origen.turno_id,
                banco_id: origen.banco_id,
                cuenta_bancaria_id: origen.cuenta_bancaria_id,
                cuenta_id: origen.cuenta_id,
                monto: aTexto(monto),
                referencia: input.referencia?.trim() || null,
                descripcion: input.descripcion?.trim() || null,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const pagoId = Number(fila!.id)
        t.fijarEntidad('pago_proveedor', pagoId)
        await t.trx
            .insertQuery()
            .table('ledger.pagos_proveedores_aplicaciones')
            .multiInsert(
                aplicaciones.map((a) => ({
                    pago_id: pagoId,
                    compra_id: a.compra_id,
                    monto: aTexto(a.monto),
                })),
            )

        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha,
                descripcion:
                    `Pago ${pagoId} a ${proveedor.nombre} · ${origen.nombre}` +
                    (input.referencia?.trim() ? ` · ref. ${input.referencia.trim()}` : '') +
                    ` · compras ${aplicaciones.map((a) => a.compra_id).join(', ')}`,
                origen_tipo: 'pago_proveedor',
                origen_id: pagoId,
                movimientos: [
                    { cuenta: CUENTAS_GT.PROVEEDORES, debe: aTexto(monto), proveedor_id: proveedor.id },
                    { cuenta: origen.cuenta_id, haber: aTexto(monto) },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
        return verPagoProveedor(pagoId, t.trx)
    }
}
