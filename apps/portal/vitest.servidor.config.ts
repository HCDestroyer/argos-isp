import { defineConfig } from 'vitest/config'

/**
 * Pruebas contra el servidor Nitro de producción (`@nuxt/test-utils/e2e`: compila el portal en
 * `.nuxt/test/<id>` y lo levanta con `node <salida>/server/index.mjs`). Van aparte de
 * `vitest.config.ts` porque el entorno `nuxt` (happy-dom) no sirve para pruebas de servidor.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/servidor/**/*.test.ts'],
        // Compilar el portal tarda ~30 s (más en CI con varias apps en paralelo).
        hookTimeout: 240_000,
        testTimeout: 30_000,
        fileParallelism: false,
    },
})
