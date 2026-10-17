import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { verMigracionAaa, type MigracionAaaVista } from '#network/sesiones/migracion_aaa'

export interface EntradaMarcarRouterMigrado {
    router_id: number
    /** Desde cuándo el router usa el nuevo `aaa`. Omitido = ahora; null = desmarcar (vuelta atrás) */
    desde?: Date | null
    motivo: string
    /** `version` leída de `GET /routers/:id/migracion-aaa`; si cambió, 409 */
    version?: number
}

/** Tolerancia para relojes desfasados entre el panel y la API. */
const FUTURO_MAXIMO_MS = 5 * 60_000

/**
 * `POST /routers/:id/marcar-migrado`: registra cuándo el router pasó al nuevo `aaa` (o lo
 * desmarca con `desde: null`). Decisión y motivos en `migracion_aaa.ts`. No toca el router ni
 * las sesiones y no emite evento (no es un cambio de estado de ningún servicio): la usan la
 * pantalla "Migración de router" y `GET /routers/:id/resumen-sesiones` como `desde` por defecto.
 */
export default class MarcarRouterMigrado extends DomainAction<EntradaMarcarRouterMigrado, MigracionAaaVista> {
    readonly nombre = 'routers.marcar_migrado'

    protected async handle(input: EntradaMarcarRouterMigrado, t: Transaccion) {
        const router = await t.trx
            .from('network.routers')
            .where('id', input.router_id)
            .forUpdate()
            .select('id')
            .first()
        if (!router) throw new NoEncontrado(`El router ${input.router_id} no existe`)
        t.fijarEntidad('router', input.router_id)

        const desde = input.desde === undefined ? new Date() : input.desde
        if (desde && desde.getTime() > Date.now() + FUTURO_MAXIMO_MS) {
            throw new ValidacionFallida([
                { field: 'desde', message: 'La fecha de migración no puede ser futura', rule: 'futuro' },
            ])
        }

        const antes = (await t.trx
            .from('network.routers_migracion_aaa')
            .where('router_id', input.router_id)
            .select('aaa_desde', 'motivo', 'version')
            .first()) as { aaa_desde: Date | null; motivo: string; version: number } | null
        if (input.version !== undefined && (antes?.version ?? 0) !== input.version) {
            throw new ConflictoVersion('La migración del router', input.router_id)
        }

        if (antes) {
            await t.trx
                .from('network.routers_migracion_aaa')
                .where('router_id', input.router_id)
                .update({
                    aaa_desde: desde,
                    motivo: input.motivo,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
        } else {
            await t.trx
                .table('network.routers_migracion_aaa')
                .insert({ router_id: input.router_id, aaa_desde: desde, motivo: input.motivo })
        }
        const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)
        await t.registrarCambios(
            { tipo: 'router', id: input.router_id },
            { aaa_desde: iso(antes?.aaa_desde) },
            { aaa_desde: iso(desde) },
        )
        return verMigracionAaa(input.router_id, t.trx)
    }
}
