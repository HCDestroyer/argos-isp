import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, type Component } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import RouterAltaModal from '~/components/RouterAltaModal.vue'
import RouterConexionSeccion from '~/components/RouterConexionSeccion.vue'
import RouterEditarModal from '~/components/RouterEditarModal.vue'
import ServicioAltaFormulario from '~/components/ServicioAltaFormulario.vue'
import ServicioEditar from '~/components/ServicioEditar.vue'
import { UApp } from '#components'
import { esperar } from '../ayudas/esperar'

/** Dentro de `UApp` (el proveedor de tooltips del panel). */
function enApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

/**
 * Router sin RADIUS (`modo_seguridad = 'api'`, A1, rama `a1/router-sin-radius`): el alta y la edición
 * ocultan la IP del NAS y el secreto, la API acepta `nas_ip: null`, el 422 `servicios_pppoe_en_router`
 * se lista con enlaces, el alta y la edición de servicios no ofrecen PPPoE y el script de conexión
 * queda deshabilitado.
 */

/** Un router sin RADIUS como lo devuelve la API: `nas_ip: null` y sin secreto. */
function routerSinRadius(id: number, cambios: Partial<Schema<'Router'>> = {}): Schema<'Router'> {
    const base = structuredClone(bd.routers[0]!)
    return {
        ...base,
        id,
        nombre: 'RB-Norte',
        host: '10.40.0.1',
        api_url: null,
        nas_ip: null,
        modo_seguridad: 'api',
        tiene_radius_secret: false,
        serial: null,
        unido_a_id: null,
        activo: true,
        version: 1,
        ...cambios,
    }
}

function escribir(selector: string, valor: string) {
    const campo = document.body.querySelector<HTMLInputElement>(selector)
    expect(campo, selector).not.toBeNull()
    campo!.value = valor
    campo!.dispatchEvent(new Event('input', { bubbles: true }))
}

/** La opción de un `URadioGroup` (botón `role="radio"` con su `value`), en el documento o en `raiz`. */
function radio(contenedor: string, valor: string | number, raiz: ParentNode = document.body): HTMLElement | null {
    return raiz.querySelector<HTMLElement>(`${contenedor} [role="radio"][value="${valor}"], ${contenedor} button[value="${valor}"]`)
}

function elegir(contenedor: string, valor: string | number, raiz: ParentNode = document.body) {
    const opcion = radio(contenedor, valor, raiz)
    expect(opcion, `${contenedor} = ${valor}`).not.toBeNull()
    opcion!.click()
}

describe('router sin RADIUS', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    describe('alta (RouterAltaModal)', () => {
        it('el modo va arriba; «Sin RADIUS» oculta la IP del NAS y el secreto y crea el router con nas_ip null', async () => {
            const wrapper = await mountSuspended(RouterAltaModal, { props: { open: true } })
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-modo"]')).not.toBeNull())
            const formulario = document.body.querySelector('#form-router')!
            // El modo es el primer campo, con las dos opciones del PM.
            expect(formulario.querySelector('[data-prueba]')?.getAttribute('data-prueba')).toBe('router-modo')
            expect(formulario.textContent).toContain('RADIUS (recomendado)')
            expect(formulario.textContent).toContain('Sin RADIUS (solo API: IP estática y DHCP fija)')
            expect(formulario.querySelector('[data-prueba="router-nas"]')).not.toBeNull()
            expect(formulario.textContent).toContain('Secreto RADIUS')

            elegir('[data-prueba="router-modo"]', 'api')
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-nas"]')).toBeNull())
            expect(document.body.querySelector('#form-router')!.textContent).not.toContain('Secreto RADIUS')

            escribir('[data-prueba="router-nombre"] input, input[data-prueba="router-nombre"]', 'RB-Norte')
            escribir('[data-prueba="router-host"] input, input[data-prueba="router-host"]', '10.40.0.1')
            const antes = bd.routers.length
            document.body.querySelector<HTMLButtonElement>('[data-prueba="router-guardar"]')!.click()
            await esperar(() => expect(bd.routers).toHaveLength(antes + 1))
            const creado = bd.routers.at(-1)!
            expect(creado.modo_seguridad).toBe('api')
            expect(creado.nas_ip).toBeNull()
            expect(creado.tiene_radius_secret).toBe(false)
            // Sin RADIUS no se mandan la IP del NAS ni el secreto.
            const entrada = bd.acciones.find(b => b.accion === 'routers.crear' && b.entidad_id === creado.id)?.entrada as Record<string, unknown> | undefined
            expect(entrada && 'nas_ip' in entrada).toBe(false)
            await esperar(() => expect(wrapper.emitted('creado')).toHaveLength(1))
        })

        it('con RADIUS la IP del NAS es obligatoria y el mensaje dice cómo evitarla', async () => {
            await mountSuspended(RouterAltaModal, { props: { open: true } })
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-nas"]')).not.toBeNull())
            escribir('[data-prueba="router-nombre"] input, input[data-prueba="router-nombre"]', 'RB-Sur')
            escribir('[data-prueba="router-host"] input, input[data-prueba="router-host"]', '10.50.0.1')
            const antes = bd.routers.length
            document.body.querySelector<HTMLButtonElement>('[data-prueba="router-guardar"]')!.click()
            await esperar(() => expect(document.body.querySelector('#form-router')!.textContent).toContain('La IP del NAS es obligatoria con RADIUS'))
            expect(document.body.querySelector('#form-router')!.textContent).toContain('elige «Sin RADIUS»')
            expect(bd.routers).toHaveLength(antes)
        })
    })

    describe('edición (RouterEditarModal)', () => {
        it('pasar a «Sin RADIUS» con servicios PPPoE muestra el total y enlaza cada servicio', async () => {
            const router = structuredClone(bd.routers[0]!)
            const pppoe = bd.servicios.filter(s => s.router_id === router.id && (s.tipo_conexion ?? 'pppoe') === 'pppoe' && s.estado !== 'retirado')
            expect(pppoe.length).toBeGreaterThan(0)
            await mountSuspended(RouterEditarModal, { props: { router, open: true } })
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-editar-modo"]')).not.toBeNull())
            expect(document.body.querySelector('[data-prueba="router-editar-nas"]')).not.toBeNull()

            elegir('[data-prueba="router-editar-modo"]', 'api')
            await esperar(() => expect(document.body.querySelector('[data-prueba="aviso-sin-radius"]')).not.toBeNull())
            expect(document.body.querySelector('[data-prueba="router-editar-nas"]')).toBeNull()
            // La IP guardada se conserva salvo que se decida quitarla.
            expect(document.body.querySelector('[data-prueba="quitar-nas-ip"]')).not.toBeNull()

            document.body.querySelector<HTMLButtonElement>('[data-prueba="router-editar-guardar"]')!.click()
            const alerta = await esperar(() => {
                const elemento = document.body.querySelector('[data-prueba="router-pppoe-en-router"]')
                expect(elemento).not.toBeNull()
                return elemento!
            })
            const titulo = pppoe.length === 1 ? 'Hay 1 servicio PPPoE en este router' : `Hay ${pppoe.length} servicios PPPoE en este router`
            expect(alerta.textContent).toContain(titulo)
            const enlaces = [...alerta.querySelectorAll('a')].map(a => a.getAttribute('href'))
            expect(enlaces).toEqual(pppoe.slice(0, 50).sort((a, b) => a.id - b.id).map(s => `/servicios/${s.id}`))
            expect(bd.routers[0]!.modo_seguridad).toBe('radius')
        })

        it('sin PPPoE pasa a «Sin RADIUS»; la IP del NAS se conserva o se quita según lo que se decida', async () => {
            const conserva = { ...routerSinRadius(91, { nombre: 'RB-Conserva', host: '10.41.0.1' }), nas_ip: '10.41.0.1', modo_seguridad: 'radius' as const }
            bd.routers.push(conserva)

            await mountSuspended(RouterEditarModal, { props: { router: structuredClone(conserva), open: true } })
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-editar-modo"]')).not.toBeNull())
            elegir('[data-prueba="router-editar-modo"]', 'api')
            await esperar(() => expect(document.body.querySelector('[data-prueba="quitar-nas-ip"]')).not.toBeNull())
            document.body.querySelector<HTMLButtonElement>('[data-prueba="router-editar-guardar"]')!.click()
            await esperar(() => expect(bd.routers.find(r => r.id === 91)!.modo_seguridad).toBe('api'))
            expect(bd.routers.find(r => r.id === 91)!.nas_ip).toBe('10.41.0.1')
        })

        it('marcar «Quitar la IP del NAS» manda nas_ip null', async () => {
            const quita = { ...routerSinRadius(92, { nombre: 'RB-Quita', host: '10.42.0.1' }), nas_ip: '10.42.0.1', modo_seguridad: 'radius' as const }
            bd.routers.push(quita)
            await mountSuspended(RouterEditarModal, { props: { router: structuredClone(quita), open: true } })
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-editar-modo"]')).not.toBeNull())
            elegir('[data-prueba="router-editar-modo"]', 'api')
            await esperar(() => expect(document.body.querySelector('[data-prueba="quitar-nas-ip"]')).not.toBeNull())
            document.body.querySelector<HTMLElement>('[data-prueba="quitar-nas-ip"] button, button[data-prueba="quitar-nas-ip"], [data-prueba="quitar-nas-ip"] [role="checkbox"]')!.click()
            await esperar(() => expect(document.body.textContent).toContain('Se quitará la IP del NAS (10.42.0.1) al guardar.'))
            document.body.querySelector<HTMLButtonElement>('[data-prueba="router-editar-guardar"]')!.click()
            await esperar(() => expect(bd.routers.find(r => r.id === 92)!.modo_seguridad).toBe('api'))
            expect(bd.routers.find(r => r.id === 92)!.nas_ip).toBeNull()
        })

        it('un router sin RADIUS no muestra la IP del NAS; volver a RADIUS la exige', async () => {
            const router = routerSinRadius(93)
            bd.routers.push(router)
            await mountSuspended(RouterEditarModal, { props: { router: structuredClone(router), open: true } })
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-editar-modo"]')).not.toBeNull())
            expect(document.body.querySelector('[data-prueba="router-editar-nas"]')).toBeNull()
            // Sin IP guardada no hay nada que quitar.
            expect(document.body.querySelector('[data-prueba="quitar-nas-ip"]')).toBeNull()

            elegir('[data-prueba="router-editar-modo"]', 'radius')
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-editar-nas"]')).not.toBeNull())
            document.body.querySelector<HTMLButtonElement>('[data-prueba="router-editar-guardar"]')!.click()
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-editar"]')!.textContent).toContain('La IP del NAS es obligatoria con RADIUS'))
            expect(bd.routers.find(r => r.id === 93)!.modo_seguridad).toBe('api')

            escribir('[data-prueba="router-editar-nas"] input, input[data-prueba="router-editar-nas"]', '10.40.0.1')
            document.body.querySelector<HTMLButtonElement>('[data-prueba="router-editar-guardar"]')!.click()
            await esperar(() => expect(bd.routers.find(r => r.id === 93)!.modo_seguridad).toBe('radius'))
            expect(bd.routers.find(r => r.id === 93)!.nas_ip).toBe('10.40.0.1')
        })
    })

    describe('script de conexión (RouterConexionSeccion)', () => {
        it('deshabilitado con su motivo en un router sin RADIUS; la API responde 422 script_requiere_radius', async () => {
            const router = routerSinRadius(94)
            bd.routers.push(router)
            const wrapper = await mountSuspended(enApp(RouterConexionSeccion, { router }))
            await esperar(() => expect(wrapper.find('[data-prueba="script-sin-radius"]').exists()).toBe(true))
            expect(wrapper.find('[data-prueba="abrir-script"]').attributes('disabled')).toBeDefined()
            expect(wrapper.find('[data-prueba="script-sin-radius"]').text()).toContain('el script de conexión configura RADIUS y CoA')

            const resultado = await useRouters().scriptConexion(router.id, {})
            expect(resultado.ok).toBe(false)
            expect(!resultado.ok && esScriptRequiereRadius(resultado.problema)).toBe(true)
        })

        it('con RADIUS el botón sigue habilitado', async () => {
            const wrapper = await mountSuspended(enApp(RouterConexionSeccion, { router: structuredClone(bd.routers[0]!) }))
            await esperar(() => expect(wrapper.find('[data-prueba="abrir-script"]').exists()).toBe(true))
            expect(wrapper.find('[data-prueba="abrir-script"]').attributes('disabled')).toBeUndefined()
            expect(wrapper.find('[data-prueba="script-sin-radius"]').exists()).toBe(false)
        })
    })

    describe('servicios en un router sin RADIUS', () => {
        function prepararRouter(): Schema<'Router'> {
            const router = routerSinRadius(95)
            bd.routers.push(router)
            bd.planesPorRouter[router.id] = [1, 2]
            bd.redesIpv4.push({ ...structuredClone(bd.redesIpv4[0]!), id: 95, router_id: router.id, nombre: 'Fijas norte', cidr: '100.64.95.0/24', gateway: '100.64.95.1' })
            return router
        }

        it('el alta deshabilita PPPoE y preselecciona IP estática', async () => {
            const router = prepararRouter()
            const cliente = structuredClone(bd.clientes[0]!)
            const wrapper = await mountSuspended(ServicioAltaFormulario, { props: { cliente, compacto: true } })
            const raiz = wrapper.element.parentElement ?? wrapper.element
            await esperar(() => expect(radio('[data-prueba="alta-servicio"]', router.id, raiz)).not.toBeNull())
            // Con RADIUS (el primero) PPPoE está disponible.
            elegir('[data-prueba="alta-servicio"]', 1, raiz)
            await esperar(() => expect(radio('[data-prueba="tipo-conexion"]', 'pppoe', raiz)).not.toBeNull())
            expect(radio('[data-prueba="tipo-conexion"]', 'pppoe', raiz)!.hasAttribute('data-disabled')).toBe(false)
            expect(radio('[data-prueba="tipo-conexion"]', 'pppoe', raiz)!.getAttribute('aria-checked')).toBe('true')

            elegir('[data-prueba="alta-servicio"]', router.id, raiz)
            await esperar(() => expect(raiz.querySelector('[data-prueba="router-sin-radius"]')).not.toBeNull())
            expect(radio('[data-prueba="tipo-conexion"]', 'pppoe', raiz)!.hasAttribute('data-disabled')).toBe(true)
            expect(raiz.querySelector('[data-prueba="tipo-conexion"]')!.textContent).toContain('No disponible: este router no usa RADIUS.')
            expect(radio('[data-prueba="tipo-conexion"]', 'ip_estatica', raiz)!.getAttribute('aria-checked')).toBe('true')
            expect(wrapper.text()).toContain('RB-Norte no usa RADIUS')
        })

        it('la API responde 422 pppoe_requiere_radius a un PPPoE en ese router', async () => {
            const router = prepararRouter()
            const resultado = await useServicios().crear({ cliente_id: bd.clientes[0]!.id, router_id: router.id, plan_id: 1, ipv6_modo: 'ninguno', plantilla_facturacion_id: bd.plantillas[0]!.id }, nuevaClaveIdempotencia())
            expect(resultado.ok).toBe(false)
            if (!resultado.ok) {
                expect(esPppoeRequiereRadius(resultado.problema)).toBe(true)
                expect(resultado.problema.errors?.[0]?.field).toBe('tipo_conexion')
                expect(resultado.problema.detail).toBe(MENSAJE_PPPOE_SIN_RADIUS)
            }
        })

        it('la edición de un servicio en ese router no ofrece pasar a PPPoE', async () => {
            const router = prepararRouter()
            const base = bd.servicios.find(s => s.tipo_conexion === 'ip_estatica') ?? bd.servicios[0]!
            const servicio = { ...structuredClone(base), id: 950, router_id: router.id, tipo_conexion: 'ip_estatica' as const, user_ppp: null, ipv6_modo: 'ninguno' as const }
            bd.servicios.push(servicio)
            const vista = (await useServicios().ver(servicio.id))
            expect(vista.ok).toBe(true)
            if (!vista.ok) {
                return
            }
            await mountSuspended(ServicioEditar, { props: { servicio: vista.data, open: true } })
            await esperar(() => expect(radio('[data-prueba="editar-tipo-conexion"]', 'pppoe')?.hasAttribute('data-disabled')).toBe(true))
            expect(document.body.querySelector('[data-prueba="editar-tipo-conexion"]')!.textContent).toContain('RB-Norte no usa RADIUS')
        })
    })

    describe('textos', () => {
        it('textoNas y hostYNas contemplan nas_ip null', () => {
            expect(textoNas({ nas_ip: null, modo_seguridad: 'api' })).toBe('Sin RADIUS')
            expect(textoNas({ nas_ip: '10.0.0.1', modo_seguridad: 'radius' })).toBe('10.0.0.1')
            expect(textoNas({ nas_ip: null, modo_seguridad: 'radius' })).toBe('—')
            expect(hostYNas({ host: '10.40.0.1', nas_ip: null })).toBe('10.40.0.1 · sin RADIUS')
            expect(hostYNas({ host: '10.10.0.1', nas_ip: '10.10.0.1' })).toBe('10.10.0.1 · NAS 10.10.0.1')
        })

        it('serviciosPppoeEnRouter lee el total del detail y los ids de errors[]', () => {
            const lectura = serviciosPppoeEnRouter({
                type: 'urn:argosisp:problema:servicios_pppoe_en_router',
                title: 'Regla de negocio',
                status: 422,
                detail: 'El router tiene 73 servicios PPPoE sin retirar, y PPPoE necesita RADIUS.',
                errors: [{ field: 'servicios.4', message: 'Servicio 4 (PPPoE ana, activo)', rule: 'pppoe_requiere_radius' }],
            })
            expect(lectura).toEqual({ total: 73, servicios: [{ id: 4, texto: 'Servicio 4 (PPPoE ana, activo)' }] })
            expect(serviciosPppoeEnRouter({ type: 'urn:argosisp:problema:validacion', title: 'x', status: 422 })).toBeNull()
        })
    })
})
