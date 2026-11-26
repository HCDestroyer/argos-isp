import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { CERO, aTexto, dec, tieneCentavosExactos, type Dec } from '#ledger/dinero'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { bloquearCustodia, saldoCustodia } from '#ledger/custodia'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { egresosDelTurno } from '#ledger/egresos'
import { resolverCuentaBanco, type PedidoCuentaBanco } from '#ledger/cuentas_banco'
import { depositosDelTurno, verDeposito, type DepositoVista } from '#ledger/transitos'
import { pagosProveedoresDelTurno } from '#ledger/pagos_proveedores'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * `cajas.depositar` (`POST /custodia/depositar` y `POST /cajas/:id/depositar`): lleva efectivo al
 * banco con la boleta (contrato de localización fiscal §10.3).
 *
 * B1 del plan de contabilidad (§5.7, corrige E1): el depósito sale de la **custodia** de quien
 * deposita (lo que recibió con «Recibí» y aún no depositó), sin turno abierto:
 * asiento `1.1.11 Fondos en tránsito / 1.1.15 Efectivo en custodia`, `origen = custodia`. No puede
 * superar su custodia en la empresa: 422 `deposito_excede_custodia`.
 *
 * Desde un turno abierto (`desde = turno`, solo con `caja_id`): como antes de B1, asiento
 * `1.1.11 / Caja`, baja el esperado del turno y no puede superar su efectivo (422
 * `deposito_excede_efectivo`; 409 `sin_turno_abierto`). Sin `desde`: la custodia si alcanza; si no y
 * hay `caja_id`, el turno abierto de esa caja.
 *
 * El dinero llega al banco cuando la línea del extracto se concilia con el depósito (`Banco /
 * 1.1.11`, `bancos.conciliar`). La cuenta es de la empresa (422 `cuenta_de_otra_empresa`); boleta
 * única por cuenta (409 `deposito_duplicado`). Evento `caja.depositada`.
 */

export interface EntradaDepositarCaja extends PedidoCuentaBanco {
    caja_id?: number | null
    empresa_id?: number | null
    desde?: 'custodia' | 'turno' | null
    monto: string
    boleta: string
    fecha?: string | null
}

interface CajaDeposito {
    id: number
    empresa_id: number
    nombre: string
    cuenta_id: number
    activa: boolean
}

export default class DepositarCaja extends DomainAction<EntradaDepositarCaja, DepositoVista> {
    readonly nombre = 'cajas.depositar'

    protected async handle(input: EntradaDepositarCaja, t: Transaccion): Promise<DepositoVista> {
        if (input.caja_id) t.fijarEntidad('caja', input.caja_id)
        const errores: ErrorCampo[] = []
        const monto = dec(input.monto)
        if (monto.lte(0) || !tieneCentavosExactos(monto)) {
            errores.push({
                field: 'monto',
                message: 'El monto debe ser mayor que 0 con hasta 2 decimales',
                rule: 'monto',
            })
        }
        const boleta = input.boleta?.trim() ?? ''
        if (!boleta) errores.push({ field: 'boleta', message: 'La boleta es obligatoria', rule: 'required' })
        const hoy = hoyGuatemala()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy
        if (fecha > hoy) {
            errores.push({ field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' })
        }
        if (input.desde === 'turno' && !input.caja_id) {
            errores.push({ field: 'caja_id', message: 'Desde un turno se indica la caja', rule: 'required' })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        let caja: CajaDeposito | null = null
        let empresaId: number
        if (input.caja_id) {
            caja = (await t.trx
                .from('ledger.cajas')
                .where('id', input.caja_id)
                .select('id', 'empresa_id', 'nombre', 'cuenta_id', 'activa')
                .first()) as CajaDeposito | null
            if (!caja) throw new NoEncontrado(`La caja ${input.caja_id} no existe`)
            empresaId = Number(caja.empresa_id)
            if (input.empresa_id && input.empresa_id !== empresaId) {
                throw new ValidacionFallida([
                    { field: 'empresa_id', message: 'La caja es de otra empresa', rule: 'empresa' },
                ])
            }
        } else if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const usuario = usuarioDelActor(t.ctx.actor)
        let custodia: Dec = CERO
        if (usuario !== null) {
            await bloquearCustodia(t.trx, empresaId, usuario)
            custodia = await saldoCustodia(t.trx, empresaId, usuario)
        }
        const desde = input.desde ?? (custodia.gte(monto) || !caja ? 'custodia' : 'turno')
        if (desde === 'custodia') {
            if (usuario === null || monto.gt(custodia)) {
                throw new Problema(
                    422,
                    'deposito_excede_custodia',
                    'Depósito mayor que tu custodia',
                    `Tienes Q${aTexto(custodia)} en custodia en esta empresa; no se pueden depositar Q${aTexto(monto)}`,
                    [
                        {
                            field: 'monto',
                            message: `En custodia: Q${aTexto(custodia)}`,
                            rule: 'deposito_excede_custodia',
                        },
                    ],
                )
            }
            return this.depositar(t, { empresaId, caja, turnoId: null, usuario, monto, boleta, fecha, input })
        }

        // como cobros y egresos: si el turno se está cerrando, el depósito espera y luego no entra
        const turno = (await t.trx
            .from('ledger.cajas_turnos')
            .where('caja_id', caja!.id)
            .whereNull('cerrado_en')
            .forUpdate()
            .select('id', 'fondo_inicial')
            .first()) as { id: number; fondo_inicial: string } | null
        if (!turno) {
            throw new Conflicto(
                `La caja ${caja!.id} no tiene turno abierto y no tienes efectivo suficiente en custodia (Q${aTexto(custodia)})`,
                'sin_turno_abierto',
                'Sin turno abierto',
            )
        }
        const cobrado = (await t.trx
            .from('billing.pagos')
            .where('turno_id', turno.id)
            .whereNot('estado', 'anulado')
            .select(t.trx.raw('coalesce(sum(monto - retenido), 0)::text as total'))
            .first()) as { total: string }
        const efectivo = dec(turno.fondo_inicial)
            .plus(cobrado.total)
            .minus(await egresosDelTurno(t.trx, turno.id))
            .minus(await depositosDelTurno(t.trx, turno.id))
            .minus(await pagosProveedoresDelTurno(t.trx, turno.id))
        if (monto.gt(efectivo)) {
            throw new Problema(
                422,
                'deposito_excede_efectivo',
                'Depósito mayor que el efectivo',
                `El turno ${turno.id} tiene Q${aTexto(efectivo)} en efectivo; no se pueden depositar Q${aTexto(monto)}`,
                [
                    {
                        field: 'monto',
                        message: `Efectivo del turno: Q${aTexto(efectivo)}`,
                        rule: 'deposito_excede_efectivo',
                    },
                ],
            )
        }
        return this.depositar(t, {
            empresaId,
            caja,
            turnoId: Number(turno.id),
            usuario,
            monto,
            boleta,
            fecha,
            input,
        })
    }

    private async depositar(
        t: Transaccion,
        d: {
            empresaId: number
            caja: CajaDeposito | null
            turnoId: number | null
            usuario: number | null
            monto: Dec
            boleta: string
            fecha: string
            input: EntradaDepositarCaja
        },
    ): Promise<DepositoVista> {
        const { empresaId, caja, turnoId, monto, boleta, fecha, input } = d
        const custodia = turnoId === null
        const banco = (await resolverCuentaBanco(t.trx, input, { empresaId }))!
        const repetido = await t.trx
            .from('ledger.depositos')
            .where({ empresa_id: empresaId, cuenta_id: banco.cuenta_id, boleta })
            .select('id')
            .first()
        if (repetido) {
            throw new Conflicto(
                `La boleta ${boleta} ya está registrada en ${banco.codigo} (depósito ${repetido.id})`,
                'deposito_duplicado',
                'Depósito duplicado',
            )
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.depositos')
            .insert({
                empresa_id: empresaId,
                // desde la custodia el efectivo ya no es de una caja
                caja_id: custodia ? null : caja!.id,
                turno_id: turnoId,
                origen: custodia ? 'custodia' : 'turno',
                custodio_id: custodia ? d.usuario : null,
                cuenta_id: banco.cuenta_id,
                cuenta_bancaria_id: banco.cuenta_bancaria_id,
                banco_id: banco.banco_id,
                monto: aTexto(monto),
                boleta,
                fecha,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const depositoId = Number(fila!.id)
        t.fijarEntidad('deposito', depositoId)

        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha,
                descripcion: custodia
                    ? `Depósito ${depositoId} desde la custodia de ${await nombreUsuario(t, d.usuario!)} a ${banco.nombre} · boleta ${boleta}`
                    : `Depósito ${depositoId} de ${caja!.nombre} (turno ${turnoId}) a ${banco.nombre} · boleta ${boleta}`,
                origen_tipo: 'deposito',
                origen_id: depositoId,
                movimientos: [
                    { cuenta: CUENTAS_GT.FONDOS_EN_TRANSITO, debe: aTexto(monto) },
                    custodia
                        ? { cuenta: CUENTAS_GT.EFECTIVO_EN_CUSTODIA, haber: aTexto(monto) }
                        : { cuenta: Number(caja!.cuenta_id), haber: aTexto(monto) },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
        await t.emit('caja.depositada', {
            deposito_id: depositoId,
            empresa_id: empresaId,
            caja_id: custodia ? null : caja!.id,
            origen: custodia ? 'custodia' : 'turno',
            custodio_id: custodia ? d.usuario : null,
            cuenta_bancaria_id: banco.cuenta_bancaria_id,
            cuenta_id: banco.cuenta_id,
            monto: aTexto(monto),
        })
        return verDeposito(depositoId, t.trx)
    }
}

async function nombreUsuario(t: Transaccion, id: number): Promise<string> {
    const fila = await t.trx.from('core.usuarios').where('id', id).select('nombre').first()
    return (fila?.nombre as string | undefined) ?? `usuario ${id}`
}
