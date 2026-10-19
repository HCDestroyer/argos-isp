import type { RouterConfig } from '@nuxt/schema'

/**
 * En `/sso/entrar#<ticket>` y `/conectar#<código>` el fragmento es un secreto, no un ancla: el
 * `scrollBehavior` por defecto lo usaba como selector y, al no encontrarlo, lo escribía en la
 * consola ("Couldn't find element using selector #tkt_…"). Aquí esas rutas solo suben al inicio.
 * El resto se comporta como el de Nuxt: posición guardada, ancla del fragmento o arriba.
 */
const CON_SECRETO_EN_FRAGMENTO = new Set(['/sso/entrar', '/conectar'])

export default {
    scrollBehavior(to, _from, guardada) {
        if (guardada) {
            return guardada
        }
        if (to.hash && !CON_SECRETO_EN_FRAGMENTO.has(to.path)) {
            return { el: to.hash }
        }
        return { top: 0 }
    },
} satisfies RouterConfig
