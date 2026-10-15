import { configApp } from '@adonisjs/eslint-config'

export default configApp(
    { ignores: ['build/**', 'tmp/**'] },
    {
        name: 'ArgosIsp',
        files: ['**/*.ts'],
        rules: {
            // El ancho lo decide prettier (.prettierrc.json de la raíz: 110).
            'max-len': 'off',
            // Permite `if (x) return y` en una línea.
            curly: ['error', 'multi-line'],
        },
    },
)
