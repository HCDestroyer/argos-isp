import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import { SORTEO_BORRADOR_ID, SORTEO_EJECUTADO_ID } from '~~/fixtures/sorteos/datos'
import SorteoEntregarModal from '~/components/SorteoEntregarModal.vue'
import PaginaEgresos from '~/pages/egresos/index.vue'
import PaginaSorteo from '~/pages/lealtad/sorteos/[id].vue'
import { esperar } from '../ayudas/esperar'

/**
 * Sorteos al día con `a3/sorteos` (b2f90b9): un bien se entrega con la línea de su compra (`compra`) o
 * con una cuenta de la lista blanca; `proveedor` es 422; las bases exigen `fuente_valor_publico` al
 * publicar y la ejecución `valor_publico_evidencia`; «Anular entrega» (H22); Gobernación y fianza no
 * bloquean la ejecución; el egreso de un premio no se anula desde /egresos.
 */
describe('sorteos · entrega con compra, fuente del valor y anular entrega', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    async function ganadorDe(tipo: 'efectivo' | 'bien' | 'servicio') {
        const sorteo = await useSorteos().ver(SORTEO_EJECUTADO_ID)
        if (!sorteo.ok) {
            throw new Error('sin sorteo')
        }
        const ganador = sorteo.data.ganadores.find(g => g.tipo === 'titular' && premioDeGanador(sorteo.data, g)?.tipo === tipo)
        if (!ganador) {
            throw new Error(`sin ganador de ${tipo}`)
        }
        return ganador
    }

    it('lista blanca de la cuenta y líneas de bien de compras vigentes de la empresa', () => {
        const cuenta = (codigo: string, extra: Partial<Cuenta> = {}) => ({ codigo, tipo: 'activo' as const, imputable: true, contracuenta: false, auxiliar_cliente: false, empresa_id: null, activa: true, ...extra })
        expect(cuentaParaBienDePremio(cuenta('1.1.14'), 1)).toBe(true)
        expect(['1.1.01.01', '1.1.02', '1.1.07', '1.2.01.01'].map(c => cuentaParaBienDePremio(cuenta(c), 1))).toEqual([false, false, false, false])
        expect(cuentaParaBienDePremio(cuenta('1.1.14', { empresa_id: 2 }), 1)).toBe(false)
        expect(cuentaParaBienDePremio(cuenta('1.1.14', { auxiliar_cliente: true }), 1)).toBe(false)
        expect(cuentaParaBienDePremio(cuenta('5.1.03', { tipo: 'gasto' }), 1)).toBe(false)
        expect(lineasDeBien(bd.compras, 1).map(({ linea, quedan }) => [linea.id, quedan])).toEqual([[11, 2], [21, 1], [22, 1]])
        expect(lineasDeBien(bd.compras, 1, { 11: 1, 21: 1 }).map(({ linea, quedan }) => [linea.id, quedan])).toEqual([[11, 1], [22, 1]])
        expect(esCuentaDeActivoFijo('1.2.01.03') && esCuentaDeActivoFijo('1.2.02') && !esCuentaDeActivoFijo('1.1.14')).toBe(true)
    })

    it('bien: proveedor es 422; línea anulada, de otra empresa o de servicio es 422; con la compra queda entregado', async () => {
        const ganador = await ganadorDe('bien')
        const entregar = (cuerpo: Parameters<ReturnType<typeof useSorteos>['entregar']>[2]) => useSorteos().entregar(SORTEO_EJECUTADO_ID, ganador.id, cuerpo, nuevaClaveIdempotencia())
        const proveedor = await entregar({ contrapartida: 'proveedor' })
        expect(!proveedor.ok && codigoProblema(proveedor.problema)).toBe('contrapartida_proveedor')
        for (const linea of [31, 41, 23]) {
            const r = await entregar({ contrapartida: 'compra', compra_linea_id: linea })
            expect(!r.ok && r.problema.errors?.[0]?.field).toBe('compra_linea_id')
        }
        const cuentaControl = await entregar({ contrapartida: 'cuenta', cuenta_codigo: '1.1.01.01' })
        expect(!cuentaControl.ok && cuentaControl.problema.errors?.[0]?.field).toBe('cuenta_codigo')
        const demasiadas = await entregar({ contrapartida: 'compra', compra_linea_id: 11, unidades: 3 })
        expect(!demasiadas.ok && problemaSorteoLegible(demasiadas.problema).title).toBe('No quedan unidades de esa línea de compra')
        const hecho = await entregar({ contrapartida: 'compra', compra_linea_id: 11 })
        expect(hecho.ok).toBe(true)
        const entregado = hecho.ok ? hecho.data.ganadores.find(g => g.id === ganador.id) : undefined
        // 1 de las 2 unidades: la mitad de la base de la línea (Q 4,464.29 / 2, redondeado).
        expect(entregado && [entregado.estado, entregado.contrapartida, entregado.compra_linea_id, entregado.compra_unidades, entregado.compra_base]).toEqual(['entregado', 'compra 1', 11, 1, '2232.15'])
        expect(contrapartidaLegible('compra 1')).toBe('Compra #1')
        expect(contrapartidaLegible('cuenta 1.1.14')).toBe('Cuenta 1.1.14')
    })

    it('anular entrega: motivo obligatorio; el ganador vuelve a por notificar y se puede volver a entregar', async () => {
        const ganador = await ganadorDe('efectivo')
        const entrega = await useSorteos().entregar(SORTEO_EJECUTADO_ID, ganador.id, { metodo: 'caja', caja_id: 2 }, nuevaClaveIdempotencia())
        expect(entrega.ok).toBe(true)
        const corto = await useSorteos().anularEntrega(SORTEO_EJECUTADO_ID, ganador.id, 'no', nuevaClaveIdempotencia())
        expect(!corto.ok && corto.problema.errors?.[0]?.field).toBe('motivo')
        const anulada = await useSorteos().anularEntrega(SORTEO_EJECUTADO_ID, ganador.id, 'Se pagó a la persona equivocada', nuevaClaveIdempotencia())
        const vuelto = anulada.ok ? anulada.data.ganadores.find(g => g.id === ganador.id) : undefined
        expect(vuelto && [vuelto.estado, vuelto.egreso_id, vuelto.contrapartida]).toEqual(['por_notificar', null, null])
        const otraVez = await useSorteos().anularEntrega(SORTEO_EJECUTADO_ID, ganador.id, 'De nuevo', nuevaClaveIdempotencia())
        expect(!otraVez.ok && codigoProblema(otraVez.problema)).toBe('premio_no_entregado')
    })

    it('ficha: fuente en las bases, «Anular entrega» en un premio entregado y su modal', async () => {
        const ganador = await ganadorDe('efectivo')
        await useSorteos().entregar(SORTEO_EJECUTADO_ID, ganador.id, { metodo: 'caja', caja_id: 2 }, nuevaClaveIdempotencia())
        const vista = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_EJECUTADO_ID}` })
        await esperar(() => expect(vista.find('[data-prueba="sorteo-resultado"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="sorteo-fuente-valor"]').text()).toContain('Lotería Santa Lucía')
        expect(vista.findAll('[data-prueba="anular-entrega"]')).toHaveLength(1)
        expect(vista.findAll('[data-prueba="entregar-premio"]')).toHaveLength(2)
        await vista.find('[data-prueba="anular-entrega"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="anular-entrega-deshace"]')?.textContent).toContain(`anula el egreso #${880000 + ganador.id}`))
        vista.unmount()

        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'sorteos.entregar') }
        const sinPermiso = await mountSuspended(PaginaSorteo, { route: `/lealtad/sorteos/${SORTEO_EJECUTADO_ID}` })
        await esperar(() => expect(sinPermiso.find('[data-prueba="sorteo-resultado"]').exists()).toBe(true))
        expect(sinPermiso.find('[data-prueba="anular-entrega"]').exists()).toBe(false)
        sinPermiso.unmount()
    })

    it('modal de entrega de un bien: ofrece las líneas de bien (sin las ya entregadas) y las cuentas de la lista blanca', async () => {
        const sorteo = await useSorteos().ver(SORTEO_EJECUTADO_ID)
        if (!sorteo.ok) {
            throw new Error('sin sorteo')
        }
        const ganador = await ganadorDe('bien')
        const modal = await mountSuspended(SorteoEntregarModal, {
            props: { open: false, sorteoId: SORTEO_EJECUTADO_ID, ganador, premio: premioDeGanador(sorteo.data, ganador), nombre: 'Ganador', empresaId: 1, unidadesUsadas: { 21: 1 } },
        })
        await modal.setProps({ open: true })
        await esperar(() => expect(document.querySelector('[data-prueba="entrega-compra-linea"]')).not.toBeNull())
        const vm = modal.vm as unknown as { itemsLinea: { value: number }[], itemsCuentaActivo: { value: string }[] }
        await esperar(() => expect(vm.itemsLinea.map(i => i.value)).toEqual([22, 11]))
        expect(vm.itemsCuentaActivo.map(i => i.value)).toEqual(['1.1.14'])
        modal.unmount()
    })

    it('publicar exige la fuente del valor; ejecutar exige cómo se obtuvo (422 de los dos campos)', async () => {
        const actual = await useSorteos().ver(SORTEO_BORRADOR_ID)
        if (!actual.ok) {
            throw new Error('sin sorteo')
        }
        const entrada = entradaDeSorteo(actual.data)
        Object.assign(entrada, { publicacion_resultados: 'En el portal, el mismo día', fuente_valor_publico: '' })
        const sinFuente = { ...cuerpoEdicionSorteo(actual.data, esquemaSorteo.parse(entrada)) }
        sinFuente.bases = { ...sinFuente.bases }
        delete sinFuente.bases.fuente_valor_publico
        const sorteoFixture = bd.sorteos.find(s => s.id === SORTEO_BORRADOR_ID)
        if (sorteoFixture) {
            sorteoFixture.bases = { ...sorteoFixture.bases, fuente_valor_publico: undefined }
        }
        await useSorteos().editar(SORTEO_BORRADOR_ID, sinFuente)
        const publicar = await useSorteos().publicarBases(SORTEO_BORRADOR_ID, nuevaClaveIdempotencia())
        expect(!publicar.ok && publicar.problema.errors?.[0]?.field).toBe('bases.fuente_valor_publico')
        expect(esquemaEjecutarSorteo.safeParse({ valor_publico: '48213', valor_publico_evidencia: '', asistentes: [] }).error?.issues[0]?.path).toEqual(['valor_publico_evidencia'])
    })

    it('/egresos: el egreso de un premio no ofrece «Anular» (se anula desde el sorteo)', async () => {
        expect(egresoAnulable({ estado: 'registrado', categoria: 'premios', compra_id: null })).toBe(false)
        expect(egresoAnulable({ estado: 'registrado', categoria: 'otros', compra_id: 3 })).toBe(false)
        expect(egresoAnulable({ estado: 'registrado', categoria: 'otros', compra_id: null })).toBe(true)
        expect(motivoNoAnulable({ estado: 'registrado', categoria: 'premios', compra_id: null })).toContain('Anular entrega')
        const vista = await mountSuspended(PaginaEgresos, { route: '/egresos' })
        await esperar(() => expect(vista.findAll('[data-prueba="anular-egreso"]').length).toBeGreaterThan(0))
        vista.unmount()
    })
})
