import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, type Component } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import PoolMigrarModal from '~/components/PoolMigrarModal.vue'
import RouterAltaModal from '~/components/RouterAltaModal.vue'
import RouterEditarModal from '~/components/RouterEditarModal.vue'
import PaginaRouter from '~/pages/routers/[id].vue'
import { UApp } from '#components'
import { esperar } from '../ayudas/esperar'

/**
 * Tipo de conexión por router (`contratos/tipo-conexion-router.md`, A1 en `a1/tipo-por-router`):
 * selector en el alta y la edición del router (422 `tipo_conexion_con_servicios` con la lista),
 * «Cambiar tipo» con vista previa en la ficha, «Unificar» cuando hay servicios que difieren, y el
 * aviso al mover servicios a un router de otro tipo.
 */

function enApp(componente: Component, props: Record<string, unknown> = {}) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente, props) }) })
}

function enBody(prueba: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`[data-prueba="${prueba}"]`)
}

function opcion(contenedor: string, valor: string): HTMLElement {
    const elemento = document.body.querySelector<HTMLElement>(`${contenedor} [role="radio"][value="${valor}"], ${contenedor} button[value="${valor}"]`)
    expect(elemento, `${contenedor} = ${valor}`).not.toBeNull()
    return elemento!
}

function boton(texto: string, raiz: ParentNode = document.body): HTMLElement {
    const encontrado = [...raiz.querySelectorAll<HTMLElement>('button')].find(b => b.textContent?.trim() === texto)
    expect(encontrado, texto).toBeDefined()
    return encontrado!
}

describe('tipo de conexión por router', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    describe('fixtures como la API', () => {
        it('vista previa: qué cambia, qué falta y qué se completa; sin ?tipo= los que difieren', async () => {
            const servicio = bd.servicios.find(s => s.router_id === 1 && s.estado !== 'retirado')!
            servicio.mac = null
            const vista = await useRouters().vistaPreviaTipoConexion(1, 'dhcp_fija')
            expect(vista.ok).toBe(true)
            if (!vista.ok) {
                return
            }
            expect(vista.data).toMatchObject({ router_id: 1, tipo_actual: 'pppoe', tipo: 'dhcp_fija', aplicable: false })
            const fila = vista.data.servicios.find(s => s.servicio_id === servicio.id)!
            expect(fila).toMatchObject({ cambia: true, faltan: ['mac'], mensajes: ['DHCP fija necesita la MAC del equipo: complétala en el servicio'] })
            expect(vista.data.resumen.con_faltantes).toBe(1)

            const incompleto = await useRouters().cambiarTipoConexion(1, { version: vista.data.router_version, tipo_conexion: 'dhcp_fija' }, nuevaClaveIdempotencia())
            expect(!incompleto.ok && codigoProblema(incompleto.problema)).toBe('tipo_conexion_servicios_incompletos')
            expect(!incompleto.ok && faltantesDeProblema(incompleto.problema).get(servicio.id)).toHaveLength(1)

            const unificar = await useRouters().vistaPreviaTipoConexion(1)
            expect(unificar.ok && unificar.data.resumen.difieren_del_router).toBe(0)
        })

        it('cambiar: pasa el router y sus servicios; 409 con otra versión; editar el router con servicios responde 422', async () => {
            const router = bd.routers.find(r => r.id === 1)!
            const conOtroTipo = await useRouters().editar(1, { version: router.version, tipo_conexion: 'ip_estatica' })
            expect(!conOtroTipo.ok && serviciosConOtroTipo(conOtroTipo.problema)?.servicios.length).toBeGreaterThan(0)

            const viejo = await useRouters().cambiarTipoConexion(1, { version: router.version - 1, tipo_conexion: 'ip_estatica' }, nuevaClaveIdempotencia())
            expect(!viejo.ok && viejo.problema.status).toBe(409)

            const cambio = await useRouters().cambiarTipoConexion(1, { version: router.version, tipo_conexion: 'ip_estatica', motivo: 'Migración a WISP' }, nuevaClaveIdempotencia())
            expect(cambio.ok && [cambio.data.de, cambio.data.a, cambio.data.router.tipo_conexion]).toEqual(['pppoe', 'ip_estatica', 'ip_estatica'])
            const delRouter = bd.servicios.filter(s => s.router_id === 1 && s.estado !== 'retirado')
            expect(delRouter.every(s => s.tipo_conexion === 'ip_estatica' && s.user_ppp === null && s.ipv4)).toBe(true)
        })
    })

    it('alta del router: elige el tipo (PPPoE por defecto) y lo manda', async () => {
        await mountSuspended(enApp(RouterAltaModal, { open: true }))
        await esperar(() => expect(enBody('router-tipo-conexion')).not.toBeNull())
        expect(opcion('[data-prueba="router-tipo-conexion"]', 'pppoe').getAttribute('aria-checked')).toBe('true')
        opcion('[data-prueba="router-tipo-conexion"]', 'dhcp_fija').click()
        const escribir = (nombre: string, valor: string) => {
            const campo = document.body.querySelector<HTMLInputElement>(`[name="${nombre}"]`)!
            campo.value = valor
            campo.dispatchEvent(new Event('input'))
        }
        escribir('nombre', 'Nodo WISP')
        escribir('host', '10.50.0.1')
        escribir('nas_ip', '10.50.0.1')
        opcion('[data-prueba="router-corte-identificacion"]', 'ip').click()
        enBody('router-guardar')!.click()
        await esperar(() => expect(bd.routers.find(r => r.nombre === 'Nodo WISP')).toBeDefined())
        expect(bd.routers.find(r => r.nombre === 'Nodo WISP')!.tipo_conexion).toBe('dhcp_fija')
    })

    it('editar el router con servicios de otro tipo lista los servicios y manda a «Cambiar tipo de conexión»', async () => {
        await mountSuspended(enApp(RouterEditarModal, { router: structuredClone(bd.routers[0]!), open: true }))
        await esperar(() => expect(enBody('router-editar-tipo')).not.toBeNull())
        opcion('[data-prueba="router-editar-tipo"]', 'ip_estatica').click()
        enBody('router-editar-guardar')!.click()
        const aviso = await esperar(() => {
            const elemento = enBody('router-tipo-con-servicios')
            expect(elemento).not.toBeNull()
            return elemento!
        })
        expect(aviso.textContent).toContain('Cambiar tipo de conexión')
        expect(aviso.querySelectorAll('a').length).toBeGreaterThan(0)
        expect(aviso.querySelector('a')!.getAttribute('href')).toMatch(/^\/servicios\/\d+$/)
    })

    it('ficha: tipo junto al control de velocidad; «Cambiar tipo» con vista previa, faltantes y aplicar', async () => {
        const conFalta = bd.servicios.find(s => s.router_id === 1 && s.estado !== 'retirado')!
        conFalta.mac = null
        const pagina = await mountSuspended(enApp(PaginaRouter), { route: '/routers/1' })
        await esperar(() => expect(pagina.find('[data-prueba="router-tipo-actual"]').exists()).toBe(true))
        expect(pagina.find('[data-prueba="router-tipo-actual"]').text()).toBe('PPPoE')
        expect(pagina.find('[data-prueba="router-velocidad"]').exists()).toBe(true)
        expect(pagina.find('[data-prueba="router-tipo-difieren"]').exists()).toBe(false)

        await pagina.find('[data-prueba="abrir-cambio-tipo"]').trigger('click')
        await esperar(() => expect(enBody('tipo-conexion-modal')).not.toBeNull())
        opcion('[data-prueba="tipo-conexion-elegir"]', 'dhcp_fija').click()
        await esperar(() => expect(enBody('tipo-conexion-servicios')).not.toBeNull())
        await esperar(() => expect(enBody('tipo-conexion-servicios')!.textContent).toContain('Falta la MAC: DHCP fija necesita la MAC del equipo'))
        expect((enBody('tipo-conexion-aplicar') as HTMLButtonElement).disabled).toBe(true)

        // A IP estática no falta nada: se aplica.
        opcion('[data-prueba="tipo-conexion-elegir"]', 'ip_estatica').click()
        await esperar(() => expect(enBody('tipo-conexion-servicios')?.textContent ?? '').not.toContain('Falta la MAC'))
        await esperar(() => expect((enBody('tipo-conexion-aplicar') as HTMLButtonElement).disabled).toBe(false))
        expect(enBody('tipo-conexion-servicios')!.textContent).toContain('IPv6 por RADIUS pasa a «Sin IPv6»')
        enBody('tipo-conexion-aplicar')!.click()
        await esperar(() => expect(pagina.find('[data-prueba="router-tipo-actual"]').text()).toBe('IP estática'))
        expect(bd.routers.find(r => r.id === 1)!.tipo_conexion).toBe('ip_estatica')
    })

    it('ficha: 409 en el cambio pide «Recargar» la vista previa', async () => {
        const pagina = await mountSuspended(enApp(PaginaRouter), { route: '/routers/1' })
        await esperar(() => expect(pagina.find('[data-prueba="abrir-cambio-tipo"]').exists()).toBe(true))
        await pagina.find('[data-prueba="abrir-cambio-tipo"]').trigger('click')
        opcion('[data-prueba="tipo-conexion-elegir"]', 'ip_estatica').click()
        await esperar(() => expect((enBody('tipo-conexion-aplicar') as HTMLButtonElement | null)?.disabled).toBe(false))
        const router = bd.routers.find(r => r.id === 1)!
        router.version += 1
        enBody('tipo-conexion-aplicar')!.click()
        const conflicto = await esperar(() => {
            const elemento = enBody('tipo-conexion-conflicto')
            expect(elemento).not.toBeNull()
            return elemento!
        })
        boton('Recargar', conflicto).click()
        await esperar(() => expect(enBody('tipo-conexion-conflicto')).toBeNull())
        await esperar(() => expect((enBody('tipo-conexion-aplicar') as HTMLButtonElement | null)?.disabled).toBe(false))
        enBody('tipo-conexion-aplicar')!.click()
        await esperar(() => expect(bd.routers.find(r => r.id === 1)!.tipo_conexion).toBe('ip_estatica'))
    })

    it('ficha: servicios que difieren del router → aviso con «Unificar»', async () => {
        const distinto = bd.servicios.find(s => s.router_id === 1 && s.estado !== 'retirado')!
        Object.assign(distinto, { tipo_conexion: 'ip_estatica', user_ppp: null, ipv6_modo: 'ninguno' })
        const pagina = await mountSuspended(enApp(PaginaRouter), { route: '/routers/1' })
        await esperar(() => expect(pagina.find('[data-prueba="router-tipo-difieren"]').exists()).toBe(true))
        const aviso = pagina.find('[data-prueba="router-tipo-difieren"]')
        expect(aviso.text()).toContain('1 servicio no usa el tipo del router')
        expect(aviso.text()).toContain('IP estática')
        boton('Unificar', aviso.element).click()
        await esperar(() => expect(enBody('tipo-conexion-servicios')).not.toBeNull())
        expect(enBody('tipo-conexion-servicios')!.querySelectorAll('[data-servicio]')).toHaveLength(1)
        await esperar(() => expect((enBody('tipo-conexion-aplicar') as HTMLButtonElement).disabled).toBe(false))
        expect(enBody('tipo-conexion-aplicar')!.textContent).toContain('Unificar')
        enBody('tipo-conexion-aplicar')!.click()
        await esperar(() => expect(bd.servicios.find(s => s.id === distinto.id)!.tipo_conexion).toBe('pppoe'))
        await esperar(() => expect(pagina.find('[data-prueba="router-tipo-difieren"]').exists()).toBe(false))
    })

    it('mover una red con sus servicios a un router de otro tipo avisa que toman el tipo del destino', async () => {
        bd.routers.find(r => r.id === 2)!.tipo_conexion = 'dhcp_fija'
        const red = bd.redesIpv4.find(r => r.router_id === 1)!
        const modal = await mountSuspended(PoolMigrarModal, { props: { tipo: 'red', entidad: red, acompanantes: [], open: true } })
        await esperar(() => expect(enBody('migrar-destino')).not.toBeNull())
        expect(enBody('migrar-aviso-tipo')).toBeNull()
        // El destino como si se eligiera en el select (estado del componente).
        const estado = modal.vm as unknown as { destino: number | undefined }
        await esperar(() => {
            estado.destino = 2
            expect(estado.destino).toBe(2)
        })
        const aviso = await esperar(() => {
            const elemento = enBody('migrar-aviso-tipo')
            expect(elemento).not.toBeNull()
            return elemento!
        })
        expect(aviso.textContent).toContain('DHCP con IP fija')
        expect(aviso.textContent).toContain('MAC')
    })
})
