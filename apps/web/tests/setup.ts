import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { Headers as HeadersHappyDom } from 'happy-dom'
import { afterEach } from 'vitest'

/**
 * En el entorno `nuxt` + happy-dom, `Request` es el de happy-dom pero `Headers` es el de Node.
 * openapi-fetch arma los headers con `new Headers()` y el `Request` de happy-dom descarta los de
 * otra implementación (salvo Content-Type), así que `Idempotency-Key` no llegaba a los fixtures.
 * En el navegador ambos son nativos y no pasa.
 */
globalThis.Headers = HeadersHappyDom as unknown as typeof globalThis.Headers

/**
 * Lo mismo con los archivos: `fetch` de happy-dom entrega un `Blob` de happy-dom y
 * `URL.createObjectURL` es el de Node, que solo acepta los suyos ("must be an instance of Blob").
 * La pantalla (imagen de un premio, vista previa de un comprobante) solo necesita una URL de objeto:
 * con un `Blob` ajeno se devuelve una `blob:` propia. En el navegador ambos son nativos.
 */
const crearUrlNativa = URL.createObjectURL.bind(URL)
URL.createObjectURL = (objeto: Blob | MediaSource): string => {
    try {
        return crearUrlNativa(objeto)
    }
    catch {
        return `blob:prueba/${crypto.randomUUID()}`
    }
}

/**
 * Nada de la prueba sigue vivo cuando el entorno se desmonta. Antes, una pantalla montada con
 * `mountSuspended` quedaba montada al terminar: un temporizador suyo (la búsqueda con espera de
 * `ClienteSelector`, el refresco de la sesión) o una respuesta de los fixtures llegaba después,
 * Vue repintaba una lista de reka-ui y fallaba con "Element is not defined" (el `window` de
 * happy-dom ya no existía). Solo pasaba con la máquina cargada.
 *
 * Los `afterEach` corren en orden inverso al de registro: primero se esperan las promesas
 * pendientes (con el DOM vivo), luego se desmonta todo lo montado en la prueba (cada componente
 * limpia sus temporizadores en `onBeforeUnmount`) y al final se vacía lo que el desmontaje dejó.
 */
afterEach(async () => {
    await flushPromises()
})
enableAutoUnmount(afterEach)
afterEach(async () => {
    await flushPromises()
})
