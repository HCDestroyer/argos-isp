import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import meCajero from '~~/fixtures/auth/me.cajero.json'
import { bd } from '~~/fixtures/bd'
import ClientePuntos from '~/components/ClientePuntos.vue'
import PaginaLealtad from '~/pages/lealtad/index.vue'
import PaginaReferidos from '~/pages/lealtad/referidos.vue'
import PaginaReporte from '~/pages/reportes/lealtad.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Lealtad, fase 1 (A3, `contratos/lealtad.md` §15.1): espejos de los validadores, composables
 * contra los fixtures (mismos errores que la API real) y pantallas (errores con "Reintentar",
 * nada calculado sobre datos que no se leyeron, aviso visible si el pasivo no cuadra).
 */
describe('lealtad · fase 1', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    describe('esquemas y vista previa', () => {
        it('programa: valor del punto, porcentaje hasta 100 y vencimiento opcional', () => {
            const base = entradaProgramaVacia()
            expect(esquemaPrograma.safeParse(base).success).toBe(true)
            expect(esquemaPrograma.safeParse({ ...base, valor_punto: '0,10' }).success).toBe(false)
            expect(esquemaPrograma.safeParse({ ...base, canje_esperado_pct: '100.5' }).success).toBe(false)
            expect(esquemaPrograma.safeParse({ ...base, vigente_desde: '2026-10-10', vigente_hasta: '2026-10-01' }).success).toBe(false)
            const cuerpo = cuerpoPrograma(esquemaPrograma.parse({ ...base, vence: false, valor_punto: '0.1' }))
            expect(cuerpo).toMatchObject({ valor_punto: '0.10', vencimiento_meses: null, vigente_hasta: null })
            expect(cuerpo).not.toHaveProperty('vigente_desde')
            expect(valorPasivoPunto('0.10', '80')?.toFixed(6)).toBe('0.080000')
            expect(terminosSinPlazo('Gana puntos al pagar', true)).toBe(true)
            expect(terminosSinPlazo('Los puntos vencen a los 12 meses', true)).toBe(false)
        })

        it('regla: el cuerpo es la rama de su tipo; la vista previa usa valor_punto y valor_pasivo_punto', () => {
            const programa = bd.programasLealtad[0]
            if (!programa) {
                throw new Error('sin programa')
            }
            const pago = esquemaReglaLealtad.parse({ ...entradaReglaLealtadVacia('pago_a_tiempo'), puntos: 10, con_racha: true })
            expect(cuerpoReglaLealtad(1, pago)).toEqual({ programa_id: 1, tipo: 'pago_a_tiempo', recompensa: 'puntos', puntos: 10, tope_por_cliente: null, periodo_tope: null, activa: true, vigente_hasta: null, condiciones: { dias_antes_vencimiento: 0, solo_servicio: true, sin_promesa: true, racha: { periodos: 6, puntos_extra: 50 }, monto_minimo: null } })
            const antiguedad = esquemaReglaLealtad.safeParse({ ...entradaReglaLealtadVacia('antiguedad'), estados_validos: [] })
            expect(!antiguedad.success && antiguedad.error.issues[0]?.path).toEqual(['estados_validos'])
            const vista = vistaPreviaRegla({ ...entradaReglaLealtadVacia('pago_a_tiempo'), puntos: 10, con_racha: true }, programa)
            expect(vista.map(l => [l.concepto, l.puntos, l.valor.toFixed(2), l.pasivo?.toFixed(2)])).toEqual([
                ['Por otorgamiento', 10, '1.00', '0.80'],
                ['Bono cada 6 facturas seguidas', 50, '5.00', '4.00'],
            ])
            const sinDiferir = vistaPreviaRegla({ ...entradaReglaLealtadVacia('referido'), puntos: 150, puntos_referido: 50 }, { ...programa, diferimiento: false })
            expect(sinDiferir.map(l => l.pasivo)).toEqual([null, null])
            const regla = bd.reglasLealtad.find(r => r.tipo === 'referido')
            expect(regla && resumenCondiciones(regla)).toBe('2 facturas pagadas · en 120 días · bono al referido +50')
            if (regla) {
                const edicion = cuerpoEdicionReglaLealtad(regla, esquemaReglaLealtad.parse(entradaDeReglaLealtad(regla)))
                expect(edicion).toMatchObject({ version: 1, puntos: 150, tope_por_cliente: 10, periodo_tope: 'anio', condiciones: { facturas_pagadas_minimas: 2, dias_maximos: 120, puntos_referido: 50 } })
            }
        })

        it('ajuste: entero distinto de cero y motivo', () => {
            expect(esquemaAjustePuntos.safeParse({ puntos: 0, motivo: 'Compensación', servicio_id: null }).success).toBe(false)
            expect(esquemaAjustePuntos.safeParse({ puntos: -40, motivo: 'ok', servicio_id: null }).success).toBe(false)
            expect(esquemaAjustePuntos.safeParse({ puntos: -40, motivo: 'Corrección', servicio_id: null }).success).toBe(true)
            expect(formatearPuntos(-1250)).toBe('−1,250 pts')
        })
    })

    describe('composables contra los fixtures', () => {
        it('programa: activar ya activo (409), desactivar y otra vez (409), crear con cuentas faltantes (422)', async () => {
            const api = useProgramasLealtad()
            const ya = await api.activar(1, nuevaClaveIdempotencia())
            expect(!ya.ok && ya.problema.type).toBe('urn:argosisp:problema:programa_ya_activo')
            const off = await api.desactivar(1, 'Rediseño del programa', nuevaClaveIdempotencia())
            expect(off.ok && off.data.activo).toBe(false)
            const otraVez = await api.desactivar(1, 'Otra vez', nuevaClaveIdempotencia())
            expect(!otraVez.ok && otraVez.problema.type).toBe('urn:argosisp:problema:programa_inactivo_ya')
            const sur = await api.crear({ empresa_id: 2, nombre: 'Puntos Sur', valor_punto: '0.05', diferimiento: true }, nuevaClaveIdempotencia())
            expect(!sur.ok && sur.problema.type).toBe('urn:argosisp:problema:cuentas_lealtad_faltantes')
            const sinDiferir = await api.crear({ empresa_id: 2, nombre: 'Puntos Sur', valor_punto: '0.05' }, nuevaClaveIdempotencia())
            expect(sinDiferir.ok && sinDiferir.data).toMatchObject({ activo: false, empresa_id: 2, valor_pasivo_punto: '0.050000' })
            const vieja = await api.editar(1, { version: 1, nombre: 'Otro' })
            expect(!vieja.ok && vieja.problema.status).toBe(409)
        })

        it('ajustes: positivo crea lote; negativo sin saldo es 422; los puntos del cliente suman sus movimientos', async () => {
            const api = usePuntosLealtad()
            const sinSaldo = await api.ajustar({ cliente_id: 2, puntos: -9999, motivo: 'Prueba de saldo' }, nuevaClaveIdempotencia())
            expect(!sinSaldo.ok && sinSaldo.problema).toMatchObject({ type: 'urn:argosisp:problema:saldo_insuficiente', detail: 'El cliente tiene 230 puntos y se piden 9999' })
            const mas = await api.ajustar({ cliente_id: 2, puntos: 100, motivo: 'Cliente frecuente' }, nuevaClaveIdempotencia())
            expect(mas.ok && mas.data).toMatchObject({ saldo: 330, movimiento: { tipo: 'ajuste', puntos: 100, valor: '8.00' } })
            const puntos = await api.deCliente(2)
            expect(puntos.ok && puntos.data.saldos[0]).toMatchObject({ empresa_id: 1, saldo: 330, valor_pasivo: '26.40' })
            const reporte = await api.reporte()
            expect(reporte.ok && reporte.data.empresas[0]).toMatchObject({ saldo_puntos: 330, puntos_vivos: 330, pasivo_lotes: '26.40', cuadra: true })
        })

        it('referidos: rechazar con motivo una vez (409 la segunda)', async () => {
            const api = useReferidos()
            const hecho = await api.rechazar(2, 'Mismo hogar que quien lo refirió', nuevaClaveIdempotencia())
            expect(hecho.ok && hecho.data).toMatchObject({ estado: 'rechazado', motivo: 'Mismo hogar que quien lo refirió' })
            const otra = await api.rechazar(2, 'Otra vez', nuevaClaveIdempotencia())
            expect(!otra.ok && otra.problema.type).toBe('urn:argosisp:problema:referido_rechazado')
        })
    })

    describe('pantallas', () => {
        it('programa activo con sus reglas y la vista del valor; sin programa ofrece crearlo', async () => {
            const vista = await mountSuspended(PaginaLealtad, { route: '/lealtad' })
            await esperar(() => expect(vista.find('[data-prueba="programa"]').exists()).toBe(true))
            expect(vista.find('[data-prueba="estado-programa"]').text()).toBe('Activo')
            expect(vista.find('[data-prueba="desactivar-programa"]').exists()).toBe(true)
            await esperar(() => expect(vista.find('[data-prueba="tabla-reglas-lealtad"]').text()).toContain('Pago a tiempo'))
            expect(vista.text()).toContain('pasivo Q 0.080000 por punto')
            vista.unmount()

            bd.programasLealtad = []
            const vacia = await mountSuspended(PaginaLealtad, { route: '/lealtad' })
            await esperar(() => expect(vacia.find('[data-prueba="sin-programa"]').exists()).toBe(true))
            expect(vacia.text()).toContain('Crear programa')
        })

        it('con error al leer el programa: aviso con Reintentar y ningún dato', async () => {
            simularFalla('GET /api/v1/lealtad/programa', 500)
            const vista = await mountSuspended(PaginaLealtad, { route: '/lealtad' })
            await esperar(() => expect(vista.find('[data-prueba="programa-error-carga"]').exists()).toBe(true))
            expect(vista.text()).toContain('Reintentar')
            expect(vista.text()).not.toContain('Crear programa')
            expect(vista.find('[data-prueba="programa"]').exists()).toBe(false)
        })

        it('puntos del cliente: saldo, lotes vivos y movimientos; con error no muestra saldo', async () => {
            const vista = await mountSuspended(ClientePuntos, { props: { clienteId: 2, clienteNombre: 'Juan Carlos Ramírez' } })
            await esperar(() => expect(vista.find('[data-prueba="saldo-puntos"]').exists()).toBe(true))
            expect(vista.find('[data-prueba="saldo-puntos"]').text()).toContain('230 pts')
            expect(vista.find('[data-prueba="tabla-movimientos-puntos"]').text()).toContain('Compensación por falla del 12 de octubre')
            expect(vista.find('[data-prueba="abrir-ajuste"]').exists()).toBe(true)
            vista.unmount()

            useUsuarioActual().value = meCajero
            sesionFixture('fixture-cajero')
            const cajero = await mountSuspended(ClientePuntos, { props: { clienteId: 2, clienteNombre: 'Juan Carlos Ramírez' } })
            await esperar(() => expect(cajero.find('[data-prueba="saldo-puntos"]').exists()).toBe(true))
            expect(cajero.find('[data-prueba="abrir-ajuste"]').exists()).toBe(false)
            cajero.unmount()

            simularFalla('GET /api/v1/clientes/:id/puntos', 501)
            const falla = await mountSuspended(ClientePuntos, { props: { clienteId: 2, clienteNombre: 'Juan Carlos Ramírez' } })
            await esperar(() => expect(falla.find('[data-prueba="puntos-error"]').exists()).toBe(true))
            expect(falla.find('[data-prueba="saldo-puntos"]').exists()).toBe(false)
            expect(falla.text()).not.toContain('pts')
        })

        it('referidos: estados y Rechazar solo en los no rechazados', async () => {
            const vista = await mountSuspended(PaginaReferidos, { route: '/lealtad/referidos' })
            await esperar(() => expect(vista.find('[data-prueba="tabla-referidos"]').text()).toContain('Rosa Elena Cifuentes'))
            expect(vista.text()).toContain('Calificado')
            expect(vista.findAll('[data-rechazar]')).toHaveLength(2)
        })

        it('reporte: cuadra; si el libro no coincide, el aviso se ve arriba', async () => {
            const vista = await mountSuspended(PaginaReporte, { route: '/reportes/lealtad' })
            await esperar(() => expect(vista.find('[data-prueba="cuadra-lealtad"]').text()).toBe('Cuadra con el libro'))
            expect(vista.find('[data-prueba="lealtad-no-cuadra"]').exists()).toBe(false)
            vista.unmount()

            bd.pasivoLibroLealtad[1] = '20.00'
            const mal = await mountSuspended(PaginaReporte, { route: '/reportes/lealtad' })
            await esperar(() => expect(mal.find('[data-prueba="lealtad-no-cuadra"]').exists()).toBe(true))
            expect(mal.find('[data-prueba="lealtad-no-cuadra"]').text()).toContain('lotes Q 18.40 · 2.1.10 Q 20.00')
            expect(mal.find('[data-prueba="cuadra-lealtad"]').text()).toBe('No cuadra')
        })

        it('bitácora: plan_temporal es una entidad conocida', () => {
            expect(ENTIDADES_BITACORA.plan_temporal?.etiqueta).toBe('Plan temporal')
        })
    })
})
