import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { CUENTAS } from '#ledger/plan_cuentas'
import {
    nombreCuentaLibro,
    verCuentaBancaria,
    type CuentaBancariaVista,
    type EntradaCuentaBancaria,
} from '#billing/cuentas_bancarias'

/**
 * `cuentas_bancarias.crear` (`POST /cuentas-bancarias`, permiso `cuentas_bancarias.editar`):
 * registra una cuenta bancaria propia y crea su subcuenta de `1.1.02 Bancos` en el libro
 * (`1.1.02.NN`, el siguiente número libre). Los pagos por depósito, transferencia, ACH o remesa
 * a esta cuenta se debitan en esa subcuenta. 409 si el número ya existe en ese banco.
 */

/** Advisory lock para numerar subcuentas de Bancos sin carreras. */
const LOCK_SUBCUENTAS = 3005

export default class CrearCuentaBancaria extends DomainAction<EntradaCuentaBancaria, CuentaBancariaVista> {
    readonly nombre = 'cuentas_bancarias.crear'

    protected async handle(input: EntradaCuentaBancaria, t: Transaccion): Promise<CuentaBancariaVista> {
        const banco = await t.trx.from('billing.bancos').where('id', input.banco_id).select('nombre').first()
        if (!banco) {
            throw new ValidacionFallida([
                { field: 'banco_id', message: `El banco ${input.banco_id} no existe`, rule: 'exists' },
            ])
        }
        const numero = input.numero.trim()
        const repetida = await t.trx
            .from('billing.cuentas_bancarias')
            .where('banco_id', input.banco_id)
            .where('numero', numero)
            .select('id')
            .first()
        if (repetida) {
            throw new Conflicto(
                `La cuenta ${numero} de ${banco.nombre} ya está registrada (${repetida.id})`,
                'cuenta_bancaria_duplicada',
                'Cuenta bancaria duplicada',
            )
        }

        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?)', [LOCK_SUBCUENTAS])
        const padre = (await t.trx
            .from('ledger.cuentas')
            .where('codigo', CUENTAS.BANCOS)
            .select('id')
            .firstOrFail()) as { id: number }
        const hijas = (await t.trx
            .from('ledger.cuentas')
            .where('padre_id', padre.id)
            .select('codigo')) as Array<{ codigo: string }>
        const siguiente =
            Math.max(0, ...hijas.map((h) => Number(h.codigo.split('.').at(-1))).filter(Number.isFinite)) + 1
        const [cuenta] = (await t.trx
            .insertQuery()
            .table('ledger.cuentas')
            .insert({
                codigo: `${CUENTAS.BANCOS}.${String(siguiente).padStart(2, '0')}`,
                nombre: nombreCuentaLibro(banco.nombre, input.alias.trim(), numero),
                tipo: 'activo',
                padre_id: padre.id,
                imputable: true,
                auxiliar_cliente: false,
            })
            .returning('id')) as Array<{ id: number }>

        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.cuentas_bancarias')
            .insert({
                banco_id: input.banco_id,
                numero,
                alias: input.alias.trim(),
                moneda: input.moneda ?? 'GTQ',
                activa: input.activa ?? true,
                cuenta_id: cuenta!.id,
            })
            .returning('id')) as Array<{ id: number }>
        const creada = await verCuentaBancaria(fila!.id, t.trx)
        await t.registrarCambios({ tipo: 'cuenta_bancaria', id: creada.id }, null, {
            banco_id: creada.banco_id,
            numero: creada.numero,
            alias: creada.alias,
            moneda: creada.moneda,
            activa: creada.activa,
            cuenta_id: creada.cuenta_id,
        })
        return creada
    }
}
