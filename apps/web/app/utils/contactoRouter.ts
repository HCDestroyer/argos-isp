import type { Schema } from '@argosisp/contracts'

type Contacto = Pick<Schema<'Router'>, 'en_linea' | 'ultimo_contacto'>

/**
 * Estado en línea de un router (`Router.en_linea`): `true` con accounting RADIUS o sondeo de
 * RouterOS dentro del umbral (15 min por defecto), `false` si pasó, `null` si ninguna fuente
 * periódica lo mide todavía: no se sabe, y así se muestra. Presentación en `ESTADOS_ROUTER`.
 */
export function estadoContactoRouter(router: Contacto): EstadoRouter {
    if (router.en_linea === null) {
        return 'desconocido'
    }
    return router.en_linea ? 'en_linea' : 'caido'
}

/** "hace 3 min" (con la fecha y hora en Guatemala aparte) o "Nunca respondió" si no hay contacto. */
export function textoUltimoContacto(router: Contacto, ahora: number = Date.now()): string {
    return router.ultimo_contacto ? haceCuanto(router.ultimo_contacto, ahora) : 'Nunca respondió'
}
