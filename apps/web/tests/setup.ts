import { Headers as HeadersHappyDom } from 'happy-dom'

/**
 * En el entorno `nuxt` + happy-dom, `Request` es el de happy-dom pero `Headers` es el de Node.
 * openapi-fetch arma los headers con `new Headers()` y el `Request` de happy-dom descarta los de
 * otra implementación (salvo Content-Type), así que `Idempotency-Key` no llegaba a los fixtures.
 * En el navegador ambos son nativos y no pasa.
 */
globalThis.Headers = HeadersHappyDom as unknown as typeof globalThis.Headers
