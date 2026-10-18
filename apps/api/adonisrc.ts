import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({
    commands: [() => import('@adonisjs/core/commands'), () => import('@adonisjs/lucid/commands')],

    providers: [
        () => import('@adonisjs/core/providers/app_provider'),
        () => import('@adonisjs/core/providers/hash_provider'),
        {
            file: () => import('@adonisjs/core/providers/repl_provider'),
            environment: ['repl', 'test'],
        },
        () => import('@adonisjs/core/providers/vinejs_provider'),
        () => import('@adonisjs/cors/cors_provider'),
        () => import('@adonisjs/lucid/database_provider'),
        () => import('@adonisjs/auth/auth_provider'),
    ],

    preloads: [
        // primero: los validadores toman los mensajes al compilarse
        () => import('#start/validator'),
        () => import('#start/routes'),
        () => import('#start/kernel'),
        { file: () => import('#start/notify'), environment: ['web'] },
        { file: () => import('#start/integraciones'), environment: ['web'] },
    ],

    tests: {
        suites: [
            {
                files: ['tests/**/*.spec(.ts|.js)'],
                name: 'integracion',
                timeout: 30000,
            },
        ],
        forceExit: false,
    },

    metaFiles: [],
})
