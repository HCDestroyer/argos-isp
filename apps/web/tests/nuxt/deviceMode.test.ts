import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { MENSAJE_PROXY_DEVICE_MODE, diagnosticoCorte } from '~~/fixtures/routers/estrategias'
import RouterDiagnosticoCorte from '~/components/RouterDiagnosticoCorte.vue'
import ServicioSincronizarRouterModal from '~/components/ServicioSincronizarRouterModal.vue'
import { esperar } from '../ayudas/esperar'

/**
 * RouterOS 7.17+ con el device-mode sin proxy web y comandos rechazados (A1, `failure: invalid local
 * port` en v1.17.0): el diagnóstico de corte trae `proxy_device_mode` con los pasos en el router (no es
 * reconciliable), y «Sincronizar con el router» y «Probar conexión» dicen `rechazado` o `device_mode`
 * con su título, nunca «no responde».
 */
describe('device-mode sin proxy web y comandos rechazados', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    const cuerpo = () => document.body
    const routerCodigo = () => bd.routers.find(r => r.corte_identificacion === 'codigo')!

    describe('diagnóstico de corte', () => {
        it('proxy_device_mode en rojo: su paso, los pasos en el router y sin «Reconciliar ahora»', async () => {
            const router = routerCodigo()
            bd.routersSinProxyWeb = [router.id]
            const corte = diagnosticoCorte(router)
            expect(corte.chequeos.map(c => c.clave)).toContain('proxy_device_mode')
            // Sin proxy web no se revisa el proxy de corte (A1 lo omite).
            expect(corte.chequeos.map(c => c.clave)).not.toContain('proxy_corte')
            const soloDevice: Schema<'DiagnosticoCorte'> = { ...corte, chequeos: corte.chequeos.filter(c => c.clave === 'proxy_device_mode'), problemas: corte.problemas.filter(p => p.codigo === 'proxy_device_mode') }

            const vista = await mountSuspended(RouterDiagnosticoCorte, { props: { corte: soloDevice } })
            const paso = vista.find('[data-corte="proxy_device_mode"]')
            expect(paso.text()).toContain('El device-mode permite el proxy web')
            expect(paso.text()).toContain('Falla')
            expect(paso.find('[data-prueba="corte-accion-proxy_device_mode"]').text()).toContain('«Reconciliar ahora» no lo arregla')
            const pasos = paso.findAll('[data-prueba="corte-pasos-proxy_device_mode"] li').map(li => li.text())
            expect(pasos).toEqual([...PASOS_DEVICE_MODE])
            expect(pasos[0]).toContain('/system/device-mode/update proxy=yes')
            expect(pasos[1]).toContain('presiona su botón o apágalo y enciéndelo')
            expect(pasos[1]).toContain('5 minutos')
            expect(paso.find('[data-prueba="comandos-routeros"]').text()).toContain('/system/device-mode/update proxy=yes')
            // No es reconciliable: ni la línea genérica ni el botón.
            expect(paso.text()).not.toContain('lo deja como debe estar')
            expect(vista.find('[data-prueba="corte-reconciliar"]').exists()).toBe(false)
        })

        it('con el device-mode permitido el paso sale en verde y el proxy de corte se revisa', () => {
            const corte = diagnosticoCorte(routerCodigo())
            expect(corte.chequeos.find(c => c.clave === 'proxy_device_mode')).toMatchObject({ ok: true, detalle: 'El device-mode del router permite el proxy web' })
            expect(corte.chequeos.map(c => c.clave)).toContain('proxy_corte')
        })
    })

    describe('títulos de los motivos', () => {
        it('rechazado y device_mode tienen su título; los demás usan el genérico', () => {
            expect(tituloMotivoApi('rechazado')).toBe('El router rechazó un comando')
            expect(tituloMotivoApi('device_mode')).toBe('El router no permite el proxy web')
            expect(tituloMotivoApi('no_responde')).toBeNull()
            expect(tituloMotivoApi(null)).toBeNull()
        })

        it('«Probar conexión»: el consejo de rechazado y device_mode dice que el router sí responde', () => {
            const base = { clave: 'api' as const, ok: false, ms: 40, detalle: 'x' }
            expect(consejoChequeo({ ...base, motivo: 'rechazado' })).toContain('El router sí responde')
            const device = consejoChequeo({ ...base, motivo: 'device_mode' }) ?? ''
            expect(device).toContain('El router sí responde')
            expect(device).toContain('/system/device-mode/update proxy=yes')
            expect(device).not.toMatch(/no respond/i)
        })
    })

    describe('sincronizar con el router', () => {
        const servicioEn = (routerId: number) => {
            const servicio = bd.servicios.find(s => s.estado === 'activo')!
            servicio.router_id = routerId
            return structuredClone(servicio)
        }

        async function sincronizar(routerId: number) {
            const vista = await mountSuspended(ServicioSincronizarRouterModal, { props: { servicio: servicioEn(routerId), nombreRouter: 'RB-Centro', open: false } })
            await vista.setProps({ open: true })
            await esperar(() => expect(cuerpo().querySelector('[data-prueba="sincronizar-router-confirmar"]')).not.toBeNull())
            cuerpo().querySelector<HTMLElement>('[data-prueba="sincronizar-router-confirmar"]')!.click()
            await esperar(() => expect(cuerpo().querySelector('[data-prueba="sincronizar-error"]')).not.toBeNull())
            return cuerpo().querySelector<HTMLElement>('[data-prueba="sincronizar-error"]')!
        }

        it('rechazado: «El router rechazó un comando» con el detalle tal cual', async () => {
            const detalle = 'RouterOS rechazó «ip/proxy/access add»: failure: invalid local port.'
            bd.fallasRouterOs[1] = { motivo: 'rechazado', detalle }
            const error = await sincronizar(1)
            expect(error.dataset.motivo).toBe('rechazado')
            expect(error.textContent).toContain('El router rechazó un comando')
            expect(error.textContent).toContain(detalle)
            expect(error.textContent).not.toMatch(/no respond/i)
            expect(error.querySelector('[data-prueba="pasos-device-mode"]')).toBeNull()
        })

        it('device_mode: «El router no permite el proxy web» con los pasos', async () => {
            bd.fallasRouterOs[1] = { motivo: 'device_mode', detalle: MENSAJE_PROXY_DEVICE_MODE }
            const error = await sincronizar(1)
            expect(error.dataset.motivo).toBe('device_mode')
            expect(error.textContent).toContain('El router no permite el proxy web')
            expect(error.textContent).not.toMatch(/no respond/i)
            const pasos = [...error.querySelectorAll('[data-prueba="pasos-device-mode"] li')].map(li => li.textContent?.trim())
            expect(pasos).toEqual([...PASOS_DEVICE_MODE])
        })

        it('los demás motivos siguen con el título genérico', async () => {
            const error = await sincronizar(2)
            expect(error.dataset.motivo).toBe('sin_certificado')
            expect(error.textContent).toContain('El router no respondió como se esperaba')
        })
    })
})
