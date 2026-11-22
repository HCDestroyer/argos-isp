import { DomainAction, type Transaccion } from '#shared/domain_action'
import { hashCodigoIdentificacion, normalizarCodigoIdentificacion } from '#core/codigos_identificacion'

export interface EntradaCanjearCodigoIdentificacion {
    codigo: string
}

export interface SalidaCanjearCodigoIdentificacion {
    /** servicio del código, o null si no existe, ya se usó, se anuló o venció */
    servicio_id: number | null
}

/**
 * Canjea un código para identificarse en el portal (`servicios.canjear_codigo_identificacion`, acción
 * del sistema; interfaz pública para el portal de A5). Un solo uso: lo marca `usado_en`. La entrada
 * se audita con el código como `***`. El límite de intentos por IP es del portal
 * (`PORTAL_LIMITE_CODIGOS_FALLIDOS`).
 */
export default class CanjearCodigoIdentificacion extends DomainAction<
    EntradaCanjearCodigoIdentificacion,
    SalidaCanjearCodigoIdentificacion
> {
    readonly nombre = 'servicios.canjear_codigo_identificacion'
    protected readonly camposEntradaOcultos = ['codigo']

    protected async handle(
        input: EntradaCanjearCodigoIdentificacion,
        t: Transaccion,
    ): Promise<SalidaCanjearCodigoIdentificacion> {
        const codigo = normalizarCodigoIdentificacion(input.codigo)
        if (!codigo) return { servicio_id: null }
        const fila = (await t.trx
            .from('core.codigos_identificacion')
            .where('codigo_hash', hashCodigoIdentificacion(codigo))
            .whereNull('usado_en')
            .whereNull('anulado_en')
            .where('expira_en', '>', t.trx.knexRawQuery('now()'))
            .orderBy('id', 'desc')
            .forUpdate()
            .select('id', 'servicio_id', 'empresa_id')
            .first()) as { id: number; servicio_id: number; empresa_id: number } | null
        if (!fila) return { servicio_id: null }
        t.fijarEmpresa(Number(fila.empresa_id))
        t.fijarEntidad('servicio', Number(fila.servicio_id))
        await t.trx
            .from('core.codigos_identificacion')
            .where('id', fila.id)
            .update({ usado_en: t.trx.knexRawQuery('now()') } as Record<string, unknown>)
        return { servicio_id: Number(fila.servicio_id) }
    }
}
