import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { exigirTokenIris } from '#integraciones/iris/token_iris'
import { guardarConectorIris, type SincronizacionIris } from '#integraciones/iris/configuracion'

export interface EntradaInformarSincronizacionIris {
    sincronizacion_id: string
    estado: SincronizacionIris['estado']
    iniciada_en: Date
    actualizada_en: Date
    etapas: Array<{
        recurso: string
        estado: SincronizacionIris['etapas'][number]['estado']
        procesados: number
        total: number | null
        error: string | null
        terminada_en: Date | null
    }>
    /** id (`core.tokens_api.id`) del token de la petición; no se llama `token_*` para que la auditoría no lo enmascare */
    atk_id: number | null
}

export interface SalidaInformarSincronizacionIris {
    sincronizacion_id: string
    estado: SincronizacionIris['estado']
    actualizada_en: string
}

/**
 * `iris.informar_sincronizacion` (`PUT /integraciones/iris/sincronizacion`, contrato Iris 0.8.0,
 * §2.5): Iris informa el avance de su primera sincronización (lecturas en bloque de Argos). Es
 * estado de Iris, no de Argos: se guarda tal cual en `integraciones.iris_conector.sincronizacion`
 * (diff en `audit.cambios`) y el panel lo muestra (`GET /integraciones/iris`).
 *
 * - Solo el `atk_` de Iris (`exigirTokenIris`, como `PUT /integraciones/iris/contrato`); funciona
 *   con el conector apagado.
 * - **Idempotente:** la misma `sincronizacion_id` con el mismo `actualizada_en` responde lo guardado
 *   sin escribir.
 * - **409 `sincronizacion_vieja`:** `actualizada_en` menor que el guardado para esa
 *   `sincronizacion_id`, o una `sincronizacion_id` más vieja que la guardada (los UUID v7 se ordenan
 *   por tiempo: se comparan como texto en minúsculas).
 * - Una `sincronizacion_id` más nueva reemplaza a la anterior.
 */
export default class InformarSincronizacionIris extends DomainAction<
    EntradaInformarSincronizacionIris,
    SalidaInformarSincronizacionIris
> {
    readonly nombre = 'iris.informar_sincronizacion'

    protected async handle(
        input: EntradaInformarSincronizacionIris,
        t: Transaccion,
    ): Promise<SalidaInformarSincronizacionIris> {
        t.fijarEmpresa(null)
        t.fijarEntidad('conector_iris', 1)
        const antes = await exigirTokenIris(t, input.atk_id, 'informar su sincronización')
        const id = input.sincronizacion_id.toLowerCase()
        const actualizada = input.actualizada_en.toISOString()
        const guardada = antes?.sincronizacion ?? null
        if (guardada) {
            if (id < guardada.sincronizacion_id) {
                throw new Conflicto(
                    `Ya se informó una sincronización más nueva (${guardada.sincronizacion_id})`,
                    'sincronizacion_vieja',
                )
            }
            if (id === guardada.sincronizacion_id) {
                const anterior = new Date(guardada.actualizada_en).getTime()
                if (input.actualizada_en.getTime() < anterior) {
                    throw new Conflicto(
                        `Ya se informó un avance más reciente de esta sincronización (${guardada.actualizada_en})`,
                        'sincronizacion_vieja',
                    )
                }
                if (input.actualizada_en.getTime() === anterior) {
                    t.anotarAuditoria({ repeticion: true })
                    return respuesta(guardada)
                }
            }
        }
        const sincronizacion: SincronizacionIris = {
            sincronizacion_id: id,
            estado: input.estado,
            iniciada_en: input.iniciada_en.toISOString(),
            actualizada_en: actualizada,
            etapas: input.etapas.map((e) => ({
                recurso: e.recurso,
                estado: e.estado,
                procesados: e.procesados,
                total: e.total,
                error: e.error,
                terminada_en: e.terminada_en ? e.terminada_en.toISOString() : null,
            })),
            recibida_en: new Date().toISOString(),
        }
        // jsonb: knex necesita el texto (un objeto lo serializaría como registro)
        await guardarConectorIris(t, antes, { sincronizacion: JSON.stringify(sincronizacion) })
        return respuesta(sincronizacion)
    }
}

function respuesta(s: SincronizacionIris): SalidaInformarSincronizacionIris {
    return { sincronizacion_id: s.sincronizacion_id, estado: s.estado, actualizada_en: s.actualizada_en }
}
