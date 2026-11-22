import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ajusteEntero } from '#core/ajustes_operacion'
import { generarCodigoIdentificacion, hashCodigoIdentificacion } from '#core/codigos_identificacion'

export interface EntradaGenerarCodigoIdentificacion {
    servicio_id: number
}

export interface CodigoIdentificacionGenerado {
    servicio_id: number
    /** 6 dígitos; solo en esta respuesta */
    codigo: string
    expira_en: string
    vigencia_min: number
}

/**
 * Genera el código de un solo uso para identificarse en el portal
 * (`servicios.generar_codigo_identificacion`, decisión del PM 19). Anula el anterior vigente del
 * servicio; vale `codigo_corte.vigencia_min` (empresa del servicio → global → 15). El código solo sale
 * en la respuesta: la auditoría guarda el vencimiento y `servicio.codigo_identificacion_emitido` no lo
 * lleva. Un servicio retirado no admite código (422 `servicio_retirado`).
 */
export default class GenerarCodigoIdentificacion extends DomainAction<
    EntradaGenerarCodigoIdentificacion,
    CodigoIdentificacionGenerado
> {
    readonly nombre = 'servicios.generar_codigo_identificacion'

    protected async handle(
        input: EntradaGenerarCodigoIdentificacion,
        t: Transaccion,
    ): Promise<CodigoIdentificacionGenerado> {
        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .forUpdate()
            .select('empresa_id', 'estado')
            .first()) as { empresa_id: number; estado: string } | null
        if (!servicio) throw new NoEncontrado(`El servicio ${input.servicio_id} no existe`)
        const empresaId = Number(servicio.empresa_id)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('servicio', input.servicio_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        if (servicio.estado === 'retirado') {
            throw new ReglaNegocio('El servicio está retirado', 'servicio_retirado')
        }
        await t.trx
            .from('core.codigos_identificacion')
            .where('servicio_id', input.servicio_id)
            .whereNull('usado_en')
            .whereNull('anulado_en')
            .update({ anulado_en: t.trx.knexRawQuery('now()') } as Record<string, unknown>)

        const vigencia = await ajusteEntero('codigo_corte.vigencia_min', empresaId, t.trx)
        // 6 dígitos: se evita repetir uno vigente de otro servicio (lo resolvería mal)
        let codigo = generarCodigoIdentificacion()
        for (let i = 0; i < 20; i++) {
            const repetido = await t.trx
                .from('core.codigos_identificacion')
                .where('codigo_hash', hashCodigoIdentificacion(codigo))
                .whereNull('usado_en')
                .whereNull('anulado_en')
                .where('expira_en', '>', t.trx.knexRawQuery('now()'))
                .first()
            if (!repetido) break
            codigo = generarCodigoIdentificacion()
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.codigos_identificacion')
            .insert({
                servicio_id: input.servicio_id,
                empresa_id: empresaId,
                codigo_hash: hashCodigoIdentificacion(codigo),
                expira_en: t.trx.knexRawQuery(`now() + make_interval(mins => ?)`, [vigencia]),
                creado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning(['id', 'expira_en'])) as Array<{ id: number; expira_en: Date }>
        const expiraEn = new Date(fila!.expira_en).toISOString()
        t.anotarAuditoria({ codigo_identificacion_id: Number(fila!.id), expira_en: expiraEn })
        await t.emit('servicio.codigo_identificacion_emitido', {
            servicio_id: input.servicio_id,
            empresa_id: empresaId,
            expira_en: expiraEn,
        })
        return { servicio_id: input.servicio_id, codigo, expira_en: expiraEn, vigencia_min: vigencia }
    }
}
