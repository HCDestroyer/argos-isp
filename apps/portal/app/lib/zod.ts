import { z } from 'zod'

/**
 * zod del portal, ya configurado. Todo formulario importa `z` de aquí, nunca de `zod`, así la
 * librería (unos 90 KB) solo baja con la pantalla que tiene un formulario y no con `/corte`.
 *
 * `jitless`: zod v4 prueba `new Function('')` para compilar los esquemas. La CSP del portal no
 * permite `unsafe-eval` (`server/utils/cabecerasSeguridad.ts`), así que esa prueba generaba una
 * violación de CSP en cada página con formulario. Sin JIT los esquemas validan igual.
 */
z.config({ jitless: true })

export { z }
