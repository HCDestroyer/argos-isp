import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import RoutersDuplicadosAviso from '~/components/RoutersDuplicadosAviso.vue'
import RouterAltaModal from '~/components/RouterAltaModal.vue'
import { esperar } from '../ayudas/esperar'

function enBody(prueba: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)
}

function clic(prueba: string) {
    enBody(prueba)?.click()
}

function montarAviso(routerId?: number) {
    const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(RoutersDuplicadosAviso, { routerId }) }) })
    return mountSuspended(conApp)
}

/** Servicios no retirados del RB-Centro (los que pasarían si quedara el duplicado). */
function noRetiradosDe(routerId: number): number {
    return bd.servicios.filter(s => s.router_id === routerId && s.estado !== 'retirado').length
}

/**
 * Routers duplicados (pedido del PM, `contratos/routers.md` de A1): aviso con el porqué, «Unir» con
 * la simulación de la API y el 409 `router_duplicado` del alta.
 */
describe('routers duplicados y unión', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('el fixture agrupa como la API: misma API y mismo serial, solo routers activos', async () => {
        const api = useRouters()
        const todos = await api.duplicados()
        expect(todos.ok).toBe(true)
        if (!todos.ok) {
            return
        }
        expect(todos.data).toHaveLength(1)
        const [grupo] = todos.data
        expect(grupo?.motivos).toEqual(['api', 'serial'])
        expect(grupo?.claves).toEqual([{ motivo: 'api', valor: '10.10.0.1:443' }, { motivo: 'serial', valor: 'he0812abc9' }])
        expect(grupo?.routers.map(r => r.id)).toEqual([1, 4])
        expect(grupo?.routers[0]).toMatchObject({ servicios_total: noRetiradosDe(1), api_url: null, serial: 'HE0812ABC9', control_velocidad: 'simple' })
        expect(grupo?.routers[0]?.sesiones_abiertas).toBeGreaterThan(0)
        expect(grupo?.routers[1]).toMatchObject({ servicios_total: 0, sesiones_abiertas: 0, control_velocidad: 'arbol_pcq' })

        const deMixco = await api.duplicados(2)
        expect(deMixco.ok && deMixco.data).toEqual([])
        const delDuplicado = await api.duplicados(4)
        expect(delDuplicado.ok && delDuplicado.data.length).toBe(1)
        // Todos los routers del fixture llevan los campos nuevos con el valor por defecto de la API.
        expect(bd.routers.every(r => r.unido_a_id === null && r.serial !== undefined)).toBe(true)
    })

    it('textos del porqué y router sugerido: el de más sesiones abiertas', async () => {
        const resultado = await useRouters().duplicados()
        const grupo = resultado.ok ? resultado.data[0] : undefined
        expect(grupo).toBeDefined()
        if (!grupo) {
            return
        }
        expect(razonesDuplicado(grupo).map(r => r.texto)).toEqual(['Misma dirección de la API (10.10.0.1:443)', 'Mismo número de serie (he0812abc9)'])
        expect(nombresGrupo(grupo.routers)).toBe('«RB-Centro» y «RB-Centro PCQ»')
        expect(routerSugerido(grupo.routers)?.id).toBe(1)
        expect(routerSugerido(grupo.routers, 4)?.id).toBe(4)
    })

    it('alta: 409 router_duplicado por la misma API o la misma nas_ip (también de un router desactivado)', async () => {
        const api = useRouters()
        const mismaApi = await api.crear({ nombre: 'Otra vez', host: '10.10.0.1', nas_ip: '10.99.0.1' })
        expect(!mismaApi.ok && mismaApi.problema).toMatchObject({ status: 409, type: 'urn:argosisp:problema:router_duplicado' })
        expect(!mismaApi.ok && mismaApi.problema.errors?.map(e => e.field)).toEqual(['host', 'host'])
        expect(!mismaApi.ok && mismaApi.problema.detail).toContain('«RB-Centro»')

        const mismoNas = await api.crear({ nombre: 'Bodega 2', host: '10.31.0.1', nas_ip: '10.30.0.1' })
        expect(!mismoNas.ok && mismoNas.problema.errors?.[0]).toMatchObject({ field: 'nas_ip', rule: 'router_duplicado' })
        expect(!mismoNas.ok && mismoNas.problema.errors?.[0]?.message).toContain('desactivado')

        // Un router desactivado con el mismo host no bloquea el alta.
        const bodega = await api.crear({ nombre: 'Bodega nueva', host: '10.30.0.1', nas_ip: '10.30.0.9' })
        expect(bodega.ok && bodega.data).toMatchObject({ serial: null, unido_a_id: null })
    })

    it('edición: 409 al llevar el host o la nas_ip a otro router y 422 al reactivar uno unido', async () => {
        const api = useRouters()
        const host = await api.editar(2, { version: 1, host: '10.10.0.1' })
        expect(!host.ok && host.problema).toMatchObject({ status: 409, type: 'urn:argosisp:problema:router_duplicado' })
        const nas = await api.editar(2, { version: 1, nas_ip: '10.10.0.2' })
        expect(!nas.ok && nas.problema.errors?.[0]?.field).toBe('nas_ip')
        // Editar otra cosa de un duplicado que ya existía no choca: se puede seguir editando hasta unirlo.
        const nombre = await api.editar(4, { version: 1, nombre: 'RB-Centro PCQ (viejo)' })
        expect(nombre.ok).toBe(true)
        await api.unir(1, { version: 1, absorber_id: 4 }, nuevaClaveIdempotencia())
        const reactivar = await api.editar(4, { version: bd.routers.find(r => r.id === 4)?.version ?? 0, activo: true })
        expect(!reactivar.ok && esRouterUnido(reactivar.problema)).toBe(true)
    })

    it('simular no cambia nada; unir mueve redes y planes, desactiva y deja unido_a_id', async () => {
        const api = useRouters()
        const vista = await api.unir(1, { version: 1, absorber_id: 4, simular: true })
        expect(vista.ok && vista.data).toMatchObject({
            router_id: 1,
            absorbido_id: 4,
            simulado: true,
            coincidencias: ['api', 'serial'],
            redes_ipv4: [5],
            planes_movidos: [4],
            planes_descartados: [1],
            bloqueos: [],
            servicios: [],
            absorbido: { activo: false, unido_a_id: 1 },
        })
        expect(vista.ok && vista.data.avisos.some(a => a.includes('control de velocidad arbol_pcq'))).toBe(true)
        expect(bd.routers.find(r => r.id === 4)).toMatchObject({ activo: true, unido_a_id: null })

        const alReves = await api.unir(4, { version: 1, absorber_id: 1, simular: true })
        expect(alReves.ok && alReves.data.servicios.length).toBe(noRetiradosDe(1))
        expect(alReves.ok && alReves.data.sesiones_abiertas).toBeGreaterThan(0)

        const viejo = await api.unir(1, { version: 7, absorber_id: 4 })
        expect(!viejo.ok && viejo.problema.status).toBe(409)
        const consigo = await api.unir(1, { version: 1, absorber_id: 1 })
        expect(!consigo.ok && consigo.problema.errors?.[0]?.field).toBe('absorber_id')

        const unido = await api.unir(1, { version: 1, absorber_id: 4 }, nuevaClaveIdempotencia())
        expect(unido.ok && unido.data.simulado).toBe(false)
        expect(bd.routers.find(r => r.id === 4)).toMatchObject({ activo: false, unido_a_id: 1 })
        expect(bd.redesIpv4.find(r => r.id === 5)?.router_id).toBe(1)
        expect(bd.planesPorRouter[1]).toEqual([1, 2, 3, 4])
        expect(bd.acciones.at(-1)).toMatchObject({ accion: 'routers.unir' })
        const otra = await api.unir(1, { version: 1, absorber_id: 4 })
        expect(!otra.ok && otra.problema.type).toBe('urn:argosisp:problema:router_unido')
        const sinGrupos = await api.duplicados()
        expect(sinGrupos.ok && sinGrupos.data).toEqual([])
    })

    it('secretos RADIUS distintos: la simulación lo trae en bloqueos y la unión responde 422', async () => {
        bd.secretosRadius[4] = 'otro-secreto'
        const api = useRouters()
        const vista = await api.unir(1, { version: 1, absorber_id: 4, simular: true })
        expect(vista.ok && vista.data.bloqueos).toEqual(['secreto_radius_distinto'])
        const real = await api.unir(1, { version: 1, absorber_id: 4 })
        expect(!real.ok && esSecretoDistinto(real.problema)).toBe(true)
    })

    it('aviso: por qué son el mismo, «Unir» con vista previa, nadie se desconecta y confirmación', async () => {
        const wrapper = await montarAviso()
        await esperar(() => expect(wrapper.find('[data-prueba="grupo-duplicados-0"]').exists()).toBe(true))
        const aviso = wrapper.find('[data-prueba="grupo-duplicados-0"]').text()
        expect(aviso).toContain('«RB-Centro» y «RB-Centro PCQ» parecen el mismo MikroTik')
        expect(aviso).toContain('Misma dirección de la API (10.10.0.1:443)')
        expect(aviso).toContain('Mismo número de serie')

        await wrapper.find('[data-prueba="unir-grupo-0"]').trigger('click')
        await esperar(() => expect(enBody('union-vista-previa')).not.toBeNull())
        expect(enBody('union-queda')?.textContent).toBe('RB-Centro')
        expect(enBody('union-absorbido')?.textContent).toBe('RB-Centro PCQ')
        expect(enBody('union-sin-desconexion')?.textContent).toContain('Nadie se desconecta')
        expect(enBody('union-avisos')?.textContent).toContain('queda desactivado y unido')
        expect(enBody('unir-enviar')?.hasAttribute('disabled')).toBe(true)

        // Conservar el duplicado: pasan los servicios y las sesiones del RB-Centro.
        document.body.querySelector<HTMLElement>('[data-prueba="unir-queda"] [role="radio"][value="4"], [data-prueba="unir-queda"] button[value="4"]')?.click()
        await esperar(() => expect(enBody('union-queda')?.textContent).toBe('RB-Centro PCQ'))
        expect(enBody('union-servicios')?.textContent?.trim()).toBe(String(noRetiradosDe(1)))
        expect(Number(enBody('union-sesiones')?.textContent)).toBeGreaterThan(0)
        expect(enBody('union-avisos')?.textContent).toContain('nas_ip de «RB-Centro»')

        // De vuelta al RB-Centro, se confirma y se une.
        document.body.querySelector<HTMLElement>('[data-prueba="unir-queda"] [role="radio"][value="1"], [data-prueba="unir-queda"] button[value="1"]')?.click()
        await esperar(() => expect(enBody('union-queda')?.textContent).toBe('RB-Centro'))
        const casilla = enBody('unir-confirmar')
        const boton = casilla?.matches('[role="checkbox"]') ? casilla : casilla?.querySelector<HTMLElement>('[role="checkbox"]')
        expect(boton).toBeTruthy()
        boton?.click()
        await esperar(() => expect(enBody('unir-enviar')?.hasAttribute('disabled')).toBe(false))
        clic('unir-enviar')
        await esperar(() => expect(bd.routers.find(r => r.id === 4)?.unido_a_id).toBe(1))
        await esperar(() => expect(wrapper.find('[data-prueba="grupo-duplicados-0"]').exists()).toBe(false))
    })

    it('un bloqueo deshabilita «Unir routers» y explica el paso a seguir', async () => {
        bd.secretosRadius[4] = 'otro-secreto'
        const wrapper = await montarAviso(1)
        await esperar(() => expect(wrapper.find('[data-prueba="unir-grupo-0"]').exists()).toBe(true))
        await wrapper.find('[data-prueba="unir-grupo-0"]').trigger('click')
        await esperar(() => expect(enBody('union-bloqueo-secreto_radius_distinto')).not.toBeNull())
        expect(enBody('union-bloqueo-secreto_radius_distinto')?.textContent).toContain('/radius')
        expect(enBody('unir-confirmar')).toBeNull()
        expect(enBody('unir-enviar')?.hasAttribute('disabled')).toBe(true)
    })

    it('errores visibles con «Reintentar»: la lista de duplicados y la simulación', async () => {
        simularFalla('GET /api/v1/routers/duplicados', 500)
        const wrapper = await montarAviso()
        await esperar(() => expect(wrapper.find('[data-prueba="duplicados-error"]').exists()).toBe(true))
        expect(wrapper.find('[data-prueba="duplicados-error"]').text()).toContain('Reintentar')
        delete bd.fallas['GET /api/v1/routers/duplicados']
        await wrapper.find('[data-prueba="duplicados-error"] button').trigger('click')
        await esperar(() => expect(wrapper.find('[data-prueba="grupo-duplicados-0"]').exists()).toBe(true))

        simularFalla('POST /api/v1/routers/:id/unir', 501)
        await wrapper.find('[data-prueba="unir-grupo-0"]').trigger('click')
        await esperar(() => expect(enBody('unir-error-vista')).not.toBeNull())
        expect(enBody('unir-error-vista')?.textContent).toContain('Reintentar')
        expect(enBody('union-vista-previa')).toBeNull()
        expect(enBody('unir-enviar')?.hasAttribute('disabled')).toBe(true)
    })

    it('sin routers.unir se ve el aviso pero no el botón', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'routers.unir') }
        const wrapper = await montarAviso()
        await esperar(() => expect(wrapper.find('[data-prueba="grupo-duplicados-0"]').exists()).toBe(true))
        expect(wrapper.find('[data-prueba="unir-grupo-0"]').exists()).toBe(false)
        expect(wrapper.text()).toContain('Pide a un administrador')
    })

    it('el alta muestra el 409 con qué router es y qué hacer', async () => {
        const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(RouterAltaModal, { open: true }) }) })
        await mountSuspended(conApp)
        await esperar(() => expect(enBody('router-nombre')).not.toBeNull())
        const escribir = (prueba: string, valor: string) => {
            const input = enBody(prueba)?.querySelector('input') ?? enBody(prueba)
            if (input instanceof HTMLInputElement) {
                input.value = valor
                input.dispatchEvent(new Event('input'))
            }
        }
        escribir('router-nombre', 'RB-Centro otra vez')
        escribir('router-host', '10.10.0.1')
        escribir('router-nas', '10.10.0.3')
        clic('router-guardar')
        await esperar(() => expect(enBody('router-duplicado')).not.toBeNull())
        const texto = enBody('router-duplicado')?.textContent ?? ''
        expect(texto).toContain('Ese MikroTik ya está registrado')
        expect(texto).toContain('«RB-Centro» (router 1)')
        expect(texto).toContain('únelos desde Routers')
        expect(bd.routers).toHaveLength(4)
    })
})
