import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
    test: {
        environment: 'nuxt',
        include: ['tests/**/*.test.ts'],
        // Las de servidor real corren con vitest.servidor.config.ts (entorno node).
        exclude: ['tests/servidor/**', '**/node_modules/**'],
        // Arranque en frío en un hook y desmontaje tras cada prueba: ver tests/nuxt/preparar.ts.
        setupFiles: ['tests/nuxt/preparar.ts'],
        // Montar el entorno Nuxt tarda más de 10 s cuando varias apps prueban en paralelo (pnpm -r test, CI).
        hookTimeout: 60_000,
        // Una prueba de página monta /cuenta o /corte completas (Nuxt UI, happy-dom): ~0,3 s de CPU
        // con la máquina libre, pero con la máquina sobrecargada (carga 18-25 en 4 núcleos, varias
        // apps y agentes probando a la vez) un solo montaje pasó de 5 s. Es CPU, no espera: los
        // ciclos con tiempo usan reloj falso y lo de cada archivo se prepara en tests/nuxt/preparar.ts.
        // El límite por defecto de 5 s mide la máquina, no el portal; 30 s, como vitest.servidor.
        testTimeout: 30_000,
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
