import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { MATRIZ } from '~~/fixtures/routers/estrategias'
import { estrategiaSimple } from '~~/fixtures/routers/estrategiasDatos'
import { UApp } from '#components'
import EstrategiaVelocidadEditor from '~/components/EstrategiaVelocidadEditor.vue'
import EstrategiaVelocidadModal from '~/components/EstrategiaVelocidadModal.vue'
import SincronizarPlanModal from '~/components/SincronizarPlanModal.vue'
import RouterChequeoCorte from '~/components/RouterChequeoCorte.vue'
import RouterReconciliarModal from '~/components/RouterReconciliarModal.vue'
import type { EstrategiasRouter } from '~/types/controlVelocidad'
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

    const router = (id: number) => structuredClone(bd.routers.find(r => r.id === id)!)
    const simple = () => estrategiaSimple()
    const enBody = (prueba: string) => document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)

    it('fixtures como la API: estrategia y versión en cada router, matriz con atajos, excepción en la implementación', () => {
        expect(bd.routers.map(r => [r.id, r.estrategia_velocidad.pppoe.aplicacion, r.routeros_version])).toEqual([
            [1, 'radius_rate_limit', '7.24.5 (stable)'],
            [2, 'arbol_pcq', '6.49.10 (long-term)'],
            [3, 'radius_rate_limit', null],
        ])
        expect(MATRIZ.atajos.simple).toEqual(bd.routers[0]?.estrategia_velocidad)
        expect(MATRIZ.atajos.arbol_pcq).toEqual(bd.routers[1]?.estrategia_velocidad)
        expect(MATRIZ.tipos_cola.find(t => t.valor === 'cake')?.routeros_minimo).toBe('7')
        expect(MATRIZ.aplicaciones.find(a => a.valor === 'pcq_plan')).toMatchObject({ familia: 'simple', coa_en_vivo: false, tipos_cola: ['pcq'] })
        expect(bd.implementacionesPlan.every(i => i.estrategia_velocidad === null)).toBe(true)
    })

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
        expect(cambio.ok && cambio.data.estrategia_velocidad.pppoe.tipo_cola).toBe('cake')
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
        expect(bd.routers[0]?.estrategia_velocidad.pppoe.tipo_cola).toBe('cake')
    })

    it('excepción del plan en el router: hereda lo que no fija y null vuelve a heredar todo', async () => {
        const cv = useControlVelocidad()
        const version = () => bd.implementacionesPlan.find(i => i.plan_id === 1 && i.router_id === 1)?.version ?? 0
        // Vista previa del plan: `planes[]` como el validador de la API, y la excepción que cambia en `planes`.
        const previa = await cv.vistaPrevia(1, { planes: [{ plan_id: 1, estrategia_velocidad: { pppoe: { tipo_cola: 'sfq' } } }] })
        expect(previa.ok && previa.data.planes).toEqual([{ plan_id: 1, de: null, a: { pppoe: { tipo_cola: 'sfq' } } }])
        const invalidaPlan = await cv.vistaPrevia(1, { planes: [{ plan_id: 1, estrategia_velocidad: { pppoe: { tipo_cola: 'pcq' } } }] })
        expect(!invalidaPlan.ok && invalidaPlan.problema.errors?.[0]).toMatchObject({ field: 'planes.1.pppoe.tipo_cola', rule: 'tipo_cola' })

        const guardada = await cv.cambiarPlan(1, 1, { version: version(), estrategia_velocidad: { pppoe: { tipo_cola: 'sfq' } } })
        expect(guardada.ok && guardada.data.estrategia_velocidad).toEqual({ pppoe: { tipo_cola: 'sfq' } })
        const mala = await cv.cambiarPlan(1, 1, { version: version(), estrategia_velocidad: { ip_estatica: { aplicacion: 'radius_rate_limit' } } })
        expect(!mala.ok && mala.problema.errors?.[0]?.field).toBe('estrategia_velocidad.ip_estatica.aplicacion')
        const sinVersion = await cv.cambiarPlan(1, 1, { estrategia_velocidad: null })
        expect(!sinVersion.ok && sinVersion.problema.errors?.[0]?.field).toBe('version')
        await cv.cambiarPlan(1, 1, { version: version(), estrategia_velocidad: null })
        expect(bd.implementacionesPlan.find(i => i.plan_id === 1 && i.router_id === 1)?.estrategia_velocidad).toBeNull()

        // Un plan global sin implementación en el router: sin `version`, la API crea la fila con la estrategia.
        const nueva = await cv.cambiarPlan(2, 1, { estrategia_velocidad: { pppoe: { tipo_cola: 'fq_codel' } } })
        expect(nueva.ok && nueva.data).toMatchObject({ plan_id: 2, router_id: 1, estrategia_velocidad: { pppoe: { tipo_cola: 'fq_codel' } } })
    })

    it('sincronizar plan: resumen por router y el router caído con su error, sin hacer fallar a los demás', async () => {
        bd.routersSinRespuesta = [2]
        const plan = bd.planes.find(p => p.id === 1)!
        const vista = await mountSuspended(SincronizarPlanModal, { props: { plan, open: false } })
        await vista.setProps({ open: true })
        await esperar(() => expect(document.body.querySelector('[data-prueba="sincronizar-confirmar"]')).not.toBeNull())
        document.body.querySelector<HTMLButtonElement>('[data-prueba="sincronizar-confirmar"]')!.click()
        await esperar(() => expect(document.body.querySelector('[data-prueba="sincronizar-resumen"]')).not.toBeNull())
        expect(document.body.querySelector('[data-prueba="sincronizar-resumen"]')?.textContent).toContain('un router con error')
        expect(document.body.querySelector('[data-router="2"]')?.closest('tr')?.textContent).toContain('no respondió')
        expect(document.body.querySelector('[data-router="1"]')?.closest('tr')?.textContent).toContain('Al día')
        // RB-Bodega no tiene API: `reconciliado: false`, sin inventar un «Al día».
        expect(enBody('sin-api-3')?.textContent).toContain('Solo RADIUS')
        bd.routersSinRespuesta = []
        enBody('reintentar-router-2')?.click()
        await esperar(() => expect(document.body.querySelector('[data-router="2"]')?.closest('tr')?.textContent).toContain('Al día'))
    })

    it('reconciliar ahora: vista previa por grupo, confirmar y quedar sin cambios', async () => {
        const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(RouterReconciliarModal, { router: { id: 1, nombre: 'RB-Centro' }, open: true }) }) })
        await mountSuspended(conApp)
        await esperar(() => expect(enBody('reconciliar-menus')).not.toBeNull())
        expect(enBody('reconciliar-grupo-corte')?.textContent).toContain('argosisp:top corte')
        expect(enBody('reconciliar-grupo-velocidad')?.textContent).toContain('argosisp:plan:2')
        enBody('reconciliar-confirmar')?.click()
        await esperar(() => expect(enBody('reconciliar-resultado')?.textContent).toContain('4 objetos corregidos'))
        expect(bd.acciones.at(-1)).toMatchObject({ accion: 'routeros.reconciliar' })
        const despues = await useControlVelocidad().vistaPreviaReconciliar(1)
        expect(despues.ok && despues.data.cambios).toEqual([])
    })

    it('reconciliar ahora: el router sin API o que no responde muestra el error de la API, sin confirmar', async () => {
        bd.routersSinRespuesta = [2]
        const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(RouterReconciliarModal, { router: { id: 2, nombre: 'CCR-Mixco' }, open: true }) }) })
        await mountSuspended(conApp)
        await esperar(() => expect(enBody('reconciliar-sin-lectura')).not.toBeNull())
        expect(enBody('reconciliar-sin-lectura')?.textContent).toContain('no respondió')
        expect(enBody('reconciliar-sin-lectura')?.textContent).toContain('Reintentar')
        expect(enBody('reconciliar-confirmar')?.hasAttribute('disabled')).toBe(true)
    })

    it('probar el corte: cada problema con su paso a seguir; «Reconciliar ahora» lo deja listo', async () => {
        const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(RouterChequeoCorte, { router: { id: 1, nombre: 'RB-Centro' } }) }) })
        const vista = await mountSuspended(conApp)
        await vista.find('[data-prueba="probar-corte"]').trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="corte-faltan_reglas"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="corte-faltan_reglas"]').text()).toContain('Reconciliar ahora» lo deja como debe estar')
        expect(vista.find('[data-prueba="corte-reglas_desordenadas"]').exists()).toBe(true)
        await vista.find('[data-prueba="corte-reconciliar"]').trigger('click')
        await esperar(() => expect(enBody('reconciliar-confirmar')?.hasAttribute('disabled')).toBe(false))
        enBody('reconciliar-confirmar')?.click()
        await esperar(() => expect(vista.find('[data-prueba="corte-ok"]').exists()).toBe(true))

        const mixco = await useControlVelocidad().diagnosticoCorte(2)
        expect(mixco.ok && mixco.data.problemas).toEqual([expect.objectContaining({ codigo: 'portal_inalcanzable', reconciliar: false })])
        const bodega = await useControlVelocidad().diagnosticoCorte(3)
        expect(bodega.ok && bodega.data.problemas[0]?.codigo).toBe('sin_api')
    })

    it('probar el corte: si la API falla se ve el error con «Reintentar», sin un «listo» inventado', async () => {
        simularFalla('GET /api/v1/routers/:id/diagnostico-corte', 500)
        const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(RouterChequeoCorte, { router: { id: 1, nombre: 'RB-Centro' } }) }) })
        const vista = await mountSuspended(conApp)
        await vista.find('[data-prueba="probar-corte"]').trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="corte-error"]').exists()).toBe(true))
        expect(vista.text()).toContain('Reintentar')
        expect(vista.find('[data-prueba="corte-ok"]').exists()).toBe(false)
    })

    it('sincronizar pide planes.sincronizar', async () => {
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        const sinPermiso = await useControlVelocidad().sincronizar(1, null, nuevaClaveIdempotencia())
        expect(!sinPermiso.ok && sinPermiso.problema.status).toBe(403)
    })
})
