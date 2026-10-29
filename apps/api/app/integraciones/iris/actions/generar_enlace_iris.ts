import { randomBytes } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { VIGENCIA_ENLACE_MIN, hashCodigo } from '#integraciones/horus/actions/generar_enlace_horus'
import { errorUrlIris } from '#integraciones/iris/configuracion'

export interface EntradaGenerarEnlaceIris {
    /** URL pública de la API de Argos (Iris canjea ahí); la pone la ruta */
    base_url: string
}

export interface SalidaGenerarEnlaceIris {
    /** `https://<argos>/conectar#<codigo>`: se muestra una sola vez */
    enlace: string
    vence_en: string
}

/**
 * `iris.generar_enlace` (permiso `iris.configurar`): enlace de conexión para pegar en Iris (contrato
 * Iris §1.3 → Horus §1.4). Mismo formato y reglas que el de Horus (`hashCodigo`, 15 min, un solo
 * uso, un enlace nuevo anula los anteriores sin usar), en su propia tabla
 * (`integraciones.iris_enlaces`). El código no queda en la auditoría (la salida no se audita).
 */
export default class GenerarEnlaceIris extends DomainAction<
    EntradaGenerarEnlaceIris,
    SalidaGenerarEnlaceIris
> {
    readonly nombre = 'iris.generar_enlace'

    protected async handle(
        input: EntradaGenerarEnlaceIris,
        t: Transaccion,
    ): Promise<SalidaGenerarEnlaceIris> {
        t.fijarEmpresa(null)
        const base = input.base_url.replace(/\/+$/, '')
        const error = errorUrlIris(base)
        if (error) {
            throw new ValidacionFallida([
                { field: 'base_url', message: `URL pública de Argos: ${error}`, rule: 'url' },
            ])
        }
        const anulados = (await t.trx
            .from('integraciones.iris_enlaces')
            .whereNull('usado_en')
            .whereNull('anulado_en')
            .update({ anulado_en: t.trx.knexRawQuery('now()') }, ['id'])) as Array<{ id: number }>
        if (anulados.length > 0) t.anotarAuditoria({ enlaces_anulados: anulados.map((e) => Number(e.id)) })
        const codigo = randomBytes(32).toString('base64url')
        const vence = new Date(Date.now() + VIGENCIA_ENLACE_MIN * 60_000)
        const [fila] = (await t.trx
            .table('integraciones.iris_enlaces')
            .insert({
                codigo_sha256: hashCodigo(codigo),
                base_url: base,
                vence_en: vence,
                creado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('enlace_iris', Number(fila!.id))
        return { enlace: `${base}/conectar#${codigo}`, vence_en: vence.toISOString() }
    }
}
