import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fijarContrasenaFixture, fijarSesionFixture } from '~~/fixtures'
import { CONTRASENA_DEFECTO_FIXTURE, CONTRASENA_PROPIA_FIXTURE } from '~~/fixtures/cuenta'
import PaginaEntrar from '~/pages/entrar.vue'
import PaginaCambiar from '~/pages/cambiar-contrasena.vue'
import PaginaCorte from '~/pages/corte.vue'
import PaginaCuenta from '~/pages/cuenta.vue'

/**
 * Entrada con documento y contraseña, cambio obligatorio de la contraseña por defecto y «Ver mi
 * cuenta» desde /corte, contra los fixtures del portal.
 */

const { navegar } = vi.hoisted(() => ({ navegar: vi.fn() }))

mockNuxtImport('navigateTo', () => navegar)

async function esperar() {
    for (let i = 0; i < 4; i++) {
        await flushPromises()
    }
}

async function montarEntrar(ruta = '/entrar') {
    window.history.replaceState({}, '', ruta)
    const wrapper = await mountSuspended(PaginaEntrar, { route: ruta })
    await esperar()
    return wrapper
}

async function escribirCredenciales(wrapper: Awaited<ReturnType<typeof montarEntrar>>, documento: string, contrasena: string) {
    await wrapper.find('[data-testid="campo-documento"] input, input[data-testid="campo-documento"]').setValue(documento)
    await wrapper.find('[data-testid="campo-contrasena"] input, input[data-testid="campo-contrasena"]').setValue(contrasena)
    await wrapper.find('[data-testid="form-contrasena"]').trigger('submit')
    await esperar()
}

afterEach(() => {
    fijarSesionFixture(false)
    navegar.mockReset()
    window.history.replaceState({}, '', '/')
    localStorage.clear()
    useSesionPortal().cerrar()
})

describe('/entrar con documento y contraseña', () => {
    it('por defecto muestra la pestaña de documento y contraseña; ?con=codigo la del código', async () => {
        const wrapper = await montarEntrar()
        expect(wrapper.find('[data-testid="form-contrasena"]').exists()).toBe(true)
        const codigo = await montarEntrar('/entrar?con=codigo')
        expect(codigo.find('[data-testid="form-contrasena"]').exists()).toBe(false)
        expect(codigo.text()).toContain('NIT, CUI o usuario de conexión')
        const porIp = await montarEntrar('/entrar?por_ip=1')
        expect(porIp.text()).toContain('Enviarme el código')
    })

    it('con su contraseña propia entra a /cuenta (el documento con guion y minúsculas sirve)', async () => {
        const wrapper = await montarEntrar()
        await escribirCredenciales(wrapper, '1234567-9', CONTRASENA_PROPIA_FIXTURE)
        expect(navegar).toHaveBeenCalledWith('/cuenta')
        expect(useSesionPortal().activa.value).toBe(true)
    })

    it('con la de la empresa va a /cambiar-contrasena', async () => {
        fijarContrasenaFixture(null)
        const wrapper = await montarEntrar()
        await escribirCredenciales(wrapper, '12345679', CONTRASENA_DEFECTO_FIXTURE)
        expect(navegar).toHaveBeenCalledWith('/cambiar-contrasena')
    })

    it('datos incorrectos: mensaje genérico, borra la contraseña y no navega', async () => {
        const wrapper = await montarEntrar()
        await escribirCredenciales(wrapper, '12345679', 'equivocada')
        expect(wrapper.find('[data-testid="error-acceso"]').text()).toContain('El documento o la contraseña no son correctos')
        expect(navegar).not.toHaveBeenCalled()
        const campo = wrapper.find('[data-testid="campo-contrasena"] input, input[data-testid="campo-contrasena"]')
        expect((campo.element as HTMLInputElement).value).toBe('')
    })

    it('la contraseña se ve solo al pedirlo', async () => {
        const wrapper = await montarEntrar()
        const campo = () => wrapper.find('[data-testid="campo-contrasena"] input, input[data-testid="campo-contrasena"]')
        expect(campo().attributes('type')).toBe('password')
        await wrapper.find('[aria-label="Mostrar contraseña"]').trigger('click')
        expect(campo().attributes('type')).toBe('text')
    })
})

describe('/cambiar-contrasena', () => {
    async function montarCambiar() {
        const wrapper = await mountSuspended(PaginaCambiar, { route: '/cambiar-contrasena' })
        await esperar()
        return wrapper
    }

    async function llenar(wrapper: Awaited<ReturnType<typeof montarCambiar>>, actual: string, nueva: string, confirmacion = nueva) {
        const campo = (id: string) => wrapper.find(`[data-testid="${id}"] input, input[data-testid="${id}"]`)
        await campo('campo-actual').setValue(actual)
        await campo('campo-nueva').setValue(nueva)
        await campo('campo-confirmacion').setValue(confirmacion)
        await wrapper.find('[data-testid="form-cambiar-contrasena"]').trigger('submit')
        await esperar()
    }

    it('obligatoria tras entrar con la de la empresa: /cuenta lo trae aquí y al guardar vuelve', async () => {
        fijarContrasenaFixture(null)
        await useAccesoPortal().entrarConContrasena('12345679', CONTRASENA_DEFECTO_FIXTURE)

        // /cuenta responde 403 cambio_contrasena_requerido y manda a cambiarla.
        clearNuxtData('portal:cuenta')
        await mountSuspended(PaginaCuenta, { route: '/cuenta' })
        await esperar()
        expect(navegar).toHaveBeenCalledWith('/cambiar-contrasena')

        const wrapper = await montarCambiar()
        expect(wrapper.text()).toContain('Elige tu contraseña')
        expect(wrapper.text()).toContain('Contraseña que te dio la empresa')

        await llenar(wrapper, CONTRASENA_DEFECTO_FIXTURE, 'NuevaClave2026', 'OtraCosa2026')
        expect(wrapper.text()).toContain('Las dos contraseñas no coinciden')

        await llenar(wrapper, 'equivocada', 'NuevaClave2026')
        expect(wrapper.text()).toContain('La contraseña actual no es correcta')

        await llenar(wrapper, CONTRASENA_DEFECTO_FIXTURE, CONTRASENA_DEFECTO_FIXTURE)
        expect(wrapper.text()).toContain('distinta a la que te dio la empresa')

        await llenar(wrapper, CONTRASENA_DEFECTO_FIXTURE, 'NuevaClave2026')
        expect(navegar).toHaveBeenCalledWith({ path: '/cuenta', query: { contrasena: 'cambiada' } })
    })

    it('sin sesión manda a /entrar', async () => {
        await montarCambiar()
        expect(navegar).toHaveBeenCalledWith('/entrar')
    })
})

describe('«Ver mi cuenta» en /corte', () => {
    async function montarCorte(ruta = '/corte') {
        window.history.replaceState({}, '', ruta)
        clearNuxtData(clave => clave.startsWith('portal:'))
        const wrapper = await mountSuspended(PaginaCorte, { route: ruta })
        await esperar()
        return wrapper
    }

    it('identificado: abre la sesión sin pedir nada y va a /cuenta', async () => {
        const wrapper = await montarCorte()
        const boton = wrapper.find('[data-testid="ver-mi-cuenta"]')
        expect(boton.text()).toContain('Ver mi cuenta')
        await boton.trigger('click')
        await esperar()
        expect(navegar).toHaveBeenCalledWith('/cuenta')
        expect(useSesionPortal().activa.value).toBe(true)
    })

    it('sin identificar no aparece; ofrece entrar a la cuenta', async () => {
        const wrapper = await montarCorte('/corte?fixture=desconocido')
        expect(wrapper.find('[data-testid="ver-mi-cuenta"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="corte-no-identificado"]').text()).toContain('Entrar a mi cuenta')
    })
})
