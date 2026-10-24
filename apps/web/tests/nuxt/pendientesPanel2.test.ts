import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import { UApp } from '#components'
import PaginaCanjes from '~/pages/lealtad/canjes.vue'
import PaginaPremios from '~/pages/lealtad/premios.vue'
import PaginaNodos from '~/pages/configuracion/nodos-portal.vue'
import PaginaPasarela from '~/pages/cobros/pasarela.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Pendientes de la prioridad 2, segunda tanda: nodos del portal, Telegram del cliente, conciliación
 * de la pasarela, corte manual, certificación en lote, premios y canjes de lealtad y las banderas del
 * portal en el programa.
 */

function conApp(componente: Parameters<typeof h>[0]) {
    return defineComponent({ render: () => h(UApp, null, { default: () => h(componente) }) })
}

beforeEach(() => {
    reiniciarFixtures()
    sesionFixture('fixture-admin')
    useUsuarioActual().value = meAdmin
    useEmpresaActiva().elegir(1)
})

afterEach(() => {
    sesionFixture(null)
    useUsuarioActual().value = null
})

describe('nodos del portal y Telegram', () => {
    it('crear un nodo devuelve el token argn_ una vez; revocar lo marca', async () => {
        const creado = await useNodosPortal().crear('portal-norte')
        expect(creado.ok && creado.data.token).toMatch(/^argn_[A-Za-z0-9]{43}$/)
        const malo = await useNodosPortal().crear('Portal Norte')
        expect(!malo.ok && malo.problema.errors?.[0]?.field).toBe('nombre')
        const revocado = await useNodosPortal().revocar(creado.ok ? creado.data.datos.id : 0)
        expect(revocado.ok && revocado.data.revocado_en).not.toBeNull()
        const pagina = await mountSuspended(conApp(PaginaNodos))
        await esperar(() => expect(pagina.find('[data-nodo="portal-mixco"]').exists()).toBe(true))
        expect(pagina.find('[data-prueba="tabla-nodos"]').text()).toContain('190.56.10.4')
    })

    it('vincular y desvincular el Telegram de un cliente', async () => {
        const malo = await useClientes().vincularTelegram(1, 'abc', nuevaClaveIdempotencia())
        expect(!malo.ok && malo.problema.errors?.[0]?.field).toBe('chat_id')
        const vinculado = await useClientes().vincularTelegram(1, '-100123', nuevaClaveIdempotencia())
        expect(vinculado.ok && vinculado.data.telegram_chat_id).toBe('-100123')
        const quitado = await useClientes().desvincularTelegram(1, nuevaClaveIdempotencia())
        expect(quitado.ok && quitado.data.telegram_chat_id).toBeNull()
    })
})

describe('procesos: pasarela, corte y certificación en lote', () => {
    it('la conciliación lista sus diferencias y conciliar agrega una corrida', async () => {
        const conciliada = await usePasarela().conciliar('2026-10-20', nuevaClaveIdempotencia())
        expect(conciliada.ok && conciliada.data.fecha).toBe('2026-10-20')
        const lista = await usePasarela().conciliaciones()
        expect(lista.ok && lista.data.data.length).toBe(3)
        const pagina = await mountSuspended(conApp(PaginaPasarela))
        await esperar(() => expect(pagina.find('[data-conciliacion="2"]').exists()).toBe(true))
        expect(pagina.find('[data-conciliacion="2"]').text()).toContain('El monto no coincide')
        expect(pagina.find('[data-conciliacion="2"]').text()).toContain('Pago #7001')
    })

    it('el corte evalúa los servicios no retirados; el lote pide la certificación por rango', async () => {
        const corte = await useFacturas().corte(nuevaClaveIdempotencia())
        expect(corte.ok && corte.data.evaluados).toBe(bd.servicios.filter(s => s.estado !== 'retirado').length)
        const lote = await useDte().certificarLote({ desde: '2026-01-01', hasta: '2026-12-31' }, nuevaClaveIdempotencia())
        expect(lote.ok && lote.data.solicitadas.length + lote.data.errores.length).toBeGreaterThan(0)
        const sinRango = await useDte().certificarLote({}, nuevaClaveIdempotencia())
        expect(!sinRango.ok && sinRango.problema.status).toBe(422)
    })
})

describe('lealtad: premios, canjes y portal', () => {
    it('premio: cada tipo pide sus campos (esquema espejo) y la API los guarda', async () => {
        const sinValor = esquemaPremio.safeParse({ ...entradaPremio(null), nombre: 'Descuento', descuento_valor: '' })
        expect(!sinValor.success && sinValor.error.issues[0]?.path.join('.')).toBe('descuento_valor')
        const porcentaje = esquemaPremio.safeParse({ ...entradaPremio(null), nombre: 'Descuento', descuento_tipo: 'porcentaje', descuento_valor: '150' })
        expect(porcentaje.success).toBe(false)
        const programa = bd.programasLealtad[0]!
        const datos = esquemaPremio.parse({ ...entradaPremio(null), nombre: 'Q30 de descuento', costo_puntos: 300, descuento_valor: '30' })
        const creado = await usePremiosLealtad().crear(cuerpoPremio(programa.id, datos), nuevaClaveIdempotencia())
        expect(creado.ok && [creado.data.descuento_valor, creado.data.plan_destino_id]).toEqual(['30.00', null])
        const editado = await usePremiosLealtad().editar(creado.ok ? creado.data.id : 0, cambiosPremio({ version: 1 }, { ...datos, activo: false }))
        expect(editado.ok && editado.data.activo).toBe(false)
    })

    it('canjear descuenta puntos, sin saldo es 422 y revertir los devuelve', async () => {
        const programa = bd.programasLealtad[0]!
        const premio = await usePremiosLealtad().crear(cuerpoPremio(programa.id, esquemaPremio.parse({ ...entradaPremio(null), tipo: 'mes_gratis', nombre: 'Mes gratis', costo_puntos: 1 })), nuevaClaveIdempotencia())
        const premioId = premio.ok ? premio.data.id : 0
        const conPuntos = bd.movimientosPuntos.find(m => m.puntos > 0 && m.empresa_id === programa.empresa_id)!
        const servicio = bd.servicios.find(s => s.cliente_id === conPuntos.cliente_id)!
        const canje = await useCanjesLealtad().crear({ cliente_id: servicio.cliente_id, servicio_id: servicio.id, premio_id: premioId }, nuevaClaveIdempotencia())
        expect(canje.ok && canje.data.estado).toBe('reservado')
        const caro = await usePremiosLealtad().crear(cuerpoPremio(programa.id, esquemaPremio.parse({ ...entradaPremio(null), tipo: 'mes_gratis', nombre: 'Muy caro', costo_puntos: 9_000_000 })), nuevaClaveIdempotencia())
        const sinSaldo = await useCanjesLealtad().crear({ cliente_id: servicio.cliente_id, servicio_id: servicio.id, premio_id: caro.ok ? caro.data.id : 0 }, nuevaClaveIdempotencia())
        expect(!sinSaldo.ok && sinSaldo.problema.type).toBe('urn:argosisp:problema:saldo_insuficiente')
        const revertido = await useCanjesLealtad().revertir(canje.ok ? canje.data.id : 0, 'Prueba de reverso', nuevaClaveIdempotencia())
        expect(revertido.ok && revertido.data.estado).toBe('revertido')
    })

    it('canjear en el portal exige que los puntos se vean ahí (esquema y API)', async () => {
        const programa = bd.programasLealtad[0]!
        const entrada = { ...entradaDePrograma(programa), visible_portal: false, canje_portal: true }
        const r = esquemaPrograma.safeParse(entrada)
        expect(!r.success && r.error.issues.map(i => i.path.join('.'))).toContain('canje_portal')
        const datos = esquemaPrograma.parse({ ...entrada, visible_portal: true })
        const editado = await useProgramasLealtad().editar(programa.id, cuerpoEdicionPrograma(programa, datos))
        expect(editado.ok && [editado.data.visible_portal, editado.data.canje_portal]).toEqual([true, true])
    })

    it('las pantallas de premios y canjes', async () => {
        const premios = await mountSuspended(conApp(PaginaPremios))
        await esperar(() => expect(premios.find('[data-prueba="tabla-premios"]').exists()).toBe(true))
        expect(premios.find('[data-prueba="nuevo-premio"]').exists()).toBe(true)
        premios.unmount()
        const canjes = await mountSuspended(conApp(PaginaCanjes))
        await esperar(() => expect(canjes.find('[data-prueba="tabla-canjes"]').exists()).toBe(true))
        expect(canjes.find('[data-prueba="nuevo-canje"]').exists()).toBe(true)
    })
})
