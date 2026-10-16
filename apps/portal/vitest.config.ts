import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
    test: {
        environment: 'nuxt',
        include: ['tests/**/*.test.ts'],
        // Las de servidor real corren con vitest.servidor.config.ts (entorno node).
        exclude: ['tests/servidor/**', '**/node_modules/**'],
        // Montar el entorno Nuxt tarda más de 10 s cuando varias apps prueban en paralelo (pnpm -r test, CI).
        hookTimeout: 60_000,
        environmentOptions: {
            nuxt: {
                domEnvironment: 'happy-dom',
                // Las pruebas de composables corren contra apps/portal/fixtures, sin backend.
                overrides: {
                    runtimeConfig: {
                        public: {
                            useFixtures: true,
                        },
                    },
                },
            },
        },
    },
})
