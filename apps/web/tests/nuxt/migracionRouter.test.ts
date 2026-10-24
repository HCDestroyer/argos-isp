import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import PaginaMigracion from '~/pages/routers/migracion.vue'
import { esperar } from '../ayudas/esperar'

const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(PaginaMigracion) }) })

function dato(wrapper: { find: (selector: string) => { exists: () => boolean, text: () => string } }, prueba: string): string | null {
    const elemento = wrapper.find(`[data-prueba="${prueba}"]`)
    return elemento.exists() ? elemento.text() : null
}

/**
 * Semana 3 (2.ª tanda) · tarea 6: `/routers/migracion` con lo que publicó A2: fecha de migración
 * guardada (`migracion-aaa`, `marcar-migrado`), `resumen-sesiones` y `GET /red/eventos`.
 */
describe('migración de router con la API de A2', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        // Sin vaciar el body: tests/setup.ts desmonta todo después (vaciarlo antes rompía el desmontaje).
    })

    it('hora de Guatemala, esquema de marcar y textos de los eventos de red', () => {
        expect(instanteGuatemala('2026-10-16T08:30')).toBe('2026-10-16T14:30:00.000Z')
        expect(instanteGuatemala('16/10/2026')).toBeNull()
        expect(localGuatemala('2026-10-16T14:30:00.000Z')).toBe('2026-10-16T08:30')
        const esquema = esquemaMarcarMigrado(new Date('2026-10-17T00:00:00.000Z'))
        expect(esquema.safeParse({ desde: '', motivo: 'Cambio de RADIUS' }).success).toBe(true)
        expect(esquema.safeParse({ desde: '2026-10-20T08:00', motivo: 'Cambio' }).success).toBe(false)
        expect(esquema.safeParse({ desde: '', motivo: 'no' }).success).toBe(false)

        const [disconnect, , routeros] = bd.eventosRed
        expect(disconnect && resumenComando(disconnect)).toBe('servicio.estado_cambiado · sesión 81A00003 · intento 3')
        expect(disconnect && resumenRespuesta(disconnect)).toBe('timeout · Sin respuesta del NAS en 3 s')
        expect(routeros && resumenComando(routeros)).toBe('PUT /ip/dhcp-server/lease')
        expect(routeros && resumenRespuesta(routeros)).toContain('HTTP 400 · failure: already have static lease')
    })

    it('API: marcar, 409 con versión vieja, resumen desde la fecha y 422 sin ella; eventos con resultado=error', async () => {
        const api = useRouters()
        const sinMarca = await api.migracionAaa(1)
        expect(sinMarca.ok && sinMarca.data).toMatchObject({ aaa_desde: null, version: 0 })
        const sinFecha = await api.resumenSesiones(1)
        expect(!sinFecha.ok && sinFecha.problema.status).toBe(422)

        const marcado = await api.marcarMigrado(1, { desde: '2026-10-10T06:00:00.000Z', motivo: 'Ventana de mantenimiento', version: 0 }, nuevaClaveIdempotencia())
        expect(marcado.ok && marcado.data).toMatchObject({ aaa_desde: '2026-10-10T06:00:00.000Z', version: 1 })
        const viejo = await api.marcarMigrado(1, { desde: null, motivo: 'Vuelta atrás', version: 0 }, nuevaClaveIdempotencia())
        expect(!viejo.ok && viejo.problema.status).toBe(409)

        const resumen = await api.resumenSesiones(1)
        expect(resumen.ok && resumen.data.desde).toBe('2026-10-10T06:00:00.000Z')
        expect(resumen.ok && resumen.data.servicios).toBe(resumen.ok ? resumen.data.con_sesion_desde + resumen.data.sin_sesion_desde.length : -1)

        const errores = await useRed().eventos({ router_id: 1, resultado: 'error' })
        expect(errores.ok && errores.data.data.map(e => e.id)).toEqual([3, 1])
    })

    it('pantalla sin fecha: lo dice, no cuenta, y muestra los fallos de red de los últimos 7 días', async () => {
        const wrapper = await mountSuspended(conApp, { route: '/routers/migracion?router=1' })
        await esperar(() => expect(dato(wrapper, 'migracion-aaa-desde')).toBe('Sin marcar'))
        expect(dato(wrapper, 'migracion-sin-fecha')).toContain('Marca desde cuándo')
        expect(dato(wrapper, 'migracion-pendientes')).toBeNull()
        expect(dato(wrapper, 'migracion-eventos')).toContain('Fallos de red de los últimos 7 días')
        wrapper.unmount()
    })

    it('marcar desde la pantalla guarda la fecha y aparecen los números del resumen', async () => {
        const wrapper = await mountSuspended(conApp, { route: '/routers/migracion?router=1' })
        await esperar(() => expect(wrapper.find('[data-prueba="abrir-marcar-migrado"]').exists()).toBe(true))
        await wrapper.get('[data-prueba="abrir-marcar-migrado"]').trigger('click')
        await esperar(() => expect(document.body.querySelector('[data-prueba="marcar-motivo"]')).not.toBeNull())
        const motivo = document.body.querySelector<HTMLTextAreaElement>('[data-prueba="marcar-motivo"] textarea, textarea[data-prueba="marcar-motivo"]')
        expect(motivo).not.toBeNull()
        if (motivo) {
            motivo.value = 'Cambio de RADIUS del piloto'
            motivo.dispatchEvent(new Event('input'))
        }
        document.body.querySelector<HTMLButtonElement>('[data-prueba="marcar-guardar"]')?.click()
        await esperar(() => expect(bd.migracionesAaa[1]?.aaa_desde).toBeTruthy())
        await esperar(() => expect(dato(wrapper, 'migracion-servicios')).not.toBeNull())
        const resumen = await useRouters().resumenSesiones(1)
        expect(dato(wrapper, 'migracion-pendientes')).toBe(String(resumen.ok ? resumen.data.sin_sesion_desde.length : -1))
        expect(dato(wrapper, 'migracion-eventos')).toContain('Fallos de red desde el cambio')
        wrapper.unmount()
    })

    it('si el resumen falla: error con "Reintentar" y sin números', async () => {
        bd.migracionesAaa[1] = { router_id: 1, aaa_desde: '2026-10-10T06:00:00.000Z', motivo: 'x', version: 1, updated_at: '2026-10-10T06:00:00.000Z', primer_accounting: null }
        simularFalla('GET /api/v1/routers/:id/resumen-sesiones', 501)
        const wrapper = await mountSuspended(conApp, { route: '/routers/migracion?router=1' })
        await esperar(() => expect(wrapper.text()).toContain('Reintentar'))
        expect(dato(wrapper, 'migracion-servicios')).toBeNull()
        expect(dato(wrapper, 'migracion-pendientes')).toBeNull()
        wrapper.unmount()
    })

    it('sin sesiones.ver, red.ver ni routers.marcar_migrado: lo dice y no ofrece marcar', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => !['sesiones.ver', 'red.ver', 'routers.marcar_migrado'].includes(p)) }
        bd.migracionesAaa[1] = { router_id: 1, aaa_desde: '2026-10-10T06:00:00.000Z', motivo: 'x', version: 1, updated_at: '2026-10-10T06:00:00.000Z', primer_accounting: null }
        const wrapper = await mountSuspended(conApp, { route: '/routers/migracion?router=1' })
        await esperar(() => expect(wrapper.text()).toContain('Sin permiso sesiones.ver'))
        expect(wrapper.text()).toContain('Sin permiso red.ver')
        expect(wrapper.find('[data-prueba="abrir-marcar-migrado"]').exists()).toBe(false)
        expect(dato(wrapper, 'migracion-servicios')).toBeNull()
        wrapper.unmount()
    })
})
