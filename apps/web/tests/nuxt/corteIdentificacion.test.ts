import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, type Component } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import RouterAltaModal from '~/components/RouterAltaModal.vue'
import RouterEditarModal from '~/components/RouterEditarModal.vue'
import RouterDiagnosticoCorte from '~/components/RouterDiagnosticoCorte.vue'
import ServicioCodigoCorte from '~/components/ServicioCodigoCorte.vue'
import { UApp } from '#components'
import { esperar } from '../ayudas/esperar'

/**
 * Identificación del cliente cortado (`contratos/corte-identificacion.md` §5 P1 y §5 bis): selector
 * obligatorio en el alta y la edición del router (sin valor preseleccionado en el alta, «Por código»
 * solo con la API y 422 `corte_codigo_sin_api` en el campo), «Código de corte» en la ficha del servicio
 * (nunca el código; activo, en gracia o sin código, con error y «Reintentar») y el diagnóstico de corte
 * con «Editar router» cuando el portal ve otra IP.
 */

function enApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

function enBody(prueba: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)
}

function opcion(contenedor: string, valor: string): HTMLElement {
    const elemento = document.body.querySelector<HTMLElement>(`[data-prueba="${contenedor}"] [role="radio"][value="${valor}"], [data-prueba="${contenedor}"] button[value="${valor}"]`)
    expect(elemento, `${contenedor} = ${valor}`).not.toBeNull()
    return elemento!
}

function escribir(nombre: string, valor: string) {
    const campo = document.body.querySelector<HTMLInputElement>(`[name="${nombre}"]`)
    expect(campo, nombre).not.toBeNull()
    campo!.value = valor
    campo!.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('identificación del cliente cortado', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    describe('alta del router', () => {
        it('obliga a elegir, sin valor preseleccionado; sin API «Por código» está deshabilitado', async () => {
            await mountSuspended(enApp(RouterAltaModal, { open: true }))
            await esperar(() => expect(enBody('router-corte-identificacion')).not.toBeNull())
            const campo = enBody('router-corte-identificacion')!
            expect(campo.textContent).toContain('Identificación del cliente cortado')
            expect(campo.textContent).toContain('Por código (recomendado si el router tiene API)')
            expect(campo.textContent).toContain('Por IP (solo si no hay NAT ni proxy entre el router y Argos)')
            expect(opcion('router-corte-identificacion', 'codigo').getAttribute('aria-checked')).toBe('false')
            expect(opcion('router-corte-identificacion', 'ip').getAttribute('aria-checked')).toBe('false')
            expect(opcion('router-corte-identificacion', 'codigo').hasAttribute('disabled') || opcion('router-corte-identificacion', 'codigo').getAttribute('data-disabled') !== null).toBe(true)
            expect(campo.textContent).toContain('Sin la API del router solo se puede «Por IP».')

            escribir('nombre', 'RB-Norte')
            escribir('host', '10.40.0.1')
            escribir('nas_ip', '10.40.0.1')
            const antes = bd.routers.length
            enBody('router-guardar')!.click()
            await esperar(() => expect(enBody('router-corte-identificacion')!.textContent).toContain('Elige cómo identificar al cliente cortado'))
            expect(bd.routers).toHaveLength(antes)
        })

        it('con la API sugiere «Por código», explica el proxy y crea el router en modo código', async () => {
            await mountSuspended(enApp(RouterAltaModal, { open: true }))
            await esperar(() => expect(enBody('router-corte-identificacion')).not.toBeNull())
            escribir('nombre', 'RB-Norte')
            escribir('host', '10.40.0.1')
            escribir('nas_ip', '10.40.0.1')
            escribir('api_usuario', 'argos')
            escribir('api_password', 'clave-api-segura')
            await esperar(() => expect(enBody('router-corte-identificacion')!.textContent).toContain('Sugerido: «Por código», porque el router tiene API.'))
            const codigo = opcion('router-corte-identificacion', 'codigo')
            expect(codigo.hasAttribute('disabled')).toBe(false)
            codigo.click()
            await esperar(() => expect(enBody('router-corte-identificacion')!.textContent).toContain('puerto 3346, cerrado desde afuera'))
            enBody('router-guardar')!.click()
            await esperar(() => expect(bd.routers.find(r => r.nombre === 'RB-Norte')).toBeDefined())
            expect(bd.routers.find(r => r.nombre === 'RB-Norte')!.corte_identificacion).toBe('codigo')
        })

        it('elegido «Por código» y luego sin clave: el error queda en el campo y no se manda', async () => {
            await mountSuspended(enApp(RouterAltaModal, { open: true }))
            await esperar(() => expect(enBody('router-corte-identificacion')).not.toBeNull())
            escribir('nombre', 'RB-Norte')
            escribir('host', '10.40.0.1')
            escribir('nas_ip', '10.40.0.1')
            escribir('api_usuario', 'argos')
            escribir('api_password', 'clave')
            await esperar(() => expect(opcion('router-corte-identificacion', 'codigo').hasAttribute('disabled')).toBe(false))
            opcion('router-corte-identificacion', 'codigo').click()
            escribir('api_password', '')
            const antes = bd.routers.length
            enBody('router-guardar')!.click()
            await esperar(() => expect(enBody('router-corte-identificacion')!.textContent).toContain('La identificación por código necesita la API del router'))
            expect(bd.routers).toHaveLength(antes)
        })
    })

    describe('edición del router', () => {
        it('muestra el valor actual y guarda el cambio a «Por código»', async () => {
            const router = bd.routers.find(r => r.id === 1)!
            expect(router.corte_identificacion).toBe('ip')
            await mountSuspended(enApp(RouterEditarModal, { router, open: true }))
            await esperar(() => expect(enBody('router-editar-corte-identificacion')).not.toBeNull())
            expect(opcion('router-editar-corte-identificacion', 'ip').getAttribute('aria-checked')).toBe('true')
            opcion('router-editar-corte-identificacion', 'codigo').click()
            await esperar(() => expect(enBody('aviso-corte-codigo')).not.toBeNull())
            enBody('router-editar-guardar')!.click()
            await esperar(() => expect(bd.routers.find(r => r.id === 1)!.corte_identificacion).toBe('codigo'))
            const entrada = bd.acciones.filter(a => a.accion === 'routers.editar' && a.entidad_id === 1).at(-1)?.entrada as Record<string, unknown> | undefined
            expect(entrada?.corte_identificacion).toBe('codigo')
        })

        it('borrar la clave de un router en código: error en el campo y 422 corte_codigo_sin_api', async () => {
            const router = bd.routers.find(r => r.id === 2)!
            expect(router.corte_identificacion).toBe('codigo')
            await mountSuspended(enApp(RouterEditarModal, { router, open: true }))
            await esperar(() => expect(enBody('router-editar-corte-identificacion')).not.toBeNull())
            expect(opcion('router-editar-corte-identificacion', 'codigo').getAttribute('aria-checked')).toBe('true')
            const quitar = enBody('quitar-api-password')!
            const casilla = quitar.matches('button, [role="checkbox"]') ? quitar : quitar.querySelector<HTMLElement>('button, [role="checkbox"]')!
            casilla.click()
            await esperar(() => expect(enBody('router-editar-corte-identificacion')!.textContent).toContain('La identificación por código necesita la API del router'))
            const version = router.version
            enBody('router-editar-guardar')!.click()
            await esperar(() => expect(bd.acciones.some(a => a.accion === 'routers.editar' && a.entidad_id === 2)).toBe(false))
            await esperar(() => expect(enBody('router-editar-corte-identificacion')!.textContent).toContain('necesita la API'))
            expect(bd.routers.find(r => r.id === 2)!.version).toBe(version)
            expect(bd.routers.find(r => r.id === 2)!.tiene_api_password).toBe(true)

            // La API (y el fixture) responden 422 `corte_codigo_sin_api` en el campo.
            const respuesta = await useRouters().editar(2, { version, quitar_api_password: true })
            expect(!respuesta.ok && esCorteCodigoSinApi(respuesta.problema)).toBe(true)
        })
    })

    describe('código de corte en la ficha del servicio', () => {
        function servicioEn(routerId: number): Schema<'Servicio'> {
            const servicio = bd.servicios.find(s => s.router_id === routerId && s.estado !== 'retirado')
            expect(servicio).toBeDefined()
            return servicio!
        }

        it('suspendido en un router por código: activo desde, sin mostrar el código', async () => {
            const servicio = servicioEn(2)
            servicio.estado = 'suspendido'
            const tarjeta = await mountSuspended(ServicioCodigoCorte, { props: { servicioId: servicio.id } })
            await esperar(() => expect(tarjeta.find('[data-prueba="codigo-corte-estado"]').text()).toBe('Activo'))
            expect(tarjeta.find('[data-prueba="codigo-corte-detalle"]').text()).toContain('Activo desde')
            expect(tarjeta.text()).toContain('El código no se muestra')
            expect(tarjeta.text()).toContain('Router: por código')
        })

        it('reactivado hace minutos: en gracia; en un router por IP: sin código', async () => {
            const servicio = servicioEn(2)
            bd.codigosCorte.push({ servicio_id: servicio.id, creado_en: new Date(Date.now() - 86_400_000).toISOString(), cerrado_en: new Date(Date.now() - 5 * 60_000).toISOString() })
            const gracia = await mountSuspended(ServicioCodigoCorte, { props: { servicioId: servicio.id } })
            await esperar(() => expect(gracia.find('[data-prueba="codigo-corte-estado"]').text()).toBe('En gracia'))
            expect(gracia.find('[data-prueba="codigo-corte-detalle"]').text()).toContain('Sigue abriendo la página de corte hasta')
            gracia.unmount()

            const porIp = servicioEn(1)
            const sinCodigo = await mountSuspended(ServicioCodigoCorte, { props: { servicioId: porIp.id } })
            await esperar(() => expect(sinCodigo.find('[data-prueba="codigo-corte-detalle"]').text()).toBe('Sin código: el router identifica por IP.'))
        })

        it('si la API falla muestra el error con «Reintentar» y ningún estado', async () => {
            simularFalla('GET /api/v1/servicios/:id/codigo-corte', 500)
            const servicio = servicioEn(2)
            const tarjeta = await mountSuspended(ServicioCodigoCorte, { props: { servicioId: servicio.id } })
            await esperar(() => expect(tarjeta.text()).toContain('Reintentar'))
            expect(tarjeta.find('[data-prueba="codigo-corte-estado"]').exists()).toBe(false)
            delete bd.fallas['GET /api/v1/servicios/:id/codigo-corte']
            const reintentar = tarjeta.findAll('button').find(b => b.text().includes('Reintentar'))!
            await reintentar.trigger('click')
            await esperar(() => expect(tarjeta.find('[data-prueba="codigo-corte-estado"]').exists()).toBe(true))
        })
    })

    describe('diagnóstico de corte', () => {
        const corte: Schema<'DiagnosticoCorte'> = {
            router_id: 1,
            ok: false,
            chequeos: [
                {
                    clave: 'portal_ip_cliente',
                    ok: false,
                    codigo: 'portal_ve_otra_ip',
                    detalle: 'El portal ve la IP 203.0.113.7 en vez de la del cliente (100.64.10.1): hay NAT (masquerade del router hacia el portal) o un proxy en medio, así que la IP no sirve para saber quién es el suspendido. Pasa el router a «Identificación por código»',
                    comandos: ['/tool fetch url="https://portal.example.test/api/v1/portal/eco-ip" src-address=100.64.10.1 output=user'],
                    reconciliar: false,
                },
                {
                    clave: 'proxy_corte',
                    ok: false,
                    codigo: 'proxy_corte',
                    detalle: 'Identificación por código: falta la regla final del proxy (sin código). «Reconciliar ahora» lo corrige',
                    comandos: ['/ip proxy print', '/ip proxy access print'],
                    reconciliar: true,
                },
            ],
            problemas: [],
            faltan: [],
            portal: { url: 'https://portal.example.test', fqdn: 'portal.example.test', ipv4: '203.0.113.10', origen: 'configuracion', destino_nat: '203.0.113.10:8088', alcanzable: true, http_status: 302, detalle: null },
            suspendidos: { total: 0, fuera_de_lista: 0, ejemplos: [] },
            limites: [],
        }

        it('«el portal ve otra IP» dice qué hacer y ofrece «Editar router»; el proxy, «Reconciliar ahora»', async () => {
            const diagnostico = await mountSuspended(RouterDiagnosticoCorte, { props: { corte } })
            const ip = diagnostico.find('[data-corte="portal_ip_cliente"]')
            expect(ip.text()).toContain('Qué IP ve la página de corte desde la red de clientes')
            expect(ip.find('[data-prueba="corte-accion-portal_ve_otra_ip"]').text()).toContain('«Identificación del cliente cortado: Por código»')
            await ip.find('[data-prueba="corte-editar-router"]').trigger('click')
            expect(diagnostico.emitted('editar')).toHaveLength(1)
            const proxy = diagnostico.find('[data-corte="proxy_corte"]')
            expect(proxy.text()).toContain('Proxy de corte del router (puerto 3346)')
            expect(proxy.text()).toContain('«Reconciliar ahora» lo deja como debe estar')
            expect(diagnostico.find('[data-prueba="corte-reconciliar"]').exists()).toBe(true)
        })
    })

    describe('presentarCodigoCorte', () => {
        const base: Schema<'CodigoCorteServicio'> = { servicio_id: 1, corte_identificacion: 'codigo', activo: false, creado_en: null, cerrado_en: null, resuelve_hasta: null }

        it('distingue activo, en gracia, cerrado y sin código', () => {
            const ahora = Date.parse('2026-11-08T18:00:00Z')
            expect(presentarCodigoCorte({ ...base, activo: true, creado_en: '2026-11-08T12:00:00Z' }, ahora).estado).toBe('activo')
            expect(presentarCodigoCorte({ ...base, creado_en: '2026-11-07T12:00:00Z', cerrado_en: '2026-11-08T17:45:00Z', resuelve_hasta: '2026-11-08T18:15:00Z' }, ahora).estado).toBe('gracia')
            // La gracia la fija el servidor: con 10 min, a los 15 ya no resuelve.
            expect(presentarCodigoCorte({ ...base, creado_en: '2026-11-07T12:00:00Z', cerrado_en: '2026-11-08T17:45:00Z', resuelve_hasta: '2026-11-08T17:55:00Z' }, ahora).estado).toBe('cerrado')
            expect(presentarCodigoCorte({ ...base, creado_en: '2026-11-07T12:00:00Z', cerrado_en: '2026-11-08T17:15:00Z', resuelve_hasta: '2026-11-08T17:45:00Z' }, ahora).estado).toBe('cerrado')
            expect(presentarCodigoCorte(base, ahora).detalle).toBe('Nunca ha tenido código: se emite al suspenderse.')
            expect(presentarCodigoCorte({ ...base, corte_identificacion: 'ip' }, ahora).detalle).toBe('Sin código: el router identifica por IP.')
        })
    })
})
