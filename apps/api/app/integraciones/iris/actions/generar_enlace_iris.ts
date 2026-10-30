import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { crearCodigoIris } from '#integraciones/iris/autorizacion'
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
 * (`integraciones.iris_enlaces`, `crearCodigoIris`, compartido con «Conectar con un botón» de §1.4).
 * El código no queda en la auditoría (la salida no se audita).
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
        const { codigo, vence } = await crearCodigoIris(t, { base_url: base })
        return { enlace: `${base}/conectar#${codigo}`, vence_en: vence.toISOString() }
    }
}
