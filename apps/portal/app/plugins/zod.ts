import { z } from 'zod'

/**
 * zod v4 prueba `new Function('')` para compilar los esquemas (JIT). La CSP del portal no permite
 * `unsafe-eval` (`server/utils/cabecerasSeguridad.ts`), así que esa prueba genera una violación
 * de CSP en cada página con formulario. Sin JIT los esquemas validan igual.
 */
export default defineNuxtPlugin(() => {
    z.config({ jitless: true })
})
