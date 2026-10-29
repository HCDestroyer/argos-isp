import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { MATRIZ } from '~~/fixtures/routers/estrategias'
import EstrategiaVelocidadEditor from '~/components/EstrategiaVelocidadEditor.vue'
import EstrategiaVelocidadModal from '~/components/EstrategiaVelocidadModal.vue'
import SincronizarPlanModal from '~/components/SincronizarPlanModal.vue'
import type { EstrategiasRouter, RouterConEstrategia } from '~/types/controlVelocidad'
import { esperar } from '../ayudas/esperar'

/** Control de velocidad por capas y sincronizar plan (`contratos/control-velocidad.md`). */
describe('control de velocidad por capas', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    const router = (id: number) => structuredClone(bd.routers.find(r => r.id === id)!) as typeof bd.routers[number] & RouterConEstrategia
    const simple = () => structuredClone(ESTRATEGIAS_MIGRACION.simple)

    it('estrategia efectiva: el plan sobrescribe capa por capa y los extras campo por campo', () => {
        const base = simple().pppoe
        expect(estrategiaEfectiva(base, { tipo_cola: 'cake', extras: { rafaga: false } })).toEqual({ ...base, tipo_cola: 'cake', extras: { ...base.extras, rafaga: false } })
        expect(estrategiaEfectiva(base, null)).toEqual(base)
    })

    it('la matriz deshabilita lo que no combina, con el porqué', () => {
        expect(aplicacionDisponible(MATRIZ, 'cola_simple', 'pppoe')).toEqual({ valida: false, motivo: expect.stringContaining('PPPoE ya crea su cola dinámica') })
        expect(aplicacionDisponible(MATRIZ, 'perfil_ppp', 'ip_estatica').motivo).toContain('sin sesión PPP no hay perfil')
        expect(aplicacionDisponible(MATRIZ, 'pcq_plan', 'dhcp_fija').valida).toBe(true)
        expect(tipoColaDisponible(MATRIZ, 'cake', 'radius_rate_limit', '6.49.10 (long-term)')).toEqual({ valida: false, motivo: 'Requiere RouterOS 7; este router tiene 6.49.10 (long-term).' })
        expect(tipoColaDisponible(MATRIZ, 'cake', 'radius_rate_limit', null)).toMatchObject({ valida: true, motivo: expect.stringContaining('no se conoce') })
        expect(tipoColaDisponible(MATRIZ, 'sfq', 'arbol_pcq', '7.24.5').motivo).toContain('necesita PCQ')
        expect(tipoColaDisponible(MATRIZ, 'pcq', 'cola_simple', '7.24.5').motivo).toContain('en la cola de uno solo no sirve')
    })

    it('«igual para todos» copia la estrategia y la ajusta a lo que admite cada tipo', () => {
        const estrategias = simple()
        estrategias.pppoe = { ...estrategias.pppoe, tipo_cola: 'cake', padre: 'por_router' }
        const todas = igualParaTodos(MATRIZ, 'pppoe', estrategias, '7.24.5')
        expect(todas.ip_estatica).toMatchObject({ aplicacion: 'cola_simple', padre: 'por_router', tipo_cola: 'cake' })
        expect(todas.dhcp_fija.aplicacion).toBe('cola_simple')
    })

    it('el editor explica cada opción y deshabilita CAKE en RouterOS 6 con el motivo', async () => {
        const estrategias = ref<EstrategiasRouter>(simple())
        const vista = await mountSuspended(EstrategiaVelocidadEditor, { props: { matriz: MATRIZ, version: '6.49.10 (long-term)', router: simple(), estrategias: estrategias.value } })
        const texto = vista.text()
        expect(texto).toContain('La velocidad viaja con la sesión PPPoE')
        expect(texto).toContain('Ejemplo:')
        expect(texto).toContain('No disponible: PPPoE ya crea su cola dinámica')
        expect(texto).toContain('No disponible: Requiere RouterOS 7; este router tiene 6.49.10 (long-term).')
        expect(texto).toContain('Reduce la latencia bajo carga')
        expect(vista.find('[data-prueba="igual-para-todos"]').exists()).toBe(true)
    })

    it('API: vista previa, combinación inválida con la capa, versión y 409', async () => {
        const cv = useControlVelocidad()
        const conCake = simple()
        conCake.pppoe.tipo_cola = 'cake'
        const previa = await cv.vistaPrevia(1, { estrategia_velocidad: conCake })
        expect(previa.ok && previa.data).toMatchObject({ valida: true, orden: ['preparar', 'lotes', 'terminar'] })
        expect(previa.ok && previa.data.crear.some(o => o.nombre === 'argosisp-cake')).toBe(true)

        const mala = simple()
        mala.ip_estatica.aplicacion = 'perfil_ppp'
        const invalida = await cv.vistaPrevia(1, { estrategia_velocidad: mala })
        expect(!invalida.ok && invalida.problema.errors?.[0]).toMatchObject({ field: 'estrategia_velocidad.ip_estatica.aplicacion', rule: 'aplicacion_tipo' })

        const enSeis = await cv.vistaPrevia(2, { estrategia_velocidad: conCake })
        expect(!enSeis.ok && enSeis.problema.errors?.map(e => e.rule)).toContain('version')

        const cambio = await cv.cambiarRouter(1, { version: 1, estrategia_velocidad: conCake, motivo: 'Latencia' })
        expect(cambio.ok && (cambio.data as RouterConEstrategia).estrategia_velocidad?.pppoe.tipo_cola).toBe('cake')
        const viejo = await cv.cambiarRouter(1, { version: 1, estrategia_velocidad: conCake })
        expect(!viejo.ok && viejo.problema.status).toBe(409)
    })

    it('el modal revisa antes de aplicar y avisa de las sesiones que conservan lo anterior', async () => {
        const vista = await mountSuspended(EstrategiaVelocidadModal, { props: { router: router(1), open: true } })
        await esperar(() => expect(document.body.querySelector('[data-prueba="capa-tipo-cola"]')).not.toBeNull())
        const cake = document.body.querySelector<HTMLElement>('[data-prueba="capa-tipo-cola"] [value="cake"]')
        expect(cake).not.toBeNull()
        cake!.click()
        await esperar(() => expect(document.body.querySelector<HTMLButtonElement>('[data-prueba="revisar-estrategia"]')?.disabled).toBe(false))
        document.body.querySelector<HTMLButtonElement>('[data-prueba="revisar-estrategia"]')!.click()
        await esperar(() => expect(document.body.querySelector('[data-prueba="vista-previa-estrategia"]')).not.toBeNull())
        expect(document.body.querySelector('[data-prueba="previa-crear"]')?.textContent).toContain('argosisp-cake')
        if (Number(document.body.querySelector('[data-prueba="previa-conservan"]')?.textContent) > 0) {
            expect(document.body.querySelector('[data-prueba="aviso-conservan"]')?.textContent).toContain('hasta reconectar')
        }
        document.body.querySelector<HTMLButtonElement>('[data-prueba="aplicar-estrategia"]')!.click()
        await esperar(() => expect(vista.emitted('actualizado')).toHaveLength(1))
        expect((bd.routers[0] as RouterConEstrategia).estrategia_velocidad?.pppoe.tipo_cola).toBe('cake')
    })

    it('excepción del plan en el router: hereda lo que no fija y null vuelve a heredar todo', async () => {
        const cv = useControlVelocidad()
        const version = () => bd.implementacionesPlan.find(i => i.plan_id === 1 && i.router_id === 1)?.version ?? 0
        const guardada = await cv.cambiarPlan(1, 1, { version: version(), estrategia_velocidad: { pppoe: { tipo_cola: 'sfq' } } })
        expect(guardada.ok).toBe(true)
        expect(bd.estrategiasPlanes['1:1']).toEqual({ pppoe: { tipo_cola: 'sfq' } })
        const mala = await cv.cambiarPlan(1, 1, { version: version(), estrategia_velocidad: { ip_estatica: { aplicacion: 'radius_rate_limit' } } })
        expect(!mala.ok && mala.problema.errors?.[0]?.field).toBe('estrategia_velocidad.ip_estatica.aplicacion')
        await cv.cambiarPlan(1, 1, { version: version(), estrategia_velocidad: null })
        expect(bd.estrategiasPlanes['1:1']).toBeUndefined()
    })

    it('sincronizar plan: resumen por router y el router caído con su error, sin hacer fallar a los demás', async () => {
        const plan = bd.planes.find(p => p.id === 1)!
        const vista = await mountSuspended(SincronizarPlanModal, { props: { plan, open: false } })
        await vista.setProps({ open: true })
        await esperar(() => expect(document.body.querySelector('[data-prueba="sincronizar-confirmar"]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-prueba="sincronizar-confirmar"]')!.click()
        await esperar(() => expect(document.body.querySelector('[data-prueba="sincronizar-resumen"]')).not.toBeNull())
        expect(document.body.querySelector('[data-prueba="sincronizar-resumen"]')?.textContent).toContain('un router con error')
        expect(document.body.querySelector('[data-router="3"]')?.closest('tr')?.textContent).toContain('no respondió')
        expect(document.body.querySelector('[data-router="1"]')?.closest('tr')?.textContent).toContain('Al día')
        expect(document.body.querySelector('[data-prueba="reintentar-router-3"]')).not.toBeNull()
    })

    it('sincronizar pide planes.sincronizar', async () => {
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const sinPermiso = await useControlVelocidad().sincronizar(1, null, nuevaClaveIdempotencia())
        expect(!sinPermiso.ok && sinPermiso.problema.status).toBe(403)
    })
})
