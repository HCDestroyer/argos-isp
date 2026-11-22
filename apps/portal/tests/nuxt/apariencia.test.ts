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

const PUBLICA_ESMERALDA = {
    tema: 'esmeralda',
    paleta: { color: 'emerald', claro: '#047857', oscuro: '#34D399' },
    modo_predeterminado: 'oscuro',
    nombre_marca: 'ArgosIsp',
    eslogan: null,
    logo_login_url: null,
    fondo_login_url: null,
    version: 2,
}

describe('normalizarApariencia (contrato §3)', () => {
    it('tema con su paleta resuelta por la API', () => {
        expect(normalizarApariencia(PUBLICA_ESMERALDA)).toMatchObject({ preset: 'esmeralda', color: 'emerald', primarioClaro: '#047857', primarioOscuro: '#34d399', modo: 'oscuro' })
        expect(normalizarApariencia({ ...PUBLICA_ESMERALDA, tema: 'rosa', paleta: { color: 'pink', claro: '#BE185D', oscuro: '#F472B6' } }).color).toBe('pink')
    })

    it('lo raro cae a lo de fábrica, campo por campo', () => {
        expect(normalizarApariencia(null)).toEqual(APARIENCIA_DE_FABRICA)
        expect(normalizarApariencia({ tema: 'fucsia' })).toMatchObject({ preset: 'indigo', color: 'indigo' })
        // una paleta que no es la del tema, o con hex raros, no entra al CSS
        expect(normalizarApariencia({ ...PUBLICA_ESMERALDA, paleta: { color: 'red', claro: '#ff0000', oscuro: '#ff0000' } }).primarioClaro).toBeNull()
        expect(normalizarApariencia({ ...PUBLICA_ESMERALDA, paleta: { color: 'emerald', claro: 'red; background:url(x)', oscuro: '#34D399' } }).primarioClaro).toBeNull()
        expect(normalizarApariencia({ modo_predeterminado: 'noche' }).modo).toBe('sistema')
        expect(normalizarApariencia({ eslogan: '   ' }).eslogan).toBeNull()
    })

    it('fondo del login: solo un archivo de apariencia (§7), servido en el mismo origen', () => {
        expect(urlImagenSegura('/api/v1/apariencia/archivos/fondo-login-3f2a9c1d0b7e4a55.webp')).toBe('/api/v1/apariencia/archivos/fondo-login-3f2a9c1d0b7e4a55.webp')
        expect(urlImagenSegura('/api/v1/apariencia/archivos/../../portal/cuenta')).toBeNull()
        expect(urlImagenSegura('/api/v1/apariencia/archivos/fondo-login-3f2a.webp")')).toBeNull()
        expect(urlImagenSegura('https://cdn.example.com/fondo.jpg')).toBeNull()
        expect(urlImagenSegura('/fondo.jpg')).toBeNull()
    })
})

describe('variablesTema', () => {
    it('los hex de la paleta de la API', () => {
        const estilo = variablesTema(normalizarApariencia(PUBLICA_ESMERALDA))
        expect(estilo).toContain('--ax-primario-claro: #047857')
        expect(estilo).toContain('--ax-primario-oscuro: #34d399')
        expect(estilo).toContain('--ax-primario-hover: var(--ui-color-primary-800)')
    })

    it('sin paleta válida: el tono AA del catálogo (700 en esmeralda, naranja y rosa; 600 el resto)', () => {
        expect(variablesTema(normalizarApariencia({ tema: 'indigo' }))).toContain('--ax-primario-claro: var(--ui-color-primary-600)')
        expect(variablesTema(normalizarApariencia({ tema: 'rosa' }))).toContain('--ax-primario-claro: var(--ui-color-primary-700)')
        expect(variablesTema(normalizarApariencia({ tema: 'naranja' }))).toContain('--ax-primario-oscuro: var(--ui-color-primary-400)')
    })

    it('el catálogo tiene los siete temas del contrato', () => {
        expect(Object.keys(PALETAS_TEMA).sort()).toEqual([...PRESETS_TEMA].sort())
    })
})

describe('panel del login', () => {
    it('sin apariencia: la frase y el fondo de fábrica', async () => {
        const wrapper = await mountSuspended(Acceso, { props: { titulo: 'Entrar', descripcion: 'x' } })
        expect(wrapper.find('[data-testid="acceso-eslogan"]').text()).toBe('Tu servicio, tus facturas y tus pagos en un solo lugar.')
        expect(wrapper.find('[data-testid="acceso-panel"]').attributes('style') ?? '').not.toContain('url(')
    })

    it('con eslogan y fondo del admin', async () => {
        useApariencia().value = normalizarApariencia({ ...PUBLICA_ESMERALDA, eslogan: 'Conectados contigo', fondo_login_url: '/api/v1/apariencia/archivos/fondo-login-3f2a9c1d0b7e4a55.webp' })
        const wrapper = await mountSuspended(Acceso, { props: { titulo: 'Entrar', descripcion: 'x' } })
        expect(wrapper.find('[data-testid="acceso-eslogan"]').text()).toBe('Conectados contigo')
        expect(wrapper.find('[data-testid="acceso-panel"]').attributes('style')).toContain('url("/api/v1/apariencia/archivos/fondo-login-3f2a9c1d0b7e4a55.webp")')
    })
})
