import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import UApp from '@nuxt/ui/components/App.vue'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import EmpresaFormulario from '~/components/EmpresaFormulario.vue'
import PaginaEmpresas from '~/pages/configuracion/empresas.vue'
import { esperar } from '../ayudas/esperar'

/**
 * URL de corte por empresa (`core.empresas.url_corte`, PR #226 de A5): opcional, `http(s)://`,
 * se edita con `empresas.editar` y se ve en la lista de empresas.
 */
async function comoAdmin() {
    sesionFixture('fixture-admin')
    useUsuarioActual().value = meAdmin
    await flushPromises()
}

function conFormulario(empresaId: number) {
    const empresa = bd.empresas.find(e => e.id === empresaId) ?? null
    return defineComponent({ render: () => h(UApp, null, { default: () => h(EmpresaFormulario, { empresa, open: true }) }) })
}

function campoUrlCorte(): HTMLInputElement {
    const campo = document.body.querySelector<HTMLInputElement>('[data-prueba="url-corte"]')
    if (!campo) {
        throw new Error('Sin campo url_corte')
    }
    return campo
}

async function escribir(valor: string) {
    const campo = campoUrlCorte()
    campo.value = valor
    campo.dispatchEvent(new Event('input'))
    await flushPromises()
}

beforeEach(async () => {
    reiniciarFixtures()
    await comoAdmin()
})

afterEach(() => {
    sesionFixture(null)
    useUsuarioActual().value = null
    localStorage.clear()
})

describe('url de corte · esquema espejo de la API', () => {
    it('acepta vacío (null) y http(s) con dominio o IPv4; rechaza el resto', () => {
        const base = entradaEmpresaGrupo(bd.empresas[0])
        const salida = (url_corte: string) => esquemaEmpresaGrupo.safeParse({ ...base, url_corte })
        const vacio = salida('  ')
        expect(vacio.success && vacio.data.url_corte).toBeNull()
        const valida = salida(' https://argosnet.gt/corte?x=1 ')
        expect(valida.success && valida.data.url_corte).toBe('https://argosnet.gt/corte?x=1')
        expect(salida('http://192.168.88.10/aviso').success).toBe(true)
        for (const mala of ['argosnet.gt/corte', 'ftp://argosnet.gt', 'https://localhost/corte', 'https://argosnet', 'https://argos net.gt', 'https://300.1.1.1', `https://argosnet.gt/${'a'.repeat(500)}`]) {
            expect(salida(mala).success, mala).toBe(false)
        }
    })

    it('el formulario arranca con la URL guardada', () => {
        expect(entradaEmpresaGrupo({ ...bd.empresas[1]!, url_corte: 'https://fibradelsur.gt/corte' }).url_corte).toBe('https://fibradelsur.gt/corte')
        expect(entradaEmpresaGrupo(null).url_corte).toBe('')
    })
})

describe('url de corte · contra la API (fixtures)', () => {
    it('se guarda con la versión, se quita con null y una URL inválida es 422 en el campo', async () => {
        const empresas = useEmpresas()
        const fibra = bd.empresas.find(e => e.id === 2)!
        const guardada = await empresas.editar(2, { url_corte: 'https://fibradelsur.gt/corte', version: fibra.version })
        expect(guardada.ok && guardada.data.url_corte).toBe('https://fibradelsur.gt/corte')
        const quitada = await empresas.editar(2, { url_corte: null, version: fibra.version })
        expect(quitada.ok && quitada.data.url_corte).toBeNull()
        const mala = await empresas.editar(2, { url_corte: 'fibradelsur.gt', version: fibra.version })
        expect(mala.ok).toBe(false)
        if (!mala.ok) {
            expect(mala.problema.status).toBe(422)
            expect(erroresDeFormulario(mala.problema).map(e => e.name)).toEqual(['url_corte'])
        }
    })
})

describe('url de corte · pantallas', () => {
    it('formulario: campo opcional con su ayuda; la inválida no se envía y la válida se guarda', async () => {
        const vista = await mountSuspended(conFormulario(2))
        await esperar(() => expect(document.body.querySelector('[data-prueba="url-corte"]')).not.toBeNull())
        expect(document.body.textContent).toContain('URL de corte (opcional)')
        expect(document.body.textContent).toContain(AYUDA_URL_CORTE)
        const version = bd.empresas.find(e => e.id === 2)!.version

        await escribir('fibradelsur.gt/corte')
        document.body.querySelector('form')!.requestSubmit()
        await esperar(() => expect(document.body.textContent).toContain('Una dirección completa con http:// o https://'))
        expect(bd.empresas.find(e => e.id === 2)!.version).toBe(version)

        await escribir('https://fibradelsur.gt/corte')
        document.body.querySelector('form')!.requestSubmit()
        await esperar(() => expect(bd.empresas.find(e => e.id === 2)!.url_corte).toBe('https://fibradelsur.gt/corte'))
        expect(bd.empresas.find(e => e.id === 2)!.version).toBe(version + 1)
        vista.unmount()
    })

    it('lista de empresas: muestra la URL de corte, o que se usa la de Argos', async () => {
        bd.empresas[1]!.url_corte = 'https://fibradelsur.gt/corte'
        const vista = await mountSuspended(PaginaEmpresas, { route: '/configuracion/empresas' })
        await esperar(() => expect(vista.text()).toContain('Fibra del Sur'))
        expect(vista.text()).toContain('Página de corte')
        expect(vista.find('[data-prueba="url-corte-empresa"]').attributes('href')).toBe('https://fibradelsur.gt/corte')
        expect(vista.text()).toContain('Corte: https://fibradelsur.gt/corte')
        expect(vista.text()).toContain('La de Argos')
    })
})
