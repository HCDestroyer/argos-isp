import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarFixtures } from '~~/fixtures'
import ReciboPago from '~/components/ReciboPago.vue'
import PaginaCobro from '~/pages/cobro/index.vue'

/**
 * Tarea 1 del día 4 (2.ª tanda): cobro con efectivo, depósito, transferencia, ACH y remesa, con
 * los datos que exige `registrarPago` (A3) por método.
 */
describe('cobro · cinco métodos', () => {
    const base = { monto: '150.00', caja_id: null, cuenta_bancaria_id: null, banco_origen_id: null, referencia: '', nota: '' }

    beforeEach(() => {
        reiniciarFixtures()
        useNuxtApp().$tokenSesion.value = 'fixture-cajero'
    })

    afterEach(() => {
        useNuxtApp().$tokenSesion.value = null
    })

    it('el esquema pide lo mismo que DATOS_POR_METODO de la API', () => {
        const errores = (metodo: SalidaCobro['metodo'], extra: Partial<EntradaCobro> = {}) => {
            const resultado = esquemaCobro.safeParse({ ...base, metodo, ...extra })
            return resultado.success ? [] : resultado.error.issues.map(i => i.path.join('.')).sort()
        }
        expect(errores('caja')).toEqual([])
        expect(errores('deposito')).toEqual(['cuenta_bancaria_id', 'referencia'])
        expect(errores('transferencia')).toEqual(['banco_origen_id', 'cuenta_bancaria_id', 'referencia'])
        expect(errores('ach')).toEqual(['banco_origen_id', 'cuenta_bancaria_id', 'referencia'])
        expect(errores('remesa')).toEqual(['cuenta_bancaria_id', 'referencia'])
        expect(errores('transferencia', { banco_origen_id: 2, cuenta_bancaria_id: 1, referencia: 'TRX-1' })).toEqual([])
        expect(METODOS_COBRO.map(m => m.metodo)).toEqual(expect.arrayContaining(['caja', 'deposito', 'transferencia', 'ach', 'remesa']))
    })

    it('datosBancarios solo manda los campos que pide el método', () => {
        const datos = { ...base, caja_id: 1, cuenta_bancaria_id: 1, banco_origen_id: 2, referencia: 'X' }
        expect(datosBancarios({ ...datos, metodo: 'caja' })).toEqual({ caja_id: 1 })
        expect(datosBancarios({ ...datos, metodo: 'deposito' })).toEqual({ cuenta_bancaria_id: 1 })
        expect(datosBancarios({ ...datos, metodo: 'remesa' })).toEqual({ cuenta_bancaria_id: 1 })
        expect(datosBancarios({ ...datos, metodo: 'ach' })).toEqual({ cuenta_bancaria_id: 1, banco_origen_id: 2 })
        expect(datosBancarios({ ...datos, metodo: 'agente' })).toEqual({})
    })

    it('selectores: bancos del catálogo y cuentas activas en GTQ', async () => {
        const bancos = await useBancos().listar()
        expect(bancos.ok && bancos.data.map(b => b.nombre)).toContain('Banrural')
        const cuentas = await useCuentasBancarias().listar({ activa: true })
        expect(cuentas.ok && cuentas.data.map(c => c.id)).toEqual([1, 2, 3])
    })

    it('la API (fixtures) responde 422 por campo, no_aplica y 409 por referencia repetida', async () => {
        const sinDatos = await usePagos().registrar({ cliente_id: 2, metodo: 'transferencia', monto: '10.00' }, nuevaClaveIdempotencia())
        expect(!sinDatos.ok && sinDatos.problema.errors?.map(e => [e.field, e.rule])).toEqual([
            ['banco_origen_id', 'required'],
            ['cuenta_bancaria_id', 'required'],
            ['referencia', 'required'],
        ])

        const noAplica = await usePagos().registrar({ cliente_id: 2, metodo: 'caja', monto: '10.00', cuenta_bancaria_id: 1 }, nuevaClaveIdempotencia())
        expect(!noAplica.ok && noAplica.problema.errors?.[0]).toMatchObject({ field: 'cuenta_bancaria_id', rule: 'no_aplica' })

        const dolares = await usePagos().registrar({ cliente_id: 2, metodo: 'deposito', monto: '10.00', cuenta_bancaria_id: 3, referencia: 'B-1' }, nuevaClaveIdempotencia())
        expect(!dolares.ok && dolares.problema.errors?.[0]?.field).toBe('cuenta_bancaria_id')

        const datos = { cliente_id: 2, metodo: 'transferencia' as const, monto: '10.00', banco_origen_id: 5, cuenta_bancaria_id: 1, referencia: 'TRX-778' }
        const primero = await usePagos().registrar(datos, nuevaClaveIdempotencia())
        expect(primero.ok && [primero.data.banco_origen_nombre, primero.data.cuenta_bancaria_nombre]).toEqual(['BAC Credomatic', 'Banrural · Recaudación'])

        const repetido = await usePagos().registrar(datos, nuevaClaveIdempotencia())
        expect(!repetido.ok && repetido.problema.status).toBe(409)
        expect(!repetido.ok && esReferenciaDuplicada(repetido.problema)).toBe(true)

        // La misma referencia en otra cuenta sí se acepta.
        const otraCuenta = await usePagos().registrar({ ...datos, cuenta_bancaria_id: 2 }, nuevaClaveIdempotencia())
        expect(otraCuenta.ok).toBe(true)
    })

    it('la pantalla pide banco y cuenta con transferencia, muestra el 409 junto a la referencia', async () => {
        const vista = await mountSuspended(PaginaCobro, { route: '/cobro?cliente=2' })
        await vi.waitFor(() => expect(vista.find('[data-factura="209"]').exists()).toBe(true))
        await usePagos().registrar({ cliente_id: 4, metodo: 'deposito', monto: '1.00', cuenta_bancaria_id: 1, referencia: 'BOL-55' }, nuevaClaveIdempotencia())

        const estado = (vista.vm as unknown as { $: { setupState: { estado: EntradaCobro } } }).$.setupState.estado
        estado.metodo = 'transferencia'
        await vi.waitFor(() => expect(vista.text()).toContain('Banco de origen'))
        expect(vista.text()).toContain('Cuenta de destino')
        expect(vista.text()).toContain('Referencia de la transferencia')

        estado.metodo = 'deposito'
        await vi.waitFor(() => expect(vista.text()).toContain('Número de boleta'))
        expect(vista.text()).not.toContain('Banco de origen')
        estado.cuenta_bancaria_id = 1
        estado.referencia = 'BOL-55'
        await vista.get('form').trigger('submit')
        await vi.waitFor(() => expect(vista.find('[data-prueba="referencia-duplicada"]').exists()).toBe(true))
        expect(vista.text()).toContain('Ya está registrada en otro pago')
        expect(vista.find('[aria-label="Recibo de pago"]').exists()).toBe(false)
    })

    it('el recibo muestra banco de origen, cuenta de destino y referencia', async () => {
        const pago = await usePagos().registrar({ cliente_id: 2, metodo: 'ach', monto: '150.00', banco_origen_id: 2, cuenta_bancaria_id: 1, referencia: 'ACH-0091' }, nuevaClaveIdempotencia())
        const cliente = await useClientes().ver(2)
        if (!pago.ok || !cliente.ok) {
            throw new Error('sin datos')
        }
        const recibo = await mountSuspended(ReciboPago, { props: { pago: pago.data, cliente: cliente.data } })
        expect(recibo.get('[data-prueba="recibo-banco-origen"]').text()).toBe('Banco Industrial')
        expect(recibo.get('[data-prueba="recibo-cuenta-destino"]').text()).toBe('Banrural · Recaudación')
        expect(recibo.get('[data-prueba="recibo-referencia"]').text()).toBe('ACH-0091')
        expect(recibo.text()).toContain('Referencia ACH')
    })
})
