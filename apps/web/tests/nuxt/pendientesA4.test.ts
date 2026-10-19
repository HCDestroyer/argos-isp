import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import PaginaBitacora from '~/pages/bitacora/index.vue'
import { esperar } from '../ayudas/esperar'

/** Pendientes de `a4.md` resueltos en el día 4 (red del alta, plantilla del técnico, bitácora). */
describe('pendientes de A4', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    function salida(cambios: Partial<EntradaServicio> = {}): SalidaServicio {
        const resultado = esquemaServicio.safeParse({
            ...entradaServicioVacia(14),
            router_id: 1,
            plan_id: 2,
            user_ppp: 'claudia.marisol1234',
            pass_ppp: 'Clave2345x',
            plantilla_facturacion_id: 1,
            ...cambios,
        })
        if (!resultado.success) {
            throw new Error(resultado.error.message)
        }
        return resultado.data
    }

    it('el alta manda red_ipv4_id solo si se eligió una red', () => {
        expect('red_ipv4_id' in cuerpoServicio(salida())).toBe(false)
        expect(cuerpoServicio(salida({ red_id: 2 })).red_ipv4_id).toBe(2)
        expect(cuerpoServicio(salida({ asignacion: 'fija', red_id: 1, ipv4: '100.64.10.200' }))).toMatchObject({ ipv4: '100.64.10.200', red_ipv4_id: 1 })
    })

    it('sin plantillas.ver se omite plantilla_facturacion_id (null sería "sin plantilla")', () => {
        expect(cuerpoServicio(salida(), { omitirPlantilla: true })).not.toHaveProperty('plantilla_facturacion_id')
        expect(cuerpoServicio(salida({ plantilla_facturacion_id: null }))).toHaveProperty('plantilla_facturacion_id', null)
    })

    it('la API (fixtures) rechaza una red de otro router en red_ipv4_id', async () => {
        const redes = await useRouters().redesIpv4(2)
        const ajena = redes.ok ? redes.data[0]?.id : undefined
        expect(ajena).toBeDefined()
        const creado = await useServicios().crear({ ...cuerpoServicio(salida()), red_ipv4_id: ajena }, nuevaClaveIdempotencia())
        expect(!creado.ok && creado.problema.errors?.[0]?.field).toBe('red_ipv4_id')
    })

    it('el cajero tiene zonas.ver y los permisos de comprobantes, como el seed', () => {
        expect(meCajero.permisos).toEqual(expect.arrayContaining(['zonas.ver', 'cuentas_bancarias.ver', 'comprobantes.ver']))
        expect(meCajero.permisos).not.toContain('routers.ver')
    })

    it('los nombres viejos de audit.cambios se muestran con el actual', async () => {
        expect(nombreCampoCambio('ipv_4')).toBe('ipv4')
        expect(nombreCampoCambio('prefijo_enlace_v_6')).toBe('prefijo_enlace_v6')
        expect(nombreCampoCambio('prefijo_delegado_v_6')).toBe('prefijo_delegado_v6')
        expect(nombreCampoCambio('red_ipv_4_id')).toBe('red_ipv4_id')
        expect(nombreCampoCambio('pool_ipv_6_delegacion')).toBe('pool_ipv6_delegacion')
        expect(nombreCampoCambio('facturas_para_cortar')).toBe('facturas_para_cortar')

        const vista = await mountSuspended(PaginaBitacora, { route: '/bitacora?tab=cambios&tipo=servicio&entidad=1' })
        await esperar(() => expect(vista.find('[data-campo="ipv4"]').exists()).toBe(true))
        expect(vista.text()).not.toContain('ipv_4')
        expect(vista.text()).toContain('prefijo_enlace_v6')
    })
})
