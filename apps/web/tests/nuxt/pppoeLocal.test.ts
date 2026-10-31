import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, type Component } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { MATRIZ } from '~~/fixtures/routers/estrategias'
import { estrategiaSimple } from '~~/fixtures/routers/estrategiasDatos'
import { MENSAJE_API_PPPOE_LOCAL } from '~~/fixtures/servicios/rutas'
import { nuevaSesion } from '~~/fixtures/sesiones/datos'
import EstrategiaVelocidadEditor from '~/components/EstrategiaVelocidadEditor.vue'
import RouterEditarModal from '~/components/RouterEditarModal.vue'
import ServicioAltaFormulario from '~/components/ServicioAltaFormulario.vue'
import ServicioEditar from '~/components/ServicioEditar.vue'
import ServicioSesiones from '~/components/ServicioSesiones.vue'
import PaginaRouter from '~/pages/routers/[id].vue'
import PaginaServicio from '~/pages/servicios/[id].vue'
import { UApp } from '#components'
import { esperar } from '../ayudas/esperar'

/**
 * PPPoE sin RADIUS (`contratos/pppoe-local.md`, PR #206): en un router `api` el panel ofrece PPPoE
 * (secret local en el MikroTik), avisa y muestra el 422 `pppoe_local_requiere_api` si el router no
 * tiene credenciales de la API, marca las sesiones «Por sondeo» sin consumo, explica el modo en la
 * ficha del router y el porqué de la regla `pppoe_sin_radius` en el editor de velocidad.
 */

function enApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

/** Router sin RADIUS como lo devuelve la API: `nas_ip: null`, con credenciales de la API salvo que se quiten. */
function routerApi(id: number, cambios: Partial<Schema<'Router'>> = {}): Schema<'Router'> {
    const router: Schema<'Router'> = {
        ...structuredClone(bd.routers[0]!),
        id,
        nombre: 'RB-Norte API',
        host: '10.40.0.1',
        api_url: null,
        nas_ip: null,
        modo_seguridad: 'api',
        tiene_radius_secret: false,
        api_usuario: 'argos',
        tiene_api_password: true,
        serial: null,
        unido_a_id: null,
        activo: true,
        version: 1,
        ...cambios,
    }
    bd.routers.push(router)
    bd.planesPorRouter[router.id] = [1, 2]
    bd.redesIpv4.push({ ...structuredClone(bd.redesIpv4[0]!), id: 900 + id, router_id: router.id, nombre: null, cidr: `100.64.${id}.0/24`, gateway: `100.64.${id}.1` })
    return router
}

/** La opción de un `URadioGroup` por su `value`. */
function radio(contenedor: string, valor: string | number, raiz: ParentNode = document.body): HTMLElement | null {
    return raiz.querySelector<HTMLElement>(`${contenedor} [role="radio"][value="${valor}"], ${contenedor} button[value="${valor}"]`)
}

function elegir(contenedor: string, valor: string | number, raiz: ParentNode = document.body) {
    const opcion = radio(contenedor, valor, raiz)
    expect(opcion, `${contenedor} = ${valor}`).not.toBeNull()
    opcion!.click()
}

async function crearPppoe(routerId: number): Promise<Servicio> {
    const resultado = await useServicios().crear({ cliente_id: bd.clientes[0]!.id, router_id: routerId, plan_id: 1, ipv6_modo: 'ninguno', plantilla_facturacion_id: bd.plantillas[0]!.id }, nuevaClaveIdempotencia())
    if (!resultado.ok) {
        throw new Error(`${resultado.problema.title}: ${JSON.stringify(resultado.problema.errors ?? resultado.problema.detail)}`)
    }
    return resultado.data
}

describe('PPPoE sin RADIUS', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    describe('alta de servicio', () => {
        it('en un router sin RADIUS PPPoE sigue elegido, con la ayuda del secret local', async () => {
            const router = routerApi(95)
            const wrapper = await mountSuspended(ServicioAltaFormulario, { props: { cliente: structuredClone(bd.clientes[0]!), compacto: true } })
            const raiz = wrapper.element.parentElement ?? wrapper.element
            await esperar(() => expect(radio('[data-prueba="alta-servicio"]', router.id, raiz)).not.toBeNull())
            elegir('[data-prueba="alta-servicio"]', router.id, raiz)
            await esperar(() => expect(raiz.querySelector('[data-prueba="router-sin-radius"]')).not.toBeNull())
            const pppoe = radio('[data-prueba="tipo-conexion"]', 'pppoe', raiz)!
            expect(pppoe.hasAttribute('data-disabled')).toBe(false)
            expect(pppoe.getAttribute('aria-checked')).toBe('true')
            expect(raiz.querySelector('[data-prueba="tipo-conexion"]')!.textContent).toContain('Sin RADIUS: el usuario se crea como secret en el MikroTik; sin consumo de datos ni cambios al instante')
            expect(wrapper.text()).toContain('RB-Norte API no usa RADIUS')
            expect(raiz.querySelector('[data-prueba="pppoe-local-requiere-api"]')).toBeNull()
        })

        it('sin credenciales de la API avisa antes de enviar, con el enlace a la ficha del router', async () => {
            const router = routerApi(96, { nombre: 'RB-Sin API', api_usuario: null, tiene_api_password: false })
            const wrapper = await mountSuspended(enApp(ServicioAltaFormulario, { cliente: structuredClone(bd.clientes[0]!), compacto: true }))
            const raiz = wrapper.element.parentElement ?? wrapper.element
            await esperar(() => expect(radio('[data-prueba="alta-servicio"]', router.id, raiz)).not.toBeNull())
            expect(raiz.textContent).toContain('sin RADIUS (sin credenciales de la API)')
            elegir('[data-prueba="alta-servicio"]', router.id, raiz)
            const aviso = await esperar(() => {
                const elemento = raiz.querySelector('[data-prueba="pppoe-local-requiere-api"]')
                expect(elemento).not.toBeNull()
                return elemento!
            })
            expect(aviso.textContent).toContain('El router no tiene credenciales de la API: agrégalas en la ficha del router.')
            expect(aviso.querySelector('a')?.getAttribute('href')).toBe(`/routers/${router.id}`)
            // Con IP estática no hace falta: el aviso se va.
            elegir('[data-prueba="tipo-conexion"]', 'ip_estatica', raiz)
            await esperar(() => expect(raiz.querySelector('[data-prueba="pppoe-local-requiere-api"]')).toBeNull())
        })

        it('la API crea el PPPoE con credenciales y responde 422 pppoe_local_requiere_api sin ellas', async () => {
            const conApi = routerApi(97)
            const servicio = await crearPppoe(conApi.id)
            expect(servicio.tipo_conexion).toBe('pppoe')
            expect(servicio.user_ppp).toBeTruthy()

            const sinApi = routerApi(98, { api_usuario: null, tiene_api_password: false })
            const resultado = await useServicios().crear({ cliente_id: bd.clientes[0]!.id, router_id: sinApi.id, plan_id: 1, ipv6_modo: 'ninguno', plantilla_facturacion_id: bd.plantillas[0]!.id }, nuevaClaveIdempotencia())
            expect(resultado.ok).toBe(false)
            if (!resultado.ok) {
                expect(esPppoeLocalRequiereApi(resultado.problema)).toBe(true)
                expect(resultado.problema.errors?.[0]).toMatchObject({ field: 'router_id', rule: 'pppoe_local_requiere_api' })
                expect(resultado.problema.detail).toBe(MENSAJE_API_PPPOE_LOCAL)
            }
        })
    })

    describe('edición de servicio', () => {
        it('ofrece pasar a PPPoE; sin credenciales avisa y muestra el 422 con el enlace', async () => {
            const router = routerApi(99, { api_usuario: null, tiene_api_password: false })
            const base = bd.servicios.find(s => s.tipo_conexion === 'ip_estatica') ?? bd.servicios[0]!
            const servicio = { ...structuredClone(base), id: 990, router_id: router.id, tipo_conexion: 'ip_estatica' as const, user_ppp: null, ipv6_modo: 'ninguno' as const, mac: null, amarre_ip_mac: false }
            bd.servicios.push(servicio)
            const vista = await useServicios().ver(servicio.id)
            expect(vista.ok).toBe(true)
            if (!vista.ok) {
                return
            }
            await mountSuspended(enApp(ServicioEditar, { servicio: vista.data, open: true }))
            await esperar(() => expect(radio('[data-prueba="editar-tipo-conexion"]', 'pppoe')).not.toBeNull())
            expect(radio('[data-prueba="editar-tipo-conexion"]', 'pppoe')!.hasAttribute('data-disabled')).toBe(false)
            // La ayuda llega con el router (`routers.ver`).
            await esperar(() => expect(document.body.querySelector('[data-prueba="editar-tipo-conexion"]')!.textContent).toContain('Sin RADIUS: el usuario se crea como secret en el MikroTik'))

            elegir('[data-prueba="editar-tipo-conexion"]', 'pppoe')
            await esperar(() => expect(document.body.querySelector('[data-prueba="pppoe-local-requiere-api"]')).not.toBeNull())

            const resultado = await useServicios().editar(servicio.id, { version: vista.data.version, tipo_conexion: 'pppoe' })
            expect(!resultado.ok && esPppoeLocalRequiereApi(resultado.problema)).toBe(true)
        })
    })

    describe('sesiones por sondeo', () => {
        function sesionSondeo(servicio: Servicio, router: Schema<'Router'>, cambios: Partial<Schema<'Sesion'>> = {}): Schema<'Sesion'> {
            const sesion = { ...nuevaSesion(5000 + bd.sesiones.length, servicio, '2026-10-29T14:00:00.000Z', router), ...cambios }
            bd.sesiones.push(sesion)
            return sesion
        }

        it('textos: distintivo, NAS «—», consumo sin RADIUS y causas de fin', () => {
            const router = routerApi(81)
            const servicio = { ...structuredClone(bd.servicios[0]!), router_id: router.id }
            const sondeo = nuevaSesion(1, servicio, '2026-10-29T14:00:00.000Z', router)
            expect(sondeo).toMatchObject({ origen: 'sondeo', nas_ip: null, bytes_in: 0, bytes_out: 0 })
            expect(sondeo.acct_session_id.startsWith('sondeo:')).toBe(true)
            expect(esSesionPorSondeo(sondeo)).toBe(true)
            expect(textoNasSesion(sondeo)).toBe('—')
            expect(textoConsumoSesion(sondeo)).toBe('— (sin RADIUS no hay consumo)')
            expect(textoCausaFin({ ...sondeo, causa_fin: 'sondeo_sin_sesion' })).toBe('Ya no estaba en el router')
            expect(textoCausaFin({ ...sondeo, causa_fin: 'Admin-Reset' })).toBe('Desconectada por ArgosIsp')

            const radius = nuevaSesion(2, bd.servicios[0]!, '2026-10-29T14:00:00.000Z')
            expect(radius.origen).toBe('accounting')
            expect(textoNasSesion(radius)).toBe(radius.nas_ip)
            expect(textoConsumoSesion({ ...radius, bytes_in: 7_412_000_000, bytes_out: 904_000_000 })).toBe('7.4 GB ↓ / 904 MB ↑')
            expect(textoCausaFin({ ...radius, causa_fin: 'Admin-Reset' })).toBe('Admin-Reset')
            expect(textoCausaFin({ ...radius, causa_fin: 'Lost-Carrier' })).toBe('Lost-Carrier')
        })

        it('la ficha del servicio marca la sesión «Por sondeo», sin NAS ni consumo, y la desconecta igual', async () => {
            const router = routerApi(82)
            const servicio = await crearPppoe(router.id)
            // Una vieja, cerrada por el sondeo; la abierta la abre el sondeo de los fixtures al leer.
            sesionSondeo(servicio, router, { fin: '2026-10-29T15:00:00.000Z', causa_fin: 'sondeo_sin_sesion' })

            const pagina = await mountSuspended(enApp(PaginaServicio), { route: `/servicios/${servicio.id}` })
            await esperar(() => expect(pagina.find('[data-prueba="sesion-activa-sondeo"]').exists()).toBe(true))
            expect(pagina.find('[data-prueba="sesion-activa-sondeo"]').text()).toBe('Por sondeo')
            expect(pagina.find('[data-prueba="sesion-activa-consumo"]').text()).toContain('— (sin RADIUS no hay consumo)')
            expect(pagina.text()).toContain('— · sondeo:')
            expect(pagina.text()).toContain('Desconectar sesión')

            const historial = await esperar(() => {
                const tabla = pagina.find('[data-prueba="sesiones-servicio"]')
                expect(tabla.text()).toContain('Ya no estaba en el router')
                return tabla
            })
            expect(historial.findAll('[data-prueba="sesion-por-sondeo"]').length).toBe(2)
            expect(historial.text()).toContain('NAS —')

            // «Desconectar» va por la misma acción; la sesión de sondeo cierra con Admin-Reset.
            const desconectado = await useServicios().ejecutar(servicio.id, 'desconectar', 'Prueba de reconexión', nuevaClaveIdempotencia())
            expect(desconectado.ok).toBe(true)
            const cerrada = bd.sesiones.find(s => s.servicio_id === servicio.id && s.causa_fin === 'Admin-Reset')
            expect(cerrada?.origen).toBe('sondeo')
            expect(textoCausaFin(cerrada!)).toBe('Desconectada por ArgosIsp')
        })

        it('el historial de un PPPoE con RADIUS muestra el consumo y no el distintivo', async () => {
            const servicio = bd.servicios.find(s => s.router_id === 1 && (s.tipo_conexion ?? 'pppoe') === 'pppoe' && s.estado === 'activo')!
            const vista = await mountSuspended(ServicioSesiones, { props: { servicioId: servicio.id } })
            await esperar(() => expect(vista.text()).toContain('GB ↓'))
            expect(vista.find('[data-prueba="sesion-por-sondeo"]').exists()).toBe(false)
            expect(vista.text()).toContain('Lost-Carrier')
        })
    })

    describe('router sin RADIUS', () => {
        it('la ficha explica cómo funciona PPPoE ahí y avisa si faltan las credenciales', async () => {
            const router = routerApi(83, { api_usuario: null, tiene_api_password: false })
            const pagina = await mountSuspended(enApp(PaginaRouter), { route: `/routers/${router.id}` })
            await esperar(() => expect(pagina.find('[data-prueba="router-pppoe-sin-radius"]').exists()).toBe(true))
            const texto = pagina.find('[data-prueba="router-pppoe-sin-radius"]').text()
            expect(texto).toContain('secrets locales')
            expect(texto).toContain('cada minuto')
            expect(texto).toContain('no hay consumo')
            expect(pagina.text()).toContain('Sin usuario y contraseña de la API no se pueden crear servicios PPPoE aquí.')
        })

        it('pasar de «Sin RADIUS» a RADIUS avisa que se borran los secrets locales', async () => {
            const router = routerApi(84)
            await mountSuspended(RouterEditarModal, { props: { router: structuredClone(router), open: true } })
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-editar-modo"]')).not.toBeNull())
            expect(document.body.querySelector('[data-prueba="aviso-a-radius"]')).toBeNull()
            elegir('[data-prueba="router-editar-modo"]', 'radius')
            const aviso = await esperar(() => {
                const elemento = document.body.querySelector('[data-prueba="aviso-a-radius"]')
                expect(elemento).not.toBeNull()
                return elemento!
            })
            expect(aviso.textContent).toContain('Se borran los secrets PPPoE del router')
            expect(aviso.textContent).toContain('Las sesiones vivas siguen')
        })

        it('el aviso de RADIUS → «Sin RADIUS» sigue y la API sigue bloqueándolo con PPPoE (422 servicios_pppoe_en_router)', async () => {
            const router = structuredClone(bd.routers[0]!)
            await mountSuspended(RouterEditarModal, { props: { router, open: true } })
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-editar-modo"]')).not.toBeNull())
            elegir('[data-prueba="router-editar-modo"]', 'api')
            await esperar(() => expect(document.body.querySelector('[data-prueba="aviso-sin-radius"]')).not.toBeNull())
            expect(document.body.querySelector('[data-prueba="aviso-sin-radius"]')!.textContent).toContain('PPPoE por secrets locales')
            document.body.querySelector<HTMLButtonElement>('[data-prueba="router-editar-guardar"]')!.click()
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-pppoe-en-router"]')).not.toBeNull())
            expect(document.body.querySelector('[data-prueba="router-pppoe-en-router"]')!.textContent).toContain('hoy autentican por RADIUS')
        })
    })

    describe('control de velocidad', () => {
        it('en PPPoE de un router sin RADIUS el editor muestra el porqué de la matriz; con RADIUS no', async () => {
            const sinRadius = await mountSuspended(EstrategiaVelocidadEditor, { props: { matriz: MATRIZ, version: '7.24.5 (stable)', router: estrategiaSimple(), estrategias: estrategiaSimple(), sinRadius: true } })
            const regla = MATRIZ.reglas.find(r => r.rule === 'pppoe_sin_radius')!.mensaje
            expect(sinRadius.find('[data-prueba="estrategia-sin-radius"]').text()).toContain(regla.slice(1))

            const conRadius = await mountSuspended(EstrategiaVelocidadEditor, { props: { matriz: MATRIZ, version: '7.24.5 (stable)', router: estrategiaSimple(), estrategias: estrategiaSimple() } })
            expect(conRadius.find('[data-prueba="estrategia-sin-radius"]').exists()).toBe(false)
        })

        it('la vista previa rechaza radius_rate_limit en PPPoE con 422 pppoe_sin_radius en la capa', async () => {
            const router = routerApi(85)
            const propuesta = estrategiaSimple()
            propuesta.pppoe.aplicacion = 'radius_rate_limit'
            const previa = await useControlVelocidad().vistaPrevia(router.id, { estrategia_velocidad: propuesta })
            expect(previa.ok).toBe(false)
            if (!previa.ok) {
                expect(previa.problema.status).toBe(422)
                expect(previa.problema.errors).toContainEqual(expect.objectContaining({ field: 'estrategia_velocidad.pppoe.aplicacion', rule: 'pppoe_sin_radius' }))
                expect(erroresPorCapa(previa.problema.errors ?? [])['pppoe.aplicacion']?.[0]).toContain('el router no usa RADIUS')
            }
            propuesta.pppoe.aplicacion = 'perfil_ppp'
            const valida = await useControlVelocidad().vistaPrevia(router.id, { estrategia_velocidad: propuesta })
            expect(valida.ok && valida.data.valida).toBe(true)
        })
    })
})
