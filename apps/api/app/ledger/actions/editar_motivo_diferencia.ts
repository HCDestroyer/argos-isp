import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ConflictoVersion, NoEncontrado } from '#shared/errores'
import { resolverEmpresaActiva } from '#core/empresas'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { LOCK_DIFERENCIAS, verMotivo, type MotivoDiferenciaVista } from '#ledger/diferencias_conciliacion'
import {
    CAMPOS_MOTIVO,
    normalizarMotivo,
    type DatosMotivo,
    type EntradaMotivo,
} from '#ledger/motivos_diferencia'

/**
 * `bancos.editar_motivo_diferencia` (`PUT /bancos/motivos-diferencia/:id`, permiso
 * `bancos.configurar_diferencias`; plan de contabilidad §5.8). Con `version` (409
 * `conflicto_version`) y `audit.cambios`. Un motivo **de fábrica** no se toca: la empresa activa (o
 * `empresa_id`) recibe su propia copia con el mismo `codigo` y los cambios, que lo reemplaza solo en
 * ella. Un motivo fijo (retención, B10) no se apaga. Los motivos no se borran: se apagan. Evento
 * `banco.diferencias_config_cambiada` con los campos que cambiaron (sin cambios no emite).
 */
export default class EditarMotivoDiferencia extends DomainAction<
    EntradaMotivo & { id: number; version: number; empresa_id?: number | null },
    MotivoDiferenciaVista
> {
    readonly nombre = 'bancos.editar_motivo_diferencia'

    protected async handle(
        input: EntradaMotivo & { id: number; version: number; empresa_id?: number | null },
        t: Transaccion,
    ): Promise<MotivoDiferenciaVista> {
        const actual = (await t.trx
            .from('billing.motivos_diferencia')
            .where('id', input.id)
            .select('*')
            .first()) as Record<string, unknown> | null
        if (!actual) throw new NoEncontrado(`El motivo de diferencia ${input.id} no existe`)
        const deFabrica = actual.empresa_id === null
        const empresaId = deFabrica
            ? (input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx)))
            : Number(actual.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?::int)', [LOCK_DIFERENCIAS, empresaId])
        if (Number(actual.version) !== input.version) {
            throw new ConflictoVersion('motivo_diferencia', input.id)
        }
        const vista = await verMotivo(input.id, t.trx)
        const antes: DatosMotivo = {
            nombre: vista.nombre,
            sentido: vista.sentido,
            se_ofrece_en: vista.se_ofrece_en,
            cuenta_banco_id: vista.cuenta_banco_id,
            texto: vista.texto,
            limite_tipo: vista.limite_tipo,
            limite_valor: vista.limite_valor,
            cuenta_codigo: vista.cuenta_codigo,
            cuenta_contra_tope: vista.cuenta_contra_tope,
            siempre_aprobacion: vista.siempre_aprobacion,
            activo: vista.activo,
            orden: vista.orden,
        }
        const despues = await normalizarMotivo(t, input, antes, empresaId, vista.fija)
        const campos = CAMPOS_MOTIVO.filter((c) => despues[c] !== antes[c])
        if (campos.length === 0) return vista

        const usuario = usuarioDelActor(t.ctx.actor)
        let id = input.id
        if (deFabrica) {
            const propio = await t.trx
                .from('billing.motivos_diferencia')
                .where({ empresa_id: empresaId, codigo: vista.codigo })
                .select('id')
                .first()
            if (propio) throw new ConflictoVersion('motivo_diferencia', input.id)
            const [fila] = (await t.trx
                .insertQuery()
                .table('billing.motivos_diferencia')
                .insert({
                    ...despues,
                    empresa_id: empresaId,
                    codigo: vista.codigo,
                    clase: vista.clase,
                    fija: vista.fija,
                    updated_by: usuario,
                })
                .returning('id')) as Array<{ id: number }>
            id = Number(fila!.id)
        } else {
            await t.trx
                .from('billing.motivos_diferencia')
                .where('id', input.id)
                .update({
                    ...despues,
                    updated_by: usuario,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
        }
        t.fijarEntidad('motivo_diferencia', id)
        const pick = (d: DatosMotivo) => Object.fromEntries(campos.map((c) => [c, d[c]]))
        await t.registrarCambios({ tipo: 'motivo_diferencia', id }, pick(antes), pick(despues))
        await t.emit('banco.diferencias_config_cambiada', { empresa_id: empresaId, motivo_id: id, campos })
        return verMotivo(id, t.trx)
    }
}
