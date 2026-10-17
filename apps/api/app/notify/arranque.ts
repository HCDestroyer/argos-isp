import logger from '@adonisjs/core/services/logger'
import { contextoSistema } from '#shared/contexto'
import { configuraciones, escucharInvalidaciones } from '#notify/configuracion'
import SembrarConfiguracionCanales from '#notify/actions/sembrar_configuracion_canales'

/**
 * Arranque de la configuración de canales en un proceso que envía (API y `notify:worker`):
 *
 * 1. Siembra la configuración global desde el entorno si todavía no existe (una sola vez en la
 *    vida de la instalación; queda en el log y en la auditoría).
 * 2. Se suscribe a las invalidaciones de otros procesos (Redis Pub/Sub).
 * 3. Carga la configuración, para que las lecturas síncronas (portal) no caigan al entorno.
 *
 * Un fallo (base o Redis caídos al arrancar) queda en el log y no detiene el proceso: la
 * configuración se lee en el primer envío.
 */
export async function prepararConfiguracionNotify(): Promise<void> {
    try {
        const resultado = await new SembrarConfiguracionCanales().execute(
            {},
            contextoSistema('consola', 'arranque-notify'),
        )
        if (resultado.sembrada) {
            logger.info(
                { configuracion_id: resultado.configuracion_id, variables: resultado.variables },
                'notify: configuración global de canales sembrada desde el entorno (una sola vez; desde ahora manda el panel)',
            )
        }
    } catch (error) {
        logger.error({ err: error }, 'notify: no se pudo sembrar la configuración de canales')
    }
    await escucharInvalidaciones()
    try {
        await configuraciones()
    } catch (error) {
        logger.error({ err: error }, 'notify: no se pudo cargar la configuración de canales')
    }
}
