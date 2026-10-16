import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import {
    API_CAIDA_FIXTURE,
    fijarCuentaFixture,
    fijarEmpresaFixture,
    fijarFallaFixture,
    fijarPagoFixture,
    fijarSesionFixture,
    limpiarFallasFixture,
} from '~~/fixtures'
import { CUENTA_FIXTURE } from '~~/fixtures/cuenta'
import { EMPRESA_FIXTURE } from '~~/fixtures/empresa'
import { QUIEN_SOY_SUSPENDIDO } from '~~/fixtures/corte'
import EstadoEnVivo from '~/components/corte/EstadoEnVivo.vue'
import ResumenDeuda from '~/components/corte/ResumenDeuda.vue'
import PagoEnLinea from '~/components/pago/EnLinea.vue'
import PaginaCorte from '~/pages/corte.vue'
import PaginaCuenta from '~/pages/cuenta.vue'

/**
 * Piloto, tarea 2: qué ve el cliente cuando la API no responde, cuando su IP no se identifica y
 * cuando tiene varios servicios. Regla: error claro con "Reintentar", nunca montos ni estados
 * inventados.
 */

const { navegar, salir } = vi.hoisted(() => ({ navegar: vi.fn(), salir: vi.fn() }))
mockNuxtImport('navigateTo', () => navegar)
mockNuxtImport('salirALaPasarela', () => salir)

const montados: { unmount: () => void }[] = []

async function esperar() {
    for (let i = 0; i < 8; i += 1) {
        await flushPromises()
    }
}

async function montarCorte(fixture?: string) {
    window.history.replaceState({}, '', fixture ? `/corte?fixture=${fixture}` : '/corte')
    clearNuxtData('portal:quien-soy')
    clearNuxtData('portal:empresa')
    const wrapper = await mountSuspended(PaginaCorte)
    montados.push(wrapper)
    await esperar()
    return wrapper
}

async function montarCuenta() {
    clearNuxtData('portal:cuenta')
    const wrapper = await mountSuspended(PaginaCuenta)
    montados.push(wrapper)
    await esperar()
    return wrapper
}

type Envoltorio = Awaited<ReturnType<typeof montarCorte>>

function boton(wrapper: Envoltorio, etiqueta: string) {
    return wrapper.findAll('button, a').find(b => b.text().includes(etiqueta))
}

/** Montos en quetzales visibles en la página. */
function montos(wrapper: Envoltorio): string[] {
    return wrapper.text().match(/Q\s?[\d,]+\.\d{2}/g) ?? []
}

afterEach(() => {
    for (const wrapper of montados.splice(0)) {
        wrapper.unmount()
    }
    limpiarFallasFixture()
    fijarEmpresaFixture(EMPRESA_FIXTURE)
    fijarCuentaFixture(null)
    fijarSesionFixture(false)
    fijarPagoFixture(null)
    navegar.mockReset()
    salir.mockReset()
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
})

describe('/corte cuando la API no responde', () => {
    it('sin conexión: error con Reintentar, sin montos ni estado; depósito y contacto siguen a mano', async () => {
        fijarFallaFixture('GET /api/v1/portal/quien-soy', 'sin_conexion')
        const wrapper = await montarCorte()
        const error = wrapper.find('[data-testid="corte-error"]')
        expect(error.exists()).toBe(true)
        expect(error.text()).toContain('No pudimos consultar tu servicio')
        expect(error.text()).toContain('Revisa tu conexión')
        expect(boton(wrapper, 'Reintentar')).toBeDefined()

        expect(montos(wrapper)).toEqual([])
        expect(wrapper.find('[data-testid="monto-adeudado"]').exists()).toBe(false)
        expect(wrapper.text()).not.toMatch(/suspendido|activo|Al día|Sin facturas vencidas/i)
        for (const accion of ['Pagar en línea', 'Subir comprobante', 'Solicitar promesa']) {
            expect(boton(wrapper, accion), accion).toBeUndefined()
        }
        expect(boton(wrapper, 'Ver datos de depósito')).toBeDefined()
        expect(boton(wrapper, 'Llamar a soporte')).toBeDefined()

        // Reintentar con la API de vuelta muestra el estado real.
        limpiarFallasFixture()
        await boton(wrapper, 'Reintentar')!.trigger('click')
        await esperar()
        expect(wrapper.find('[data-testid="corte-error"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="monto-adeudado"]').text()).toBe('Q 525.00')
    })

    it('API caída (502 del proxy): el detalle en español, no "Error inesperado"', async () => {
        fijarFallaFixture('GET /api/v1/portal/quien-soy', API_CAIDA_FIXTURE)
        const wrapper = await montarCorte()
        const error = wrapper.find('[data-testid="corte-error"]')
        expect(error.text()).toContain('No pudimos contactar al sistema')
        expect(error.text()).not.toContain('Error inesperado')
        expect(montos(wrapper)).toEqual([])
    })

    it('un 502 que no es problem+json (p. ej. HTML de otro proxy) también se explica', async () => {
        fijarFallaFixture('GET /api/v1/portal/quien-soy', { status: 502, cuerpo: '<html>Bad Gateway</html>', contentType: 'text/html' })
        const wrapper = await montarCorte()
        expect(wrapper.find('[data-testid="corte-error"]').text()).toContain('No pudimos contactar al sistema')
    })

    it('límite de consultas (429): dice que espere, no que revise su conexión', async () => {
        fijarFallaFixture('GET /api/v1/portal/quien-soy', {
            status: 429,
            cuerpo: {
                type: 'urn:argosisp:problema:demasiadas_peticiones',
                title: 'Demasiadas peticiones',
                status: 429,
                detail: 'Superaste el límite de consultas desde tu conexión; intenta de nuevo en 42 s',
            },
        })
        const wrapper = await montarCorte()
        const error = wrapper.find('[data-testid="corte-error"]').text()
        expect(error).toContain('intenta de nuevo en 42 s')
        expect(error).not.toContain('Revisa tu conexión')
    })

    it('empresa también caída: sin botón de llamar con un teléfono inventado, va a /contacto', async () => {
        fijarFallaFixture('GET /api/v1/portal/quien-soy', API_CAIDA_FIXTURE)
        fijarEmpresaFixture(null)
        const wrapper = await montarCorte()
        expect(boton(wrapper, 'Llamar a soporte')).toBeUndefined()
        expect(boton(wrapper, 'Contacta a soporte')?.attributes('href')).toBe('/contacto')
    })
})

describe('/corte con una IP que no se identifica', () => {
    it('sin montos ni acciones de un servicio: entrar con NIT o usuario, depósito y contacto', async () => {
        const wrapper = await montarCorte('desconocido')
        expect(wrapper.text()).toContain('No pudimos identificar tu servicio')
        expect(wrapper.find('[data-testid="monto-adeudado"]').exists()).toBe(false)
        expect(montos(wrapper)).toEqual([])

        // Pagar, subir comprobante o prometer necesitan saber el servicio: por IP la API dice 422.
        for (const accion of ['Pagar en línea', 'Subir comprobante', 'Solicitar promesa', 'Ver mis facturas']) {
            expect(boton(wrapper, accion), accion).toBeUndefined()
        }
        const entrar = boton(wrapper, 'Entrar con mi NIT o usuario')
        expect(entrar?.attributes('href')).toBe('/entrar')
        expect(boton(wrapper, 'Ver datos de depósito')).toBeDefined()
        expect(boton(wrapper, 'Llamar a soporte')).toBeDefined()
        expect(wrapper.text()).toContain('Conexión desde 203.0.113.9')
        // Sin servicio no hay estado en vivo que esperar.
        expect(wrapper.find('[data-testid="estado-en-vivo"]').exists()).toBe(false)
    })
})

describe('resumen de la deuda sin datos', () => {
    it('monto o vencidas nulos: "No disponible" y nunca "Q 0.00" ni "Sin facturas vencidas"', async () => {
        const wrapper = await mountSuspended(ResumenDeuda, {
            props: { corte: { ...QUIEN_SOY_SUSPENDIDO, monto_adeudado: null, facturas_vencidas: null } },
        })
        montados.push(wrapper)
        expect(wrapper.find('[data-testid="monto-adeudado"]').text()).toBe('No disponible')
        expect(wrapper.text()).not.toContain('Q 0.00')
        expect(wrapper.text()).not.toContain('Sin facturas vencidas')
    })
})

describe('estado en vivo cuando /portal/estado no responde', () => {
    async function montarVigilancia() {
        let estado!: ReturnType<typeof useEstadoServicio>
        const Prueba = defineComponent({
            setup() {
                estado = useEstadoServicio({ intervaloMs: 10, duracionMs: 80 })
                return () => h('div')
            },
        })
        montados.push(await mountSuspended(Prueba))
        return estado
    }

    async function esperarHasta(condicion: () => boolean) {
        const fin = Date.now() + 2_000
        while (!condicion()) {
            if (Date.now() > fin) {
                throw new Error('La condición no se cumplió a tiempo')
            }
            await new Promise(resolve => setTimeout(resolve, 5))
        }
    }

    it('sin conexión o API caída: sigue intentando, avisa y al agotarse no afirma nada del servicio', async () => {
        for (const falla of ['sin_conexion', API_CAIDA_FIXTURE] as const) {
            fijarFallaFixture('GET /api/v1/portal/estado', falla)
            const estado = await montarVigilancia()
            estado.vigilar()
            await esperarHasta(() => estado.sinRespuesta.value)
            expect(estado.vigilando.value).toBe(true)
            await esperarHasta(() => estado.agotado.value)
            expect(estado.sinRespuesta.value).toBe(true)
            expect(estado.ultimo.value).toBeNull()
            expect(estado.activo.value).toBe(false)

            // Vuelve la API: "Reintentar" reinicia el contador de fallos.
            limpiarFallasFixture()
            estado.vigilar()
            await esperarHasta(() => !estado.vigilando.value)
            expect(estado.sinRespuesta.value).toBe(false)
            expect(estado.ultimo.value).not.toBeNull()
        }
    })

    it('el aviso dice que no se pudo consultar, nunca "Aún no vemos tu servicio activo"', async () => {
        const conFallas = await mountSuspended(EstadoEnVivo, { props: { agotado: true, sinRespuesta: true } })
        montados.push(conFallas)
        expect(conFallas.find('[data-testid="estado-sin-respuesta-agotado"]').text()).toContain('No pudimos consultar el estado')
        expect(conFallas.text()).not.toContain('Aún no vemos')
        expect(conFallas.text()).toContain('Reintentar')

        const pagoSinRespuesta = await mountSuspended(EstadoEnVivo, { props: { agotado: true, sinRespuesta: true, pagoEnCurso: true } })
        montados.push(pagoSinRespuesta)
        expect(pagoSinRespuesta.text()).not.toContain('Aún no recibimos la confirmación')

        const vigilando = await mountSuspended(EstadoEnVivo, { props: { vigilando: true, sinRespuesta: true } })
        montados.push(vigilando)
        expect(vigilando.find('[data-testid="estado-sin-respuesta"]').text()).toContain('Seguimos intentando')
    })
})

describe('promesa, comprobante y pago con la API caída', () => {
    it('pagar en línea con 502: error claro, no sale a la pasarela y el botón sigue disponible', async () => {
        fijarFallaFixture('POST /api/v1/portal/pagos/iniciar', API_CAIDA_FIXTURE)
        clearNuxtData('portal:empresa')
        const wrapper = await mountSuspended(PagoEnLinea)
        montados.push(wrapper)
        await esperar()
        await wrapper.find('[data-testid="pagar-en-linea"]').trigger('click')
        await esperar()
        expect(wrapper.find('[data-testid="pagar-en-linea-error"]').text()).toContain('No pudimos contactar al sistema')
        expect(salir).not.toHaveBeenCalled()
        expect(wrapper.find('[data-testid="pagar-en-linea"]').attributes('disabled')).toBeUndefined()
    })
})

describe('/cuenta cuando la API no responde', () => {
    it('cuenta caída: error con Reintentar y ningún saldo', async () => {
        fijarSesionFixture(true)
        fijarFallaFixture('GET /api/v1/portal/cuenta', API_CAIDA_FIXTURE)
        const wrapper = await montarCuenta()
        expect(wrapper.text()).toContain('No pudimos cargar tu cuenta')
        expect(wrapper.text()).toContain('No pudimos contactar al sistema')
        expect(boton(wrapper, 'Reintentar')).toBeDefined()
        expect(wrapper.find('[data-testid="saldo-cuenta"]').exists()).toBe(false)
        expect(montos(wrapper)).toEqual([])
        expect(navegar).not.toHaveBeenCalled()
    })
})

describe('/cuenta con varios servicios', () => {
    const DOS_SERVICIOS = {
        ...CUENTA_FIXTURE,
        servicios: [
            { ...CUENTA_FIXTURE.servicios[0]!, id: 41, estado: 'activo' as const, plan: 'Hogar 20 Mbps', direccion: 'Casa', monto_adeudado: '175.00' },
            { ...CUENTA_FIXTURE.servicios[0]!, id: 52, estado: 'suspendido' as const, plan: 'Negocio 50 Mbps', direccion: 'Tienda', monto_adeudado: '375.00' },
            { ...CUENTA_FIXTURE.servicios[0]!, id: 63, estado: 'activo' as const, plan: 'Hogar 10 Mbps', direccion: 'Finca', monto_adeudado: '0.00' },
        ],
        monto_adeudado: '550.00',
    }

    it('saldo por servicio, promesa solo donde aplica y se elige qué servicio pagar en línea', async () => {
        fijarSesionFixture(true)
        fijarCuentaFixture(DOS_SERVICIOS)
        const post = vi.spyOn(useApi(), 'POST')
        const wrapper = await montarCuenta()

        expect(wrapper.find('[data-testid="saldo-cuenta"]').text()).toBe('Q 550.00')
        expect(wrapper.findAll('[data-testid="saldo-servicio"]').map(s => s.text())).toEqual(['Q 175.00', 'Q 375.00', 'Q 0.00'])
        // Sin saldo no se ofrece promesa.
        expect(wrapper.findAll('[data-testid="pedir-promesa"]')).toHaveLength(2)

        // Solo los servicios con saldo se pueden elegir para pagar; por defecto el primero.
        const selector = wrapper.findComponent({ name: 'USelect' })
        expect(selector.exists()).toBe(true)
        const opciones = selector.props('items') as { label: string, value: number }[]
        expect(opciones.map(o => o.value)).toEqual([41, 52])
        expect(opciones[1]!.label).toContain('Q 375.00')

        selector.vm.$emit('update:modelValue', 52)
        await esperar()
        await wrapper.find('[data-testid="pagar-en-linea"]').trigger('click')
        await esperar()
        const llamadas = post.mock.calls as unknown as [string, { body?: unknown }][]
        const llamada = llamadas.find(([ruta]) => ruta === '/api/v1/portal/pagos/iniciar')
        expect(llamada?.[1]).toMatchObject({ body: { servicio_id: 52 } })
    })

    it('un solo servicio: sin selector', async () => {
        fijarSesionFixture(true)
        const wrapper = await montarCuenta()
        expect(wrapper.findComponent({ name: 'USelect' }).exists()).toBe(false)
        expect(wrapper.find('[data-testid="pagar-en-linea"]').exists()).toBe(true)
    })
})
