import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Schema } from '@argosisp/contracts'
import { UApp } from '#components'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import PaginaServicio from '~/pages/servicios/[id].vue'
import ClienteEstadoCuenta from '~/components/ClienteEstadoCuenta.vue'
import LineaTiempoBitacora from '~/components/LineaTiempoBitacora.vue'
import PaginacionCursor from '~/components/PaginacionCursor.vue'
import { esperar } from '../ayudas/esperar'

type Accion = Schema<'AccionAuditoria'>

const BASE: Accion = {
    id: 1,
    actor_tipo: 'sistema',
    actor_id: null,
    actor_nombre: null,
    canal: 'cron',
    accion: 'servicios.cambiar_estado',
    entidad_tipo: 'servicio',
    entidad_id: 4,
    entrada: { servicioId: 4, nuevo: 'suspendido', motivo: 'Facturas vencidas' },
    resultado: 'ok',
    error: null,
    request_id: 'req-1',
    empresa_id: 1,
    empresa_nombre: 'ArgosIsp',
    created_at: '2026-10-11T14:00:00Z',
}

describe('fallos de las capturas 06 y 07', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
    })

    it('captura 06: con el estado de cuenta en 501 solo se ve el aviso y "Reintentar"', async () => {
        simularFalla('GET /api/v1/clientes/:id/estado-cuenta', 501)
        const wrapper = await mountSuspended(ClienteEstadoCuenta, { props: { clienteId: 12 } })
        await esperar(() => expect(wrapper.text()).toContain('Reintentar'))

        const texto = wrapper.text()
        expect(texto).toContain('Operación no disponible')
        expect(texto).not.toContain('Al día')
        expect(texto).not.toContain('Q 0.00')
        expect(texto).not.toContain('Saldo')
        expect(texto).not.toContain('Movimientos')
        expect(wrapper.findAll('table')).toHaveLength(0)
    })

    it('captura 06: al reintentar con la API sana aparece el saldo real', async () => {
        simularFalla('GET /api/v1/clientes/:id/estado-cuenta', 501)
        const wrapper = await mountSuspended(ClienteEstadoCuenta, { props: { clienteId: 12 } })
        await esperar(() => expect(wrapper.text()).toContain('Reintentar'))

        reiniciarFixtures()
        const boton = wrapper.findAll('button').find(b => b.text().includes('Reintentar'))
        await boton?.trigger('click')
        await esperar(() => expect(wrapper.text()).toContain('Saldo'))
        expect(wrapper.text()).not.toContain('Reintentar')
        expect(wrapper.text()).toMatch(/Q [\d,]+\.\d{2}/)
    })

    it('captura 07: la línea de tiempo oculta portal.quien_soy y traduce las acciones', async () => {
        // Cliente 2: su servicio está suspendido y tiene visitas a /corte en la bitácora.
        const servicio = (await useServicios().listar({ cliente_id: 2 }))
        const ids = servicio.ok ? servicio.data.data.map(s => s.id) : []
        expect(ids.length).toBeGreaterThan(0)

        const todas = await useBitacora().acciones({ cliente_id: 2, limit: 200 })
        expect(todas.ok && todas.data.data.some(a => a.accion === 'portal.quien_soy')).toBe(true)

        const wrapper = await mountSuspended(LineaTiempoBitacora, { props: { filtros: { cliente_id: 2, excluir_canal: 'portal' } } })
        await esperar(() => expect(wrapper.text()).toContain('Servicio creado'))

        const texto = wrapper.text()
        expect(texto).toContain('Ana Administradora')
        expect(texto).not.toContain('Usuario #1')
        expect(texto).not.toContain('quien_soy')
        expect(texto).not.toContain('Consulta desde la página de corte')
        expect(texto).toContain('Servicio suspendido')
        expect(texto).not.toMatch(/servicios\.[a-z_]+/)
        expect(texto).toContain('Automático')
    })

    it('captura 07: toda acción que declara la API tiene texto en español', () => {
        // Mismo criterio que scripts/verificar-permisos.mjs: se leen las fuentes de apps/api.
        const raiz = [resolve(process.cwd(), '../api/app'), resolve(process.cwd(), 'apps/api/app')].find(ruta => existsSync(ruta)) ?? ''
        const archivos = (readdirSync(raiz, { recursive: true }) as string[]).filter(f => f.endsWith('.ts'))
        const declaradas = new Set<string>()
        for (const archivo of archivos) {
            const texto = readFileSync(join(raiz, archivo), 'utf8')
            for (const [, nombre] of texto.matchAll(/(?:readonly\s+nombre|accion)\s*=\s*'([a-z_0-9]+\.[a-z_0-9]+)'/g)) {
                if (nombre) {
                    declaradas.add(nombre)
                }
            }
        }
        expect(declaradas.size).toBeGreaterThan(90)
        const sinTexto = [...declaradas].filter(nombre => !ACCIONES_TRADUCIDAS.has(nombre)).sort()
        expect(sinTexto).toEqual([])
        for (const nombre of declaradas) {
            expect(tituloAccion({ ...BASE, accion: nombre, entrada: {} })).not.toBe(nombre)
        }
    })

    it('captura 07: la ficha del servicio no queda vacía con 60 visitas a /corte', async () => {
        const suspendidos = await useServicios().listar({ estado: 'suspendido' })
        const servicio = suspendidos.ok ? suspendidos.data.data[0] : undefined
        expect(servicio).toBeDefined()
        if (!servicio) {
            return
        }
        // Más visitas que la página de la línea de tiempo (50): antes solo se veía "Ver más".
        for (let visita = 0; visita < 60; visita++) {
            bd.acciones.push({ ...BASE, id: 10_000 + visita, canal: 'portal', accion: 'portal.quien_soy', entidad_id: servicio.id, entrada: { ip: servicio.ipv4 }, created_at: '2026-10-16T12:00:00Z' })
        }
        useUsuarioActual().value = meAdmin
        // La ficha usa `UTooltip`: necesita el `TooltipProvider` de `UApp`, como en la app real.
        const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(PaginaServicio) }) })
        const wrapper = await mountSuspended(conApp, { route: `/servicios/${servicio.id}` })
        await esperar(() => expect(wrapper.text()).toContain('Servicio creado'))
        expect(wrapper.text()).not.toContain('Consulta desde la página de corte')
        expect(wrapper.text()).not.toContain('portal.quien_soy')
        wrapper.unmount()
        useUsuarioActual().value = null
    })

    it('títulos, canal y visibilidad de la bitácora', () => {
        expect(tituloAccion(BASE)).toBe('Servicio suspendido')
        expect(tituloAccion({ ...BASE, entrada: { nuevo: 'activo' } })).toBe('Servicio activo')
        expect(tituloAccion({ ...BASE, entrada: {} })).toBe('Estado del servicio cambiado')
        expect(tituloAccion({ ...BASE, accion: 'pagos.registrar' })).toBe('Pago registrado')
        expect(tituloAccion({ ...BASE, accion: 'algo.nuevo' })).toBe('algo.nuevo')
        expect(iconoAccion(BASE)).toBe('i-lucide-circle-x')

        expect(visibleEnLineaTiempo({ ...BASE, accion: 'portal.quien_soy', canal: 'portal' })).toBe(false)
        expect(visibleEnLineaTiempo(BASE)).toBe(true)

        expect(etiquetaCanal('cron')).toBe('Automático')
        expect(etiquetaCanal('panel')).toBe('Panel')
        expect(etiquetaCanal('otro')).toBe('otro')
    })
})

describe('paginación por cursor', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
    })

    function botones(wrapper: VueWrapper) {
        const todos = wrapper.findAll('button')
        const anterior = todos.find(b => b.text().includes('Anterior'))
        const siguiente = todos.find(b => b.text().includes('Siguiente'))
        return {
            anterior: anterior?.attributes('disabled') !== undefined,
            siguiente: siguiente?.attributes('disabled') !== undefined,
        }
    }

    it('deshabilita "Anterior" y "Siguiente" cuando no hay página', async () => {
        const sola = await mountSuspended(PaginacionCursor, { props: { pagina: 1, hayAnterior: false, haySiguiente: false } })
        expect(botones(sola)).toEqual({ anterior: true, siguiente: true })

        const primera = await mountSuspended(PaginacionCursor, { props: { pagina: 1, hayAnterior: false, haySiguiente: true } })
        expect(botones(primera)).toEqual({ anterior: true, siguiente: false })

        const ultima = await mountSuspended(PaginacionCursor, { props: { pagina: 3, hayAnterior: true, haySiguiente: false } })
        expect(botones(ultima)).toEqual({ anterior: false, siguiente: true })

        const cargando = await mountSuspended(PaginacionCursor, { props: { pagina: 2, hayAnterior: true, haySiguiente: true, cargando: true } })
        expect(botones(cargando)).toEqual({ anterior: true, siguiente: true })
    })

    it('usePaginacionCursor: sin nextCursor no hay siguiente; con error tampoco', async () => {
        const vacia = usePaginacionCursor<number>(async () => ({ ok: true, data: { data: [1], nextCursor: '' } }))
        await vacia.recargar()
        expect(vacia.haySiguiente.value).toBe(false)
        expect(vacia.hayAnterior.value).toBe(false)

        const conError = usePaginacionCursor<number>(async () => ({
            ok: false,
            problema: { type: 'about:blank', title: 'No implementado', status: 501 },
        }))
        await conError.recargar()
        expect(conError.haySiguiente.value).toBe(false)
        expect(conError.hayAnterior.value).toBe(false)
        expect(conError.filas.value).toEqual([])
    })

    it('usePaginacionCursor recorre páginas de servicios y vuelve', async () => {
        const lista = usePaginacionCursor(cursor => useServicios().listar({ limit: 10 }, cursor))
        await lista.recargar()
        expect(lista.haySiguiente.value).toBe(true)
        expect(lista.hayAnterior.value).toBe(false)
        const primera = lista.filas.value.map(s => s.id)

        await lista.siguiente()
        expect(lista.pagina.value).toBe(2)
        expect(lista.hayAnterior.value).toBe(true)

        while (lista.haySiguiente.value) {
            await lista.siguiente()
        }
        expect(lista.haySiguiente.value).toBe(false)

        while (lista.hayAnterior.value) {
            await lista.anterior()
        }
        expect(lista.pagina.value).toBe(1)
        expect(lista.filas.value.map(s => s.id)).toEqual(primera)
    })
})
