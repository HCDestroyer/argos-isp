import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { Lugar } from '#portal/anuncios'

export interface EntradaRegistrarEventoAnuncio {
    anuncio_id: number
    tipo: 'vista' | 'clic'
    /** UUID que el navegador genera por sesión; no identifica a nadie */
    visitante: string
    lugar: Lugar
}

/**
 * Cuenta una vista o un clic de un anuncio vigente (el portal ya comprobó que lo es). Idempotente:
 * una vista y un clic por visitante y anuncio (`anuncios_eventos_unico`); repetir no suma.
 *
 * Telemetría de alta frecuencia que no es una acción de nadie (como el Interim-Update de accounting,
 * `.claude/CLAUDE.md` regla 9): el éxito no deja fila en `audit.acciones`; los errores sí.
 */
export default class RegistrarEventoAnuncio extends DomainAction<
    EntradaRegistrarEventoAnuncio,
    { nuevo: boolean }
> {
    readonly nombre = 'anuncios.registrar_evento'

    protected auditarExito(): boolean {
        return false
    }

    protected async handle(
        input: EntradaRegistrarEventoAnuncio,
        t: Transaccion,
    ): Promise<{ nuevo: boolean }> {
        t.fijarEntidad('anuncio', input.anuncio_id)
        const filas = (await t.trx
            .knexQuery()
            .table('core.anuncios_eventos')
            .insert(input)
            .onConflict(['anuncio_id', 'tipo', 'visitante'])
            .ignore()
            .returning('id')) as Array<{ id: number }>
        return { nuevo: filas.length > 0 }
    }
}
