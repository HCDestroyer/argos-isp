import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import {
    normalizarOpciones,
    verCampoPersonalizado,
    type CampoPersonalizadoVista,
} from '#core/campos_personalizados'

export interface EntradaEditarCampoPersonalizado {
    id: number
    version: number
    etiqueta?: string
    /** solo `opcion`; reemplaza la lista completa */
    opciones?: string[]
    requerido?: boolean
    orden?: number
}

/**
 * Edita la etiqueta, las opciones, si es requerido o el orden de un campo personalizado
 * (`campos_personalizados.editar`, control optimista por `version`). `clave` y `tipo` no se
 * cambian. Quitar una opción no toca a los clientes que la tienen: su valor se conserva y el
 * siguiente guardado de su ficha pide uno válido.
 */
export default class EditarCampoPersonalizado extends DomainAction<
    EntradaEditarCampoPersonalizado,
    CampoPersonalizadoVista
> {
    readonly nombre = 'campos_personalizados.editar'

    protected async handle(
        input: EntradaEditarCampoPersonalizado,
        t: Transaccion,
    ): Promise<CampoPersonalizadoVista> {
        t.fijarEntidad('campo_personalizado', input.id)
        const antes = await verCampoPersonalizado(input.id, t.trx)
        verificarVersion('campo personalizado', input.id, antes.version, input.version)
        const cambios: Record<string, unknown> = {}
        if (input.etiqueta !== undefined) cambios.etiqueta = input.etiqueta.trim()
        if (input.opciones !== undefined) {
            cambios.opciones = JSON.stringify(normalizarOpciones(antes.tipo, input.opciones))
        }
        if (input.requerido !== undefined) cambios.requerido = input.requerido
        if (input.orden !== undefined) cambios.orden = input.orden
        await actualizarConVersion(t.trx, 'core.campos_personalizados', input.id, input.version, cambios)
        const despues = await verCampoPersonalizado(input.id, t.trx)
        await t.registrarCambios({ tipo: 'campo_personalizado', id: input.id }, antes, despues)
        return despues
    }
}
