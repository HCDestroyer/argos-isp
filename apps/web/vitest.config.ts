import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
    test: {
        environment: 'nuxt',
        include: ['tests/**/*.test.ts'],
        setupFiles: ['tests/setup.ts'],
        // Montar el entorno Nuxt tarda más de 10 s cuando varias apps prueban en paralelo (pnpm -r test, CI).
        hookTimeout: 60_000,
        // Con la máquina cargada (integrar.sh, CI con otras apps) una pantalla tarda más de los 5 s
        // por defecto; al vencerse, la prueba seguía corriendo encima de la siguiente.
        testTimeout: 30_000,
        environmentOptions: {
            nuxt: {
                domEnvironment: 'happy-dom',
                // Las pruebas de composables corren contra apps/web/fixtures, sin backend.
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
