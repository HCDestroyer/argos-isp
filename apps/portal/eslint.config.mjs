// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
    rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        'vue/no-restricted-html-elements': ['error', 'button', 'input', 'select', 'textarea', 'table'],
    },
})
