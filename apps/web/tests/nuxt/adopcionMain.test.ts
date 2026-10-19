import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import RouterConexion from '~/components/RouterConexion.vue'
import PaginaComprobante from '~/pages/comprobantes/[id].vue'
import PaginaComprobantes from '~/pages/comprobantes/index.vue'
import * as velocidad from '~/utils/velocidad'
import { esperar } from '../ayudas/esperar'

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfakeCAcertificado\n-----END CERTIFICATE-----'

describe('semana 3 (2.ª tanda) · tarea 1: adoptar lo que ya está en main', () => {
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

    it('el panel ya no exporta fórmulas de velocidad: solo presentación', () => {
        expect(Object.keys(velocidad).sort()).toEqual(['CONTROLES_VELOCIDAD', 'VELOCIDAD_POR_DEFECTO', 'partesRateLimit', 'resumenVelocidadPlan'])
    })

    describe('router: cinco campos de conexión', () => {
        it('cuerpo: vacío viaja como null y la CA solo al reemplazarla o quitarla', () => {
            const base = { ...entradaConexionRouter({ api_url: null, api_tls_verificar: true, dhcp_servidor: null, interfaz_clientes: null }) }
            const mantener = esquemaConexionRouter.parse(base)
            expect(cambiosConexionRouter(mantener, 3)).toEqual({ version: 3, api_url: null, api_tls_verificar: true, dhcp_servidor: null, interfaz_clientes: null })
            const reemplazar = esquemaConexionRouter.parse({ ...base, api_url: 'https://10.10.0.1:8443', accion_ca: 'reemplazar', api_ca: PEM, dhcp_servidor: 'dhcp1' })
            expect(cambiosConexionRouter(reemplazar, 3)).toMatchObject({ api_url: 'https://10.10.0.1:8443', api_ca: PEM, dhcp_servidor: 'dhcp1' })
            const quitar = esquemaConexionRouter.parse({ ...base, accion_ca: 'quitar' })
            expect(cambiosConexionRouter(quitar, 3).api_ca).toBeNull()
            const malo = esquemaConexionRouter.safeParse({ ...base, api_url: 'https://host/rest', accion_ca: 'reemplazar', api_ca: 'no es pem' })
            expect(!malo.success && malo.error.issues.map(i => i.path.join('.'))).toEqual(['api_url', 'api_ca'])
        })

        it('guarda con PUT y nunca muestra la CA de vuelta', async () => {
            const api = useRouters()
            const guardado = await api.editar(1, { version: 1, api_url: 'https://10.10.0.1:8443', api_tls_verificar: true, api_ca: PEM, dhcp_servidor: 'dhcp-clientes', interfaz_clientes: 'bridge-clientes' })
            expect(guardado.ok && guardado.data).toMatchObject({ api_url: 'https://10.10.0.1:8443', dhcp_servidor: 'dhcp-clientes', version: 2 })
            const invalido = await api.editar(1, { version: 2, api_ca: 'texto' })
            expect(!invalido.ok && invalido.problema.errors?.map(e => e.field)).toEqual(['api_ca'])
            if (!guardado.ok) {
                return
            }
            const wrapper = await mountSuspended(RouterConexion, { props: { router: guardado.data, open: true } })
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-ca-estado"]')?.textContent).toContain('CA cargada'))
            expect(document.body.innerHTML).not.toContain('MIIBfakeCAcertificado')
            expect(document.body.querySelector('[data-prueba="router-ca"]')).toBeNull()
            const url = document.body.querySelector<HTMLInputElement>('[data-prueba="router-api-url"] input, input[data-prueba="router-api-url"]')
            expect(url?.value).toBe('https://10.10.0.1:8443')
            wrapper.unmount()
        })

        it('sin routers.editar el formulario es de solo lectura', async () => {
            useUsuarioActual().value = { ...meCajero, permisos: [...meCajero.permisos, 'routers.ver'] }
            const routers = await useRouters().listar()
            const router = routers.ok ? routers.data.data[0] : undefined
            expect(router).toBeDefined()
            if (!router) {
                return
            }
            const wrapper = await mountSuspended(RouterConexion, { props: { router, open: true } })
            await esperar(() => expect(document.body.querySelector('[data-prueba="router-ca-estado"]')).not.toBeNull())
            expect(document.body.querySelector('[data-prueba="router-conexion-guardar"]')).toBeNull()
            expect(document.body.querySelector('[data-prueba="router-ca-accion"]')).toBeNull()
            wrapper.unmount()
        })
    })

    describe('egresos por banco con GET /libro/bancos', () => {
        it('lista los bancos del libro y el egreso sale del elegido', async () => {
            const bancos = await useLibro().bancos()
            expect(bancos.ok && bancos.data.map(b => [b.id, b.cuenta_codigo])).toEqual([[1, '1.1.02.01'], [2, '1.1.02.02']])
            const cuerpo = cuerpoEgreso({ ...entradaEgresoVacia(), categoria: 'transito', monto: '900', metodo: 'banco', banco_id: 2 })
            expect(cuerpo).toEqual({ categoria: 'transito', monto: '900.00', metodo: 'banco', banco_id: 2 })
            const egreso = await useEgresos().registrar(cuerpo, nuevaClaveIdempotencia())
            expect(egreso.ok && egreso.data).toMatchObject({ banco_id: 2, banco_nombre: 'Banco Industrial · Monetaria' })
            // Sin elegir: el principal, como la API sin `banco_id`.
            const principal = cuerpoEgreso({ ...entradaEgresoVacia(), monto: '10', metodo: 'banco' })
            expect(principal).not.toHaveProperty('banco_id')
            // El banco no viaja con otro método.
            expect(cuerpoEgreso({ ...entradaEgresoVacia(), monto: '10', metodo: 'caja', caja_id: 1, banco_id: 2 })).not.toHaveProperty('banco_id')
        })

        it('sin egresos.ver no se piden los bancos del libro', async () => {
            sesionFixture('fixture-cajero')
            const bancos = await useLibro().bancos()
            expect(!bancos.ok && bancos.problema.status).toBe(403)
        })
    })

    describe('comprobantes: filtros, resumen y contador', () => {
        it('filtra por método, cuenta y fecha con el resumen de todas las páginas', async () => {
            const api = useComprobantes()
            const pendientes = await api.listar({ estado: 'pendiente', limit: 1 })
            expect(pendientes.ok && pendientes.data.data).toHaveLength(1)
            expect(pendientes.ok && pendientes.data.resumen).toMatchObject({ total: 3, pendientes: 3 })
            const cuenta2 = await api.listar({ estado: 'pendiente', cuenta_bancaria_id: 2 })
            expect(cuenta2.ok && cuenta2.data.data.map(c => c.id)).toEqual([4, 3])
            expect(cuenta2.ok && cuenta2.data.resumen.monto).toBe(cuenta2.ok ? cuenta2.data.resumen.monto_pendiente : '')
            const ach = await api.listar({ estado: 'pendiente', metodo: 'ach' })
            expect(ach.ok && ach.data.resumen).toMatchObject({ total: 1, monto: '150.00' })
            const fechas = await api.listar({ estado: 'rechazado', desde: '2026-10-12', hasta: '2026-10-14' })
            // `pendientes` ignora el estado: el de 14/10 sigue pendiente.
            expect(fechas.ok && fechas.data.resumen).toMatchObject({ total: 1, pendientes: 1 })
        })

        it('el contador del menú sale de ?limit=1 (resumen.pendientes)', async () => {
            const api = useComprobantes()
            await api.actualizarContador()
            expect(api.contador.value).toBe(3)
            simularFalla('GET /api/v1/comprobantes', 500)
            await api.actualizarContador()
            expect(api.contador.value).toBeNull()
        })

        it('la pantalla muestra el resumen y quién revisó, con su nombre', async () => {
            const lista = await mountSuspended(PaginaComprobantes, { route: '/comprobantes?estado=rechazado' })
            await esperar(() => expect(lista.find('[data-prueba="resumen-comprobantes"]').exists()).toBe(true))
            expect(lista.text()).toContain('Por Ana Administradora')
            lista.unmount()

            const rechazado = await useComprobantes().rechazar(4, 'No coincide', nuevaClaveIdempotencia())
            expect(rechazado.ok && rechazado.data.verificado_por_nombre).toBe('Ana Administradora')
            const detalle = await mountSuspended(PaginaComprobante, { route: '/comprobantes/4' })
            await esperar(() => expect(detalle.find('[data-prueba="comprobante-rechazado"]').text()).toContain('por Ana Administradora'))
            detalle.unmount()
        })

        it('con error no se muestra el resumen', async () => {
            simularFalla('GET /api/v1/comprobantes', 501)
            const lista = await mountSuspended(PaginaComprobantes, { route: '/comprobantes' })
            await esperar(() => expect(lista.text()).toContain('Reintentar'))
            expect(lista.find('[data-prueba="resumen-comprobantes"]').exists()).toBe(false)
            lista.unmount()
        })
    })
})
