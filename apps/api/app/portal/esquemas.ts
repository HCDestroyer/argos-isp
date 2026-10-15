import { Dinero, definirEsquema, entero, nulable, objeto, texto } from '#shared/openapi/esquemas'
import { EstadoServicio } from '#core/esquemas'

/**
 * Schemas del portal del cliente (A5). Desde la IP solo se muestra información mínima.
 */

export const QuienSoy = definirEsquema(
    'QuienSoy',
    objeto({
        identificado: {
            type: 'boolean',
            description: 'false si la IP de origen no pertenece a ningún servicio',
        },
        nombre_parcial: { ...nulable(texto), description: 'Nombre recortado, p. ej. "Juan P."' },
        estado: nulable(EstadoServicio),
        monto_adeudado: nulable(Dinero),
        facturas_vencidas: nulable(entero),
    }),
)
