import logger from '@adonisjs/core/services/logger'
import { contextoSistema } from '#shared/contexto'
import SembrarCuentaPasarela from '#billing/actions/sembrar_cuenta_pasarela'

/**
 * Siembra la cuenta de pasarela de la empresa principal desde el entorno si falta (una sola vez).
 * Un fallo (base caída al arrancar) queda en el log y no detiene el proceso: mientras no exista la
 * cuenta, las variables de entorno siguen siendo el respaldo.
 */
export async function sembrarCuentaPasarelaDelEntorno(): Promise<void> {
    try {
        const resultado = await new SembrarCuentaPasarela().execute(
            {},
            contextoSistema('consola', 'arranque-pasarelas'),
        )
        if (resultado.sembrada) {
            logger.info(
                { cuenta_id: resultado.cuenta_id, variables: resultado.variables },
                'billing: cuenta de pasarela de la empresa principal sembrada desde el entorno (una sola vez; desde ahora manda la cuenta)',
            )
        }
    } catch (error) {
        logger.error({ err: error }, 'billing: no se pudo sembrar la cuenta de pasarela')
    }
}
