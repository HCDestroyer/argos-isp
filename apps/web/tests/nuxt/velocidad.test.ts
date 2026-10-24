import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import PlanFormulario from '~/components/PlanFormulario.vue'
import RouterVelocidad from '~/components/RouterVelocidad.vue'
import type { VelocidadPlan } from '~~/fixtures/planes/velocidad'
import { formatoKbps, garantizadoKbps, rateLimitServicio, vistaPreviaVelocidad } from '~~/fixtures/planes/velocidad'
import { esperar } from '../ayudas/esperar'

function plan(extra: Partial<VelocidadPlan> = {}): VelocidadPlan {
    return { bajada_kbps: 20000, subida_kbps: 5000, bajada_limitada_kbps: 2048, subida_limitada_kbps: 1024, ...VELOCIDAD_POR_DEFECTO, ...extra }
}

describe('semana 2 · formularios de velocidad', () => {
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

    // La simulación de los fixtures con los mismos casos que `apps/api/tests/network/velocidad.spec.ts`
    // (A1). El panel ya no usa estas fórmulas: la pantalla muestra lo que responde la API.
    it('fixtures: rate-limit idéntico al de network/velocidad.ts', () => {
        expect(formatoKbps(0)).toBe('0')
        expect(formatoKbps(1500)).toBe('1500k')
        expect(formatoKbps(20000)).toBe('20M')
        expect(rateLimitServicio(plan(), 'activo')).toBe('5M/20M 0/0 0/0 0/0 8 5M/20M')
        expect(rateLimitServicio(plan({ reuso: 4 }), 'activo')).toBe('5M/20M 0/0 0/0 0/0 8 1250k/5M')
        expect(rateLimitServicio(plan({ reuso: 3 }), 'activo')).toBe('5M/20M 0/0 0/0 0/0 8 1666k/6666k')
        expect(garantizadoKbps(20000, { reuso: 3, garantizado_pct: 33.33 })).toBe(6666)
        expect(rateLimitServicio(plan({ garantizado_pct: 25 }), 'activo')).toBe('5M/20M 0/0 0/0 0/0 8 1250k/5M')
        expect(rateLimitServicio(plan({ rafaga_bajada_kbps: 30000, rafaga_subida_kbps: 8000, prioridad: 2, reuso: 2 }), 'activo')).toBe('5M/20M 8M/30M 3750k/15M 16/16 2 2500k/10M')
        expect(rateLimitServicio(plan({ rafaga_bajada_kbps: 25000, rafaga_umbral_pct: 80, rafaga_segundos: 8 }), 'activo')).toBe('5M/20M 0/25M 0/16M 0/8 8 5M/20M')
        expect(rateLimitServicio(plan({ subida_kbps: 1001, bajada_kbps: 1500, rafaga_subida_kbps: 2000, rafaga_bajada_kbps: 3000 }), 'activo')).toBe('1001k/1500k 2M/3M 750k/1125k 16/16 8 1001k/1500k')
        expect(rateLimitServicio(plan({ rafaga_bajada_kbps: 30000, rafaga_subida_kbps: 8000, prioridad: 3, reuso: 2 }), 'limitado')).toBe('1024k/2048k 0/0 0/0 0/0 3 512k/1024k')
        expect(rateLimitServicio(plan(), 'suspendido')).toBe(rateLimitServicio(plan(), 'limitado'))
        expect(vistaPreviaVelocidad(plan(), 3).padre.max_limit).toBe('15M/60M')
        expect(vistaPreviaVelocidad(plan({ reuso: 4 }), 0).padre.max_limit).toBe('1250k/5M')
    })

    it('el esquema solo valida campos; las reglas cruzadas las responde la vista previa (422)', async () => {
        const base = { ...entradaPlanVacia(), nombre: 'Hogar', precio: '175.00' }
        expect(esquemaPlan.safeParse(base).success).toBe(true)
        // Sin copia de `validarVelocidad`: CIR por encima de 100 / reuso pasa el esquema…
        expect(esquemaPlan.safeParse({ ...base, reuso: 4, garantia_automatica: false, garantizado_pct: 50 }).success).toBe(true)
        // …y la API lo rechaza en su campo.
        const cuerpo = cuerpoVistaPrevia({ ...base, reuso: 4, garantia_automatica: false, garantizado_pct: 50 }, 20)
        expect(cuerpo).toMatchObject({ reuso: 4, garantizado_pct: 50, activos: 20 })
        const rechazo = cuerpo ? await usePlanes().vistaPrevia(cuerpo) : null
        expect(rechazo && !rechazo.ok && rechazo.problema.errors?.map(e => [e.field, e.message])).toEqual([['garantizado_pct', 'Con reuso 1:4 el garantizado no puede pasar de 25 % (CIR × activos ≤ max-limit del padre)']])
        const bien = await usePlanes().vistaPrevia({ bajada_kbps: 20000, subida_kbps: 5000, bajada_limitada_kbps: 2048, subida_limitada_kbps: 1024, reuso: 2, activos: 3 })
        expect(bien.ok && bien.data).toMatchObject({ rate_limit: '5M/20M 0/0 0/0 0/0 8 2500k/10M', garantizado_pct_efectivo: 50, padre: { max_limit: '7500k/30M', activos: 3 } })
        // Sin números completos o con garantía manual vacía no se pide nada.
        expect(cuerpoVistaPrevia({ ...base, bajada_kbps: null as unknown as number }, 1)).toBeNull()
        expect(cuerpoVistaPrevia({ ...base, garantia_automatica: false, garantizado_pct: null }, 1)).toBeNull()
        const vacia = esquemaPlan.safeParse({ ...base, con_rafaga: true })
        expect(!vacia.success && vacia.error.issues[0]?.message).toBe('Escribe la ráfaga de bajada, de subida o ambas')
        const prioridad = esquemaPlan.safeParse({ ...base, prioridad: 9 })
        expect(!prioridad.success && prioridad.error.issues[0]?.path).toEqual(['prioridad'])
    })

    it('el cuerpo manda null para garantía automática y sin ráfaga', () => {
        const salida = esquemaPlan.parse({ ...entradaPlanVacia(), nombre: 'Hogar', precio: '175', rafaga_bajada_kbps: 30000, garantizado_pct: 40 })
        const cuerpo = cuerpoPlan(salida)
        expect(cuerpo).toMatchObject({ precio: '175.00', garantizado_pct: null, rafaga_bajada_kbps: null, rafaga_subida_kbps: null, prioridad: 8, reuso: 1 })
        expect(cambiosPlan(salida, 3).version).toBe(3)
    })

    it('editar: 422 por campo de la API, 409 con versión vieja', async () => {
        const api = usePlanes()
        const invalido = await api.editar(1, { version: 1, reuso: 4, garantizado_pct: 50 })
        expect(!invalido.ok && invalido.problema.errors?.map(e => e.field)).toEqual(['garantizado_pct'])
        const bien = await api.editar(1, { version: 1, reuso: 4, prioridad: 3 })
        expect(bien.ok && bien.data).toMatchObject({ reuso: 4, prioridad: 3, version: 2 })
        const viejo = await api.editar(1, { version: 1, prioridad: 4 })
        expect(!viejo.ok && viejo.problema.status).toBe(409)
        const duplicado = await api.editar(2, { version: 1, nombre: 'hogar 10 mbps' })
        expect(!duplicado.ok && duplicado.problema.type).toBe('urn:argosisp:problema:plan_duplicado')
    })

    it('el formulario muestra la vista previa con la cadena completa', async () => {
        const planes = await usePlanes().listar()
        const primero = planes.ok ? planes.data.data[0] : undefined
        expect(primero).toBeDefined()
        const wrapper = await mountSuspended(PlanFormulario, { props: { plan: primero, open: true } })
        await esperar(() => expect(document.body.querySelector('[data-prueba="rate-limit-activo"]')?.textContent?.trim()).toBe('5M/10M 0/0 0/0 0/0 8 5M/10M'), { timeout: 3000 })
        expect(document.body.querySelector('[data-prueba="rate-limit-limitado"]')?.textContent?.trim()).toBe('512k/1M 0/0 0/0 0/0 8 512k/1M')
        expect(document.body.querySelector('[data-prueba="vista-padre"]')?.textContent).toContain('max-limit 100M/200M')
        wrapper.unmount()
    })

    it('el formulario muestra el 422 de la vista previa y el error con "Reintentar"', async () => {
        const planes = await usePlanes().listar()
        const primero = planes.ok ? planes.data.data[0] : undefined
        expect(primero).toBeDefined()
        if (!primero) {
            return
        }
        const invalido = await mountSuspended(PlanFormulario, { props: { plan: { ...primero, reuso: 4, garantizado_pct: 50 }, open: true } })
        await esperar(() => expect(document.body.querySelector('[data-prueba="vista-rate-limit-errores"]')?.textContent).toContain('no puede pasar de 25 %'), { timeout: 3000 })
        expect(document.body.querySelector('[data-prueba="rate-limit-activo"]')).toBeNull()
        invalido.unmount()
        document.body.innerHTML = ''

        simularFalla('POST /api/v1/planes/vista-previa', 501)
        const caida = await mountSuspended(PlanFormulario, { props: { plan: primero, open: true } })
        await esperar(() => expect(document.body.textContent).toContain('Reintentar'), { timeout: 3000 })
        expect(document.body.querySelector('[data-prueba="rate-limit-activo"]')).toBeNull()
        caida.unmount()
    })

    it('router: cambia la capacidad con PUT y el modo solo con la acción (409 con versión vieja)', async () => {
        const api = useRouters()
        const capacidad = await api.editar(1, { version: 1, capacidad_bajada_kbps: 1_000_000, capacidad_subida_kbps: 500_000 })
        expect(capacidad.ok && capacidad.data).toMatchObject({ capacidad_bajada_kbps: 1_000_000, version: 2, control_velocidad: 'simple' })
        const viejo = await api.cambiarControlVelocidad(1, { version: 1, control_velocidad: 'arbol_pcq' })
        expect(!viejo.ok && viejo.problema.status).toBe(409)
        const cambio = await api.cambiarControlVelocidad(1, { version: 2, control_velocidad: 'arbol_pcq', motivo: 'Muchos clientes' })
        expect(cambio.ok && cambio.data).toMatchObject({ control_velocidad: 'arbol_pcq', modo_velocidad: 'pcq', version: 3 })
        const efectivos = await api.planes(1)
        expect(efectivos.ok && efectivos.data[0]?.rate_limit).toBe('5M/10M 0/0 0/0 0/0 8 5M/10M')
    })

    it('el panel del router ofrece cambiar el modo solo con routers.cambiar_control_velocidad', async () => {
        const routers = await useRouters().listar()
        const router = routers.ok ? routers.data.data[0] : undefined
        expect(router).toBeDefined()
        if (!router) {
            return
        }
        const admin = await mountSuspended(RouterVelocidad, { props: { router, open: true } })
        await esperar(() => expect(document.body.querySelector('[data-prueba="control-actual"]')?.textContent).toContain('Colas simples'))
        expect(document.body.querySelector('[data-prueba="abrir-cambio-control"]')).not.toBeNull()
        admin.unmount()
        document.body.innerHTML = ''

        useUsuarioActual().value = { ...meCajero, permisos: [...meCajero.permisos, 'routers.ver', 'routers.editar'] }
        const tecnico = await mountSuspended(RouterVelocidad, { props: { router, open: true } })
        await esperar(() => expect(document.body.querySelector('[data-prueba="control-actual"]')).not.toBeNull())
        expect(document.body.querySelector('[data-prueba="abrir-cambio-control"]')).toBeNull()
        expect(document.body.textContent).toContain('Solo un administrador cambia el modo de colas.')
        tecnico.unmount()
    })
})
