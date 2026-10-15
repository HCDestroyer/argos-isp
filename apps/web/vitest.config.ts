import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
    test: {
        environment: 'nuxt',
        include: ['tests/**/*.test.ts'],
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
