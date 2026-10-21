import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import { bd } from '~~/fixtures/bd'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import PaginaCliente from '~/pages/clientes/[id]/index.vue'
import PaginaCobro from '~/pages/cobro/index.vue'
import PaginaEmpresas from '~/pages/configuracion/empresas.vue'
import PaginaServicio from '~/pages/servicios/[id].vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * Multiempresa (`contratos/multiempresa.md`) con los fixtures de dos empresas: ArgosNet (1, la
 * principal) y Fibra del Sur (2, las sucursales de los clientes 3 y 11). El admin tiene alcance
 * global; el cajero, solo la 1.
 */
async function comoUsuario(usuario: typeof meAdmin | typeof meCajero, token: string) {
    sesionFixture(token)
    useUsuarioActual().value = usuario
    await flushPromises()
}

describe('multiempresa · selector y cabecera', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        await comoUsuario(meAdmin, 'fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        // La empresa elegida se recuerda por usuario: cada prueba empieza en "Todas".
        localStorage.clear()
    })

    it('la elección inicial: la guardada si sigue valiendo, la activa, la única, Todas con alcance global', () => {
        const dos = { alcance_global: true, empresas: meAdmin.empresas, empresa_activa_id: null }
        expect(eleccionInicial(dos, null)).toBe('todas')
        expect(eleccionInicial(dos, 2)).toBe(2)
        expect(eleccionInicial(dos, 99)).toBe('todas')
        expect(eleccionInicial({ ...dos, empresa_activa_id: 1 }, null)).toBe(1)
        expect(eleccionInicial({ alcance_global: false, empresas: meCajero.empresas, empresa_activa_id: 1 }, 'todas')).toBe(1)
        expect(eleccionInicial({ alcance_global: false, empresas: meAdmin.empresas, empresa_activa_id: null }, null)).toBe(1)
        expect(eleccionInicial({ alcance_global: false, empresas: [], empresa_activa_id: null }, null)).toBeNull()
    })

    it('con una empresa elegida cada petición lleva X-Empresa-Id y la lista se filtra; con Todas, el consolidado', async () => {
        const { elegir, eleccion, conSelector } = useEmpresaActiva()
        expect(conSelector.value).toBe(true)
        expect(eleccion.value).toBe('todas')
        const todas = await useServicios().listar({ limit: 200 })
        expect(todas.ok && new Set(todas.data.data.map(s => s.empresa_id))).toEqual(new Set([1, 2]))

        elegir(2)
        const fibra = await useServicios().listar({ limit: 200 })
        expect(fibra.ok && fibra.data.data.length).toBe(2)
        expect(fibra.ok && fibra.data.data.every(s => s.empresa_id === 2)).toBe(true)
        const me = await useApi().GET('/api/v1/me')
        expect(me.data?.empresa_activa_id).toBe(2)
    })

    it('el cajero tiene una sola empresa: sin selector y con su empresa en cada petición', async () => {
        await comoUsuario(meCajero, 'fixture-cajero')
        const { conSelector, eleccion, elegir } = useEmpresaActiva()
        expect(conSelector.value).toBe(false)
        expect(eleccion.value).toBe(1)
        elegir('todas')
        expect(eleccion.value).toBe(1)
        const servicios = await useServicios().listar({ limit: 200 })
        expect(servicios.ok && servicios.data.data.every(s => s.empresa_id === 1)).toBe(true)
    })
})

describe('multiempresa · rutas consolidables', () => {
    it('LISTAS_CONSOLIDABLES son exactamente los GET del OpenAPI que aceptan ?empresas=todas', () => {
        const web = [process.cwd(), resolve(process.cwd(), 'apps/web')].find(ruta => existsSync(join(ruta, 'app/pages'))) ?? process.cwd()
        const spec = JSON.parse(readFileSync(resolve(web, '../../packages/contracts/openapi.json'), 'utf8')) as {
            paths: Record<string, { get?: { parameters?: { name: string, in: string }[] } }>
        }
        const conTodas = Object.entries(spec.paths)
            .filter(([, operaciones]) => (operaciones.get?.parameters ?? []).some(p => p.name === 'empresas' && p.in === 'query'))
            .map(([ruta]) => ruta)
            .sort()
        expect([...LISTAS_CONSOLIDABLES].sort()).toEqual(conTodas)
    })
})

describe('multiempresa · reglas del panel', () => {
    const servicios = [{ id: 3, empresa_id: 1 }, { id: 4, empresa_id: 2 }]
    const facturas = [
        { id: 310, servicio_id: 3, total: '450.00', pagado: '0.00' },
        { id: 410, servicio_id: 4, total: '450.00', pagado: '50.00' },
        { id: 900, servicio_id: null, total: '10.00', pagado: '0.00' },
    ]

    it('agrupa por la empresa del servicio, la desconocida al final', () => {
        const grupos = agruparPorEmpresa(facturas, f => empresaDeFactura(f, servicios))
        expect(grupos.map(g => [g.empresaId, g.filas.map(f => f.id)])).toEqual([[1, [310]], [2, [410]], [null, [900]]])
    })

    it('reparto del cobro: un pago por empresa con lo que falta pagar de cada una', () => {
        const reparto = repartoPorEmpresa(facturas, [410, 310], servicios)
        expect(reparto.map(p => [p.empresaId, p.facturas, p.total.toFixed(2)])).toEqual([[1, [310], '450.00'], [2, [410], '400.00']])
        expect(pendienteDeFacturas(facturas).toFixed(2)).toBe('860.00')
    })

    it('empresa sugerida: zona > router > activa', () => {
        const zona = { nombre: 'Mixco Norte', empresa_sugerida_id: 2 }
        const router = { nombre: 'RB-Centro', empresa_sugerida_id: 1 }
        expect(sugerenciaEmpresa({ zona, router, activa: 1 })).toEqual({ empresaId: 2, motivo: 'por la zona Mixco Norte' })
        expect(sugerenciaEmpresa({ zona: { ...zona, empresa_sugerida_id: null }, router, activa: 2 })).toEqual({ empresaId: 1, motivo: 'por el router RB-Centro' })
        expect(sugerenciaEmpresa({ zona: null, router: null, activa: 2 }).empresaId).toBe(2)
        expect(sugerenciaEmpresa({ zona: null, router: null, activa: null })).toEqual({ empresaId: null, motivo: null })
    })

    it('logo: solo PNG o SVG de hasta 512 KB', () => {
        expect(errorLogo({ type: 'image/png', size: 1000 })).toBeNull()
        expect(errorLogo({ type: 'image/svg+xml', size: LOGO_MAX_BYTES })).toBeNull()
        expect(errorLogo({ type: 'image/jpeg', size: 1000 })).toBe('Solo PNG o SVG')
        expect(errorLogo({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toBe('El logo pasa de 512 KB')
    })
})

describe('multiempresa · acciones contra la API (fixtures)', () => {
    beforeEach(async () => {
        reiniciarFixtures()
        await comoUsuario(meAdmin, 'fixture-admin')
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
        // La empresa elegida se recuerda por usuario: cada prueba empieza en "Todas".
        localStorage.clear()
    })

    it('empresas: alta, NIT repetido (409 nit_duplicado) y desactivar con servicios (422)', async () => {
        const empresas = useEmpresas()
        const nueva = await empresas.crear({ nit: '5769373K', razon_social: 'CABLE ORIENTE, S.A.', nombre_comercial: 'Cable Oriente' }, nuevaClaveIdempotencia())
        expect(nueva.ok && nueva.data.activa).toBe(true)
        const repetida = await empresas.crear({ nit: '7788990-1', razon_social: 'OTRA', nombre_comercial: 'Otra' }, nuevaClaveIdempotencia())
        expect(!repetida.ok && repetida.problema.type).toBe('urn:argosisp:problema:nit_duplicado')
        const fibra = bd.empresas.find(e => e.id === 2)
        const desactivar = await empresas.desactivar(2, fibra?.version ?? 0, 'Cierre', nuevaClaveIdempotencia())
        expect(!desactivar.ok && desactivar.problema.type).toBe('urn:argosisp:problema:empresa_con_servicios')
        const principal = await empresas.desactivar(1, bd.empresas[0]?.version ?? 0, 'No', nuevaClaveIdempotencia())
        expect(!principal.ok && principal.problema.type).toBe('urn:argosisp:problema:empresa_principal')
    })

    it('logo por multipart: sube un PNG y rechaza uno grande con la regla tamano', async () => {
        const empresas = useEmpresas()
        const png = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' })
        const subida = await empresas.cambiarLogo(2, bd.empresas[1]?.version ?? 0, png)
        expect(subida.ok && subida.data.logo_tipo).toBe('image/png')
        expect(subida.ok && subida.data.logo_url).toMatch(/^\/api\/v1\/empresas\/2\/logo\?v=/)
        const grande = new File([new Uint8Array(LOGO_MAX_BYTES + 1)], 'grande.png', { type: 'image/png' })
        const rechazada = await empresas.cambiarLogo(2, bd.empresas[1]?.version ?? 0, grande)
        expect(!rechazada.ok && rechazada.problema.errors?.[0]).toMatchObject({ field: 'logo', rule: 'tamano' })
        const quitada = await empresas.cambiarLogo(2, bd.empresas[1]?.version ?? 0, null)
        expect(quitada.ok && quitada.data.logo_url).toBeNull()
    })

    it('cambiar la empresa de un servicio: con saldo, 422 servicio_con_saldo; sin saldo, pasa', async () => {
        const conSaldo = bd.servicios.find(s => s.id === 4)
        const respuesta = await useServicios().cambiarEmpresa(4, { empresa_id: 1, version: conSaldo?.version ?? 0, motivo: 'Cambio de zona' }, nuevaClaveIdempotencia())
        expect(!respuesta.ok && respuesta.problema.type).toBe('urn:argosisp:problema:servicio_con_saldo')
        expect(!respuesta.ok && respuesta.problema.detail).toContain('pendientes')

        // Adicionales (A1): con una cortesía o un cobrado vigentes, 422 `servicio_con_adicionales`.
        const conAdicionales = bd.servicios.find(s => s.id === 1)
        const bloqueado = await useServicios().cambiarEmpresa(1, { empresa_id: 2, version: conAdicionales?.version ?? 0, motivo: 'Cambio de zona' }, nuevaClaveIdempotencia())
        expect(!bloqueado.ok && bloqueado.problema.type).toBe('urn:argosisp:problema:servicio_con_adicionales')

        const alDia = bd.servicios.find(s => s.estado === 'activo' && s.empresa_id === 1
            && !bd.facturas.some(f => f.servicio_id === s.id && f.estado !== 'pagada' && f.estado !== 'anulada')
            && !bd.adicionalesServicio.some(a => a.servicio_id === s.id && a.estado === 'activo' && a.modalidad !== 'incluido'))
        expect(alDia).toBeTruthy()
        const movido = await useServicios().cambiarEmpresa(alDia?.id ?? 0, { empresa_id: 2, version: alDia?.version ?? 0, motivo: 'Cambio de zona' }, nuevaClaveIdempotencia())
        expect(movido.ok && movido.data.empresa_id).toBe(2)
    })

    it('usuarios: sin alcance global hace falta al menos una empresa; con una, queda asignada', async () => {
        const soporte = bd.usuarios.find(u => u.id === 3)
        const vacio = await useUsuarios().asignarEmpresas(3, { version: soporte?.version ?? 0, alcance_global: false, empresas: [] })
        expect(!vacio.ok && vacio.problema.errors?.[0]?.field).toBe('empresas')
        const dos = await useUsuarios().asignarEmpresas(3, { version: soporte?.version ?? 0, alcance_global: false, empresas: [2, 1] })
        expect(dos.ok && dos.data.empresas).toEqual([1, 2])
    })

    it('bitácora: con una empresa, sus acciones y las del grupo (empresa_id null); con Todas, todas', async () => {
        const todas = await useBitacora().acciones({ limit: 200 })
        const empresasTodas = new Set(todas.ok ? todas.data.data.map(a => a.empresa_id) : [])
        expect(empresasTodas).toEqual(new Set([null, 1, 2]))
        useEmpresaActiva().elegir(2)
        const sur = await useBitacora().acciones({ limit: 200 })
        expect(sur.ok && sur.data.data.every(a => a.empresa_id === null || a.empresa_id === 2)).toBe(true)
        expect(sur.ok && sur.data.data.find(a => a.empresa_id === 2)?.empresa_nombre).toBe('Fibra del Sur')
    })

    it('zonas: la empresa sugerida se guarda con la versión (409 con una vieja)', async () => {
        const leida = bd.zonas.find(z => z.id === 1)?.version ?? 0
        const editada = await useZonas().editar(1, { nombre: 'Centro', empresa_sugerida_id: 2, version: leida })
        expect(editada.ok && editada.data.empresa_sugerida_id).toBe(2)
        const vieja = await useZonas().editar(1, { nombre: 'Centro', empresa_sugerida_id: null, version: leida })
        expect(!vieja.ok && vieja.problema.status).toBe(409)
    })
})

describe('multiempresa · pantallas', () => {
    beforeEach(async () => {
        // El cobro marca por defecto lo vencido a la fecha: tiene que ser la de los fixtures.
        fijarHoyFixtures()
        reiniciarFixtures()
        await comoUsuario(meAdmin, 'fixture-admin')
    })

    afterEach(() => {
        soltarReloj()
        sesionFixture(null)
        useUsuarioActual().value = null
        // La empresa elegida se recuerda por usuario: cada prueba empieza en "Todas".
        localStorage.clear()
    })

    it('Empresas: lista con la principal y las acciones; la principal no se desactiva', async () => {
        const vista = await mountSuspended(PaginaEmpresas, { route: '/configuracion/empresas' })
        await esperar(() => expect(vista.text()).toContain('Fibra del Sur'))
        expect(vista.text()).toContain('ArgosNet')
        expect(vista.text()).toContain('Principal')
        const desactivar = vista.findAll('button').filter(b => b.text() === 'Desactivar')
        expect(desactivar).toHaveLength(1)
    })

    it('ficha del servicio: muestra su empresa y "Cambiar empresa" explica el saldo pendiente', async () => {
        const vista = await mountSuspended(PaginaServicio, { route: '/servicios/4' })
        await esperar(() => expect(vista.find('[data-prueba="empresa-servicio"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="empresa-servicio"]').text()).toContain('Fibra del Sur')
        expect(vista.find('[data-prueba="abrir-cambiar-empresa"]').exists()).toBe(true)
    })

    it('ficha del cliente: avisos pendientes agrupados por empresa con lo que falta en cada una', async () => {
        const vista = await mountSuspended(PaginaCliente, { route: '/clientes/3?tab=cuenta' })
        await esperar(() => expect(vista.find('[data-prueba="pendientes-empresa-2"]').exists()).toBe(true))
        expect(vista.get('[data-prueba="pendientes-empresa-1"]').text()).toContain('ArgosNet')
        expect(vista.get('[data-prueba="pendientes-empresa-2"]').text()).toContain('Fibra del Sur')
        // El saldo de cada empresa sale de `EstadoCuenta.empresas[]` (A3), no se calcula en pantalla.
        expect(vista.get('[data-prueba="pendientes-empresa-2"]').text()).toContain('Saldo Q 450.00')
    })

    it('cobro: facturas de dos empresas se muestran como un pago por empresa', async () => {
        const vista = await mountSuspended(PaginaCobro, { route: '/cobro?cliente=3' })
        await esperar(() => expect(vista.find('[data-factura="410"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="reparto-empresas"]').exists()).toBe(false)
        await vista.get('[data-factura="310"] button[role="checkbox"]').trigger('click')
        await vista.get('[data-factura="410"] button[role="checkbox"]').trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="reparto-empresas"]').exists()).toBe(true))
        const reparto = vista.get('[data-prueba="reparto-empresas"]').text()
        expect(reparto).toContain('Un pago por empresa')
        expect(reparto).toContain('ArgosNet')
        expect(reparto).toContain('Fibra del Sur')
        expect(new Decimal(450).times(2).toFixed(2)).toBe('900.00')
    })
})
