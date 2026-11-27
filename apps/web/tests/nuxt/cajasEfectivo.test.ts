import { mountSuspended } from '@nuxt/test-utils/runtime'
import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin } from '~~/fixtures/auth/sesiones'
import { CAJA_CHICA_ID } from '~~/fixtures/cajas/efectivo'
import PaginaEfectivo from '~/pages/caja/efectivo.vue'
import { esperar } from '../ayudas/esperar'

/** Cajas y efectivo (tablero PlanCajas; B1 y B9): composables, esquemas y la pantalla. */
describe('cajas y efectivo · custodia y caja chica', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('numera los movimientos y los ordena del más reciente, con la acción de quien mira', () => {
        const base = { caja_id: 1, caja_nombre: 'Caja Central', turno_id: 1, entregado_por: 2, entregado_por_nombre: 'Carlos', recibe_nombre: 'Ana', autoentrega: false, origen: 'cierre' as const, recibido_por: null, recibido_en: null, contado: null, diferencia: null, motivo: null, empresa_id: 1, monto: '100.00' }
        const filas = movimientosEfectivo({
            entregas: [
                { ...base, id: 31, recibe_id: 1, estado: 'por_recibir', created_at: '2026-11-27T10:00:00.000Z' },
                { ...base, id: 30, recibe_id: 9, estado: 'por_recibir', created_at: '2026-11-26T10:00:00.000Z' },
            ],
            depositos: [],
            gastos: [],
            reposiciones: [],
        }, 1)
        expect(filas.map(f => f.numero)).toEqual(['E-031', 'E-030'])
        expect(filas[0]?.accion).toBe('recibir')
        expect(filas[1]?.accion).toBeNull()
        expect(filas[0]?.trayecto).toBe('Caja Central (Carlos) → Ana')
    })

    it('los esquemas espejan la API: comprobante obligatorio, sin tope y motivo si no cuadra', () => {
        const gasto = esquemaGastoCajaChica(new Decimal('500'))
        expect(gasto.safeParse({ monto: '150.00', categoria: 'vehiculos', descripcion: 'Combustible', con_factura: false, archivo: null }).success).toBe(false)
        expect(gasto.safeParse({ monto: '450.00', categoria: 'vehiculos', descripcion: 'Combustible', con_factura: false, archivo: new File(['x'], 't.png') }).success).toBe(true)
        expect(gasto.safeParse({ monto: '501.00', categoria: 'vehiculos', descripcion: 'Combustible', con_factura: false, archivo: new File(['x'], 't.png') }).success).toBe(false)
        const conteo = esquemaContarCaja(new Decimal('1180'))
        expect(conteo.safeParse({ contado: '1180.00', motivo: '' }).success).toBe(true)
        expect(conteo.safeParse({ contado: '1170.00', motivo: '' }).success).toBe(false)
        expect(conteo.safeParse({ contado: '1170.00', motivo: 'Faltó vuelto' }).success).toBe(true)
        expect(esquemaDepositoCustodia('2026-11-27', new Decimal('100')).safeParse({ monto: '120.00', boleta: 'B-1', fecha: '', cuenta_id: 16 }).success).toBe(false)
    })

    it('caja chica: efectivo + comprobantes = fondo, y reponer devuelve el fondo completo', async () => {
        const estado = await useCajaChica().estado(CAJA_CHICA_ID)
        expect(estado.ok && estado.data).toMatchObject({ efectivo: '1180.00', por_reponer: '820.00', cuadra: true, porcentaje: 59 })
        const sinMonto = await useCajaChica().reponer(CAJA_CHICA_ID, { desde: 'banco', monto: '10.00' }, 'r-1')
        expect(!sinMonto.ok && sinMonto.problema.type).toBe('urn:argosisp:problema:monto_distinto')
        const repuesta = await useCajaChica().reponer(CAJA_CHICA_ID, { desde: 'banco', monto: '820.00' }, 'r-2')
        expect(repuesta.ok && repuesta.data.gastos).toBe(5)
        const despues = await useCajaChica().estado(CAJA_CHICA_ID)
        expect(despues.ok && despues.data.efectivo).toBe('2000.00')
    })

    it('recibir con diferencia exige el motivo y pasa el efectivo a la custodia', async () => {
        const sinMotivo = await useCustodia().recibir(31, { contado: '2800.00' }, 'e-1')
        expect(!sinMotivo.ok && sinMotivo.problema.status).toBe(422)
        const recibida = await useCustodia().recibir(31, { contado: '2800.00', motivo: 'Faltó un billete' }, 'e-2')
        expect(recibida.ok && recibida.data).toMatchObject({ estado: 'recibida', diferencia: '-50.00' })
        const custodia = await useCustodia().resumen()
        expect(custodia.ok && custodia.data.total).toBe('4850.00')
    })

    it('si la custodia no se puede leer, el indicador muestra el error y no inventa el total', async () => {
        simularFalla('GET /api/v1/cajas/custodia', 500)
        const vista = await mountSuspended(PaginaEfectivo, { route: '/caja/efectivo' })
        await esperar(() => expect(vista.find('[data-indicador="custodia"]').text()).toContain('No se pudo leer'))
        expect(vista.find('[data-prueba="fuera-del-banco"]').text()).toContain('—')
        await esperar(() => expect(vista.find('[data-indicador="caja-chica"]').text()).toContain('Q 1,180.00'))
    })
})
