import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { empresaLealtad } from '#lealtad/comun'
import { nuevoCodigo } from '#lealtad/referidos'

/**
 * `lealtad.generar_codigo_referido` (§3): el código de 8 caracteres del cliente en la empresa
 * (uno por cliente y empresa, para siempre). Si ya tiene, lo devuelve sin escribir nada. Lo usará
 * el portal (`GET /portal/referidos`, A5, fase 2).
 */
export default class GenerarCodigoReferido extends DomainAction<
    { cliente_id: number; empresa_id?: number | null },
    { cliente_id: number; empresa_id: number; codigo: string }
> {
    readonly nombre = 'lealtad.generar_codigo_referido'

    protected async handle(input: { cliente_id: number; empresa_id?: number | null }, t: Transaccion) {
        const empresaId = await empresaLealtad(t, input.empresa_id)
        t.fijarEntidad('cliente', input.cliente_id)
        const cliente = await t.trx.from('core.clientes').where('id', input.cliente_id).select('id').first()
        if (!cliente) throw new NoEncontrado(`El cliente ${input.cliente_id} no existe`)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(5104, ?::int)', [input.cliente_id])
        const existente = (await t.trx
            .from('lealtad.codigos_referido')
            .where({ cliente_id: input.cliente_id, empresa_id: empresaId })
            .select('codigo')
            .first()) as { codigo: string } | null
        if (existente) {
            return { cliente_id: input.cliente_id, empresa_id: empresaId, codigo: existente.codigo }
        }
        for (let intento = 0; intento < 10; intento++) {
            const codigo = nuevoCodigo()
            const insertados = (await t.trx
                .insertQuery()
                .table('lealtad.codigos_referido')
                .insert({ cliente_id: input.cliente_id, empresa_id: empresaId, codigo })
                .knexQuery.onConflict('codigo')
                .ignore()
                .returning('codigo')) as Array<{ codigo: string }>
            if (insertados.length > 0) return { cliente_id: input.cliente_id, empresa_id: empresaId, codigo }
        }
        throw new Error('No se pudo generar un código de referido único')
    }
}
