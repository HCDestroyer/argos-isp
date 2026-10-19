import { createHash, randomBytes } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { errorUrl } from '#integraciones/horus/configuracion'

/** Vigencia del enlace (§1.4). */
export const VIGENCIA_ENLACE_MIN = 15

export interface EntradaGenerarEnlace {
    /** URL pública de Argos (la que Horus usará para canjear); la pone la ruta */
    base_url: string
}

export interface SalidaGenerarEnlace {
    /** `https://<argos>/conectar#<codigo>`: se muestra una sola vez */
    enlace: string
    vence_en: string
}

export function hashCodigo(codigo: string): string {
    return createHash('sha256').update(codigo, 'utf8').digest('hex')
}

/**
 * `horus.generar_enlace` (permiso `horus.configurar`): enlace de
 * conexión de §1.4. Código aleatorio de 32 bytes; en la base solo su SHA-256, con vencimiento a
 * los 15 min y un solo uso. El código va en el fragmento (`#`), que el navegador no envía.
 * El código no queda en la auditoría (la salida no se audita). Generar un enlace anula los
 * anteriores sin usar (1.5.0): canjearlos responde 410.
 */
export default class GenerarEnlaceHorus extends DomainAction<EntradaGenerarEnlace, SalidaGenerarEnlace> {
    readonly nombre = 'horus.generar_enlace'

    protected async handle(input: EntradaGenerarEnlace, t: Transaccion): Promise<SalidaGenerarEnlace> {
        t.fijarEmpresa(null)
        const base = input.base_url.replace(/\/+$/, '')
        const error = errorUrl(base)
        if (error) {
            throw new ValidacionFallida([
                { field: 'base_url', message: `URL pública de Argos: ${error}`, rule: 'url' },
            ])
        }
        const anulados = (await t.trx
            .from('integraciones.horus_enlaces')
            .whereNull('usado_en')
            .whereNull('anulado_en')
            .update({ anulado_en: t.trx.knexRawQuery('now()') }, ['id'])) as Array<{ id: number }>
        if (anulados.length > 0) t.anotarAuditoria({ enlaces_anulados: anulados.map((e) => Number(e.id)) })
        const codigo = randomBytes(32).toString('base64url')
        const vence = new Date(Date.now() + VIGENCIA_ENLACE_MIN * 60_000)
        const [fila] = (await t.trx
            .table('integraciones.horus_enlaces')
            .insert({
                codigo_sha256: hashCodigo(codigo),
                base_url: base,
                vence_en: vence,
                creado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('enlace_horus', Number(fila!.id))
        return { enlace: `${base}/conectar#${codigo}`, vence_en: vence.toISOString() }
    }
}
