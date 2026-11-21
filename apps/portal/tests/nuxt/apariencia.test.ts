import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import Acceso from '~/components/portal/Acceso.vue'

/**
 * Apariencia que elige el admin (`GET /api/v1/apariencia/publica`, A6): tema de color, modo por
 * defecto, eslogan y fondo del login. Todo se valida antes de llegar al CSS; si algo falla, índigo.
 */

afterEach(() => {
    useApariencia().value = APARIENCIA_DE_FABRICA
})

describe('normalizarApariencia', () => {
    it('preset por nombre o con sus hex validados', () => {
        expect(normalizarApariencia({ tema: 'esmeralda', modo_predeterminado: 'oscuro' })).toMatchObject({ preset: 'esmeralda', modo: 'oscuro', primarioClaro: null })
        expect(normalizarApariencia({ tema: { preset: 'azul', primario_claro: '#1D4ED8', primario_oscuro: '#60a5fa' } }))
            .toMatchObject({ preset: 'azul', primarioClaro: '#1d4ed8', primarioOscuro: '#60a5fa' })
    })

    it('lo raro cae a lo de fábrica, campo por campo', () => {
        expect(normalizarApariencia(null)).toEqual(APARIENCIA_DE_FABRICA)
        expect(normalizarApariencia({ tema: 'fucsia' }).preset).toBe('indigo')
        expect(normalizarApariencia({ tema: { preset: 'rosa', primario_claro: 'red; background:url(x)' } }).primarioClaro).toBeNull()
        expect(normalizarApariencia({ modo_predeterminado: 'noche' }).modo).toBe('sistema')
        expect(normalizarApariencia({ eslogan: '   ' }).eslogan).toBeNull()
    })

    it('fondo del login: solo rutas del mismo origen y sin caracteres que rompan `url()`', () => {
        expect(urlImagenSegura('/api/v1/portal/apariencia/fondo.webp')).toBe('/api/v1/portal/apariencia/fondo.webp')
        expect(urlImagenSegura('https://cdn.example.com/fondo.jpg')).toBeNull()
        expect(urlImagenSegura('//cdn.example.com/fondo.jpg')).toBeNull()
        expect(urlImagenSegura('/fondo.jpg") ; x')).toBeNull()
        expect(urlImagenSegura('javascript:alert(1)')).toBeNull()
    })
})

describe('variablesTema', () => {
    it('el tono AA de cada preset en claro (700 donde el 600 no llega) y el 400 en oscuro', () => {
        expect(variablesTema(normalizarApariencia({ tema: 'indigo' }))).toContain('--ax-primario-claro: var(--ui-color-primary-600)')
        expect(variablesTema(normalizarApariencia({ tema: 'esmeralda' }))).toContain('--ax-primario-claro: var(--ui-color-primary-700)')
        expect(variablesTema(normalizarApariencia({ tema: 'naranja' }))).toContain('--ax-primario-hover: var(--ui-color-primary-800)')
        expect(variablesTema(normalizarApariencia({ tema: 'rosa' }))).toContain('--ax-primario-oscuro: var(--ui-color-primary-400)')
    })

    it('con los hex del admin, esos', () => {
        const estilo = variablesTema(normalizarApariencia({ tema: { preset: 'azul', primario_claro: '#1d4ed8', primario_oscuro: '#93c5fd' } }))
        expect(estilo).toContain('--ax-primario-claro: #1d4ed8')
        expect(estilo).toContain('--ax-primario-oscuro: #93c5fd')
    })

    it('cada preset tiene su paleta de Tailwind', () => {
        for (const preset of PRESETS_TEMA) {
            expect(PALETAS_TEMA[preset].paleta).toMatch(/^[a-z]+$/)
        }
    })
})

describe('panel del login', () => {
    it('sin apariencia: la frase y el fondo de fábrica', async () => {
        const wrapper = await mountSuspended(Acceso, { props: { titulo: 'Entrar', descripcion: 'x' } })
        expect(wrapper.find('[data-testid="acceso-eslogan"]').text()).toBe('Tu servicio, tus facturas y tus pagos en un solo lugar.')
        expect(wrapper.find('[data-testid="acceso-panel"]').attributes('style') ?? '').not.toContain('url(')
    })

    it('con eslogan y fondo del admin', async () => {
        useApariencia().value = normalizarApariencia({ tema: 'violeta', eslogan: 'Conectados contigo', fondo_login_url: '/api/v1/portal/apariencia/fondo.webp' })
        const wrapper = await mountSuspended(Acceso, { props: { titulo: 'Entrar', descripcion: 'x' } })
        expect(wrapper.find('[data-testid="acceso-eslogan"]').text()).toBe('Conectados contigo')
        expect(wrapper.find('[data-testid="acceso-panel"]').attributes('style')).toContain('url("/api/v1/portal/apariencia/fondo.webp")')
    })
})
