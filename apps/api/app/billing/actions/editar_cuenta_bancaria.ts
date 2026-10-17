import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ConflictoVersion, NoEncontrado, ValidacionFallida } from '#shared/errores'
import {
    nombreCuentaLibro,
    verCuentaBancaria,
    type CuentaBancariaVista,
    type EntradaCuentaBancaria,
} from '#billing/cuentas_bancarias'

/**
 * `cuentas_bancarias.editar` (`PUT /cuentas-bancarias/:id`, con `version`): cambia banco, número,
 * alias, moneda o `activa` (una inactiva no recibe pagos nuevos). Renombra la subcuenta del
 * libro; nunca la desactiva (los reversos de pagos viejos deben poder usarla). Cada campo queda
 * en `audit.cambios`.
 */

export interface EntradaEditarCuentaBancaria extends Partial<EntradaCuentaBancaria> {
    id: number
    version: number
}

export default class EditarCuentaBancaria extends DomainAction<
    EntradaEditarCuentaBancaria,
    CuentaBancariaVista
> {
    readonly nombre = 'cuentas_bancarias.editar'

    protected async handle(input: EntradaEditarCuentaBancaria, t: Transaccion): Promise<CuentaBancariaVista> {
        t.fijarEntidad('cuenta_bancaria', input.id)
        const previa = (await t.trx
            .from('billing.cuentas_bancarias')
            .where('id', input.id)
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'banco_id',
                'numero',
                'alias',
                'moneda',
                'activa',
                'cuenta_id',
                'version',
            )
            .first()) as
            (Omit<CuentaBancariaVista, 'banco_nombre' | 'cuenta_codigo'> & { version: number }) | null
        if (!previa) throw new NoEncontrado(`La cuenta bancaria ${input.id} no existe`)
        exigirAccesoEmpresa(t.ctx, Number(previa.empresa_id))
        t.fijarEmpresa(Number(previa.empresa_id))
        if (previa.version !== input.version) throw new ConflictoVersion('La cuenta bancaria', input.id)

        const despues = {
            banco_id: input.banco_id ?? previa.banco_id,
            numero: input.numero?.trim() ?? previa.numero,
            alias: input.alias?.trim() ?? previa.alias,
            moneda: input.moneda ?? previa.moneda,
            activa: input.activa ?? previa.activa,
        }
        const banco = await t.trx
            .from('billing.bancos')
            .where('id', despues.banco_id)
            .select('nombre')
            .first()
        if (!banco) {
            throw new ValidacionFallida([
                { field: 'banco_id', message: `El banco ${despues.banco_id} no existe`, rule: 'exists' },
            ])
        }
        const repetida = await t.trx
            .from('billing.cuentas_bancarias')
            .where('banco_id', despues.banco_id)
            .where('numero', despues.numero)
            .whereNot('id', previa.id)
            .select('id')
            .first()
        if (repetida) {
            throw new Conflicto(
                `La cuenta ${despues.numero} de ${banco.nombre} ya está registrada (${repetida.id})`,
                'cuenta_bancaria_duplicada',
                'Cuenta bancaria duplicada',
            )
        }

        await t.trx
            .from('billing.cuentas_bancarias')
            .where('id', previa.id)
            .update({
                ...despues,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.trx
            .from('ledger.cuentas')
            .where('id', previa.cuenta_id)
            .update({
                nombre: nombreCuentaLibro(banco.nombre, despues.alias, despues.numero),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'cuenta_bancaria', id: previa.id },
            {
                banco_id: previa.banco_id,
                numero: previa.numero,
                alias: previa.alias,
                moneda: previa.moneda,
                activa: previa.activa,
            },
            despues,
        )
        return verCuentaBancaria(previa.id, t.trx)
    }
}
