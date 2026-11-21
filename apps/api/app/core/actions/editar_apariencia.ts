import { DomainAction, type Transaccion } from '#shared/domain_action'
import { verificarVersion } from '#shared/version'
import {
    aparienciaCompleta,
    filaApariencia,
    type AparienciaCompleta,
    type IdTema,
    type Modo,
} from '#core/apariencia'

export interface EntradaEditarApariencia {
    version: number
    tema?: IdTema
    modo_predeterminado?: Modo
    nombre_marca?: string
    /** null o vacío = sin eslogan */
    eslogan?: string | null
}

/**
 * Tema, modo predeterminado, nombre de marca y eslogan de la instalación (`apariencia.editar`,
 * contrato `apariencia.md` §5). Lo que no viene no cambia; `version` distinta → 409. Sin cambios
 * reales no sube la versión. Diff en `audit.cambios` (`apariencia`, 1).
 */
export default class EditarApariencia extends DomainAction<EntradaEditarApariencia, AparienciaCompleta> {
    readonly nombre = 'apariencia.editar'

    protected async handle(input: EntradaEditarApariencia, t: Transaccion): Promise<AparienciaCompleta> {
        t.fijarEntidad('apariencia', 1)
        const antes = await filaApariencia(t.trx, true)
        verificarVersion('core.apariencia', 1, antes.version, input.version)

        const cambios: Record<string, unknown> = {}
        if (input.tema !== undefined && input.tema !== antes.tema) cambios.tema = input.tema
        if (
            input.modo_predeterminado !== undefined &&
            input.modo_predeterminado !== antes.modo_predeterminado
        ) {
            cambios.modo_predeterminado = input.modo_predeterminado
        }
        if (input.nombre_marca !== undefined && input.nombre_marca !== antes.nombre_marca) {
            cambios.nombre_marca = input.nombre_marca
        }
        if (input.eslogan !== undefined) {
            const eslogan = input.eslogan?.trim() || null
            if (eslogan !== antes.eslogan) cambios.eslogan = eslogan
        }
        if (Object.keys(cambios).length === 0) return aparienciaCompleta(antes)

        const [despues] = (await t.trx
            .from('core.apariencia')
            .where('id', 1)
            .update(
                {
                    ...cambios,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                },
                ['*'],
            )) as [typeof antes]
        const previo = Object.fromEntries(
            Object.keys(cambios).map((c) => [c, antes[c as keyof typeof antes]]),
        )
        await t.registrarCambios({ tipo: 'apariencia', id: 1 }, previo, cambios)
        return aparienciaCompleta(despues)
    }
}
