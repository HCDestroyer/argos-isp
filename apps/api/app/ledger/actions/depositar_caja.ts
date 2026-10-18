import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { egresosDelTurno } from '#ledger/egresos'
import { resolverCuentaBanco, type PedidoCuentaBanco } from '#ledger/cuentas_banco'
import { depositosDelTurno, verDeposito, type DepositoVista } from '#ledger/transitos'
import { pagosProveedoresDelTurno } from '#ledger/pagos_proveedores'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * `cajas.depositar` (`POST /cajas/:id/depositar`): el cajero lleva al banco efectivo del turno
 * abierto de su caja, con la boleta (contrato de localización fiscal §10.3).
 *
 * - Asiento `deposito`: `1.1.11 Fondos en tránsito / Caja`. El dinero llega al banco cuando la
 *   línea del extracto se concilia con el depósito (`Banco / 1.1.11`, `bancos.conciliar`).
 * - Baja el esperado del turno igual que un egreso (`cerrarCaja`). No puede superar el efectivo
 *   del turno (fondo + cobros − egresos − depósitos): 422 `deposito_excede_efectivo`.
 * - La cuenta es de la empresa de la caja (422 `cuenta_de_otra_empresa`); boleta única por
 *   cuenta (409 `deposito_duplicado`). Evento `caja.depositada`.
 */

export interface EntradaDepositarCaja extends PedidoCuentaBanco {
    caja_id: number
    monto: string
    boleta: string
    fecha?: string | null
}

export default class DepositarCaja extends DomainAction<EntradaDepositarCaja, DepositoVista> {
    readonly nombre = 'cajas.depositar'

    protected async handle(input: EntradaDepositarCaja, t: Transaccion): Promise<DepositoVista> {
        t.fijarEntidad('caja', input.caja_id)
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
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const caja = (await t.trx
            .from('ledger.cajas')
            .where('id', input.caja_id)
            .select('id', 'empresa_id', 'nombre', 'cuenta_id', 'activa')
            .first()) as {
            id: number
            empresa_id: number
            nombre: string
            cuenta_id: number
            activa: boolean
        } | null
        if (!caja) throw new NoEncontrado(`La caja ${input.caja_id} no existe`)
        const empresaId = Number(caja.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        // como cobros y egresos: si el turno se está cerrando, el depósito espera y luego no entra
        const turno = (await t.trx
            .from('ledger.cajas_turnos')
            .where('caja_id', caja.id)
            .whereNull('cerrado_en')
            .forUpdate()
            .select('id', 'fondo_inicial')
            .first()) as { id: number; fondo_inicial: string } | null
        if (!turno) {
            throw new Conflicto(
                `La caja ${caja.id} no tiene turno abierto: el depósito sale del efectivo de un turno`,
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
                caja_id: caja.id,
                turno_id: turno.id,
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
                descripcion: `Depósito ${depositoId} de ${caja.nombre} (turno ${turno.id}) a ${banco.nombre} · boleta ${boleta}`,
                origen_tipo: 'deposito',
                origen_id: depositoId,
                movimientos: [
                    { cuenta: CUENTAS_GT.FONDOS_EN_TRANSITO, debe: aTexto(monto) },
                    { cuenta: Number(caja.cuenta_id), haber: aTexto(monto) },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
        await t.emit('caja.depositada', {
            deposito_id: depositoId,
            empresa_id: empresaId,
            caja_id: caja.id,
            cuenta_bancaria_id: banco.cuenta_bancaria_id,
            cuenta_id: banco.cuenta_id,
            monto: aTexto(monto),
        })
        return verDeposito(depositoId, t.trx)
    }
}
