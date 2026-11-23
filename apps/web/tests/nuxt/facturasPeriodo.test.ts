import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import { meAdmin, meCajero } from '~~/fixtures/auth/sesiones'
import { bd } from '~~/fixtures/bd'
import PaginaFacturasPeriodo from '~/pages/servicios/[id]/facturas-periodo.vue'
import PaginaServicio from '~/pages/servicios/[id]/index.vue'
import { opcionesMasServicio } from '../ayudas/fichaServicio'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

const RUTA_VISTA = 'GET /api/v1/servicios/:id/periodos-facturables'
const RUTA_EMITIR = 'POST /api/v1/servicios/:id/facturas-periodo'

function periodo(datos: Partial<PeriodoFacturable> & Pick<PeriodoFacturable, 'periodo' | 'estado'>): PeriodoFacturable {
    return {
        hasta: datos.periodo.replace(/-01$/, '-30'),
        dias: 30,
        dias_ciclo: 30,
        factor: '1',
        prorrateado: false,
        vence_en: datos.periodo.replace(/-01$/, '-06'),
        monto: '150.00',
        pagado: '0.00',
        factura_id: null,
        factura_estado: null,
        bonificacion_id: null,
        sera_bonificacion: false,
        error: null,
        ...datos,
    }
}

/** Deja `monto` de saldo a favor al cliente (un pago sin aplicar). */
function darSaldoAFavor(clienteId: number, monto: string) {
    const base = bd.pagos.find(p => p.empresa_id === 1)
    if (!base) {
        throw new Error('sin pagos de referencia')
    }
    bd.pagos.push({ ...structuredClone(base), id: 9_000, cliente_id: clienteId, monto, aplicaciones: [], estado: 'registrado', empresa_id: 1 })
}

function filas(vista: VueWrapper) {
    return vista.findAll('[data-prueba="lista-periodos"] li')
}

function estadoDe(vista: VueWrapper, inicio: string): string | undefined {
    return vista.find(`[data-periodo="${inicio}"]`).attributes('data-estado')
}

async function marcar(vista: VueWrapper, inicio: string) {
    await vista.find(`[data-prueba="marcar-${inicio}"] button, button[data-prueba="marcar-${inicio}"]`).trigger('click')
}

/**
 * Emitir facturas de periodos a mano (A3, pedido del PM del 19 nov): estados, selección, «Adelantar
 * N meses», resumen con saldo a favor, anteriores con su permiso y motivo, errores y no emitible.
 * Hoy de los fixtures: 15 de octubre de 2026 (septiembre y octubre ya emitidos).
 */
describe('facturas de periodos', () => {
    beforeEach(() => {
        reiniciarFixtures()
        fijarHoyFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
    })

    afterEach(() => {
        soltarReloj()
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('cada estado con icono, texto y color; nunca primary', () => {
        for (const presentacion of Object.values(ESTADOS_PERIODO)) {
            expect(presentacion.etiqueta).not.toBe('')
            expect(presentacion.icono).toMatch(/^i-lucide-/)
            expect(presentacion.color).not.toBe('primary')
        }
        expect(Object.keys(ESTADOS_PERIODO).sort()).toEqual(['antes_de_facturar_desde', 'antes_del_inicio', 'bonificada', 'emitida', 'futuro', 'pendiente'])
        expect(ESTADOS_PERIODO.antes_del_inicio.etiqueta).toBe('Antes del inicio del servicio')
        expect(Object.keys(MOTIVOS_NO_EMITIBLE).sort()).toEqual(['servicio_pendiente_instalacion', 'servicio_retirado', 'sin_plantilla'])
    })

    it('selección: solo pendientes y futuros con monto; anteriores con su permiso; adelantar N', () => {
        const lista = [
            periodo({ periodo: '2026-07-01', estado: 'antes_del_inicio' }),
            periodo({ periodo: '2026-08-01', estado: 'antes_de_facturar_desde' }),
            periodo({ periodo: '2026-09-01', estado: 'emitida', factura_id: 1 }),
            periodo({ periodo: '2026-10-01', estado: 'pendiente' }),
            periodo({ periodo: '2026-11-01', estado: 'futuro' }),
            periodo({ periodo: '2026-12-01', estado: 'futuro', monto: null, error: 'Libro bloqueado' }),
            periodo({ periodo: '2027-01-01', estado: 'futuro' }),
            periodo({ periodo: '2027-02-01', estado: 'futuro' }),
            periodo({ periodo: '2027-03-01', estado: 'bonificada', bonificacion_id: 3 }),
        ]
        const elegibles = (conAnteriores: boolean) => lista.filter(p => periodoElegible(p, conAnteriores)).map(p => p.periodo)
        expect(elegibles(false)).toEqual(['2026-10-01', '2026-11-01', '2027-01-01', '2027-02-01'])
        expect(elegibles(true)).toEqual(['2026-07-01', '2026-08-01', '2026-10-01', '2026-11-01', '2027-01-01', '2027-02-01'])

        // Adelantar: los próximos N futuros con monto; lo pendiente marcado se queda, los demás futuros salen.
        expect(adelantar(lista, ['2026-10-01', '2027-02-01'], 2)).toEqual(['2026-10-01', '2026-11-01', '2027-01-01'])
        expect(adelantar(lista, [], 10)).toEqual(['2026-11-01', '2027-01-01', '2027-02-01'])
    })

    it('resumen: total, lo que cubre el saldo a favor y lo que queda; null si falta un monto', () => {
        const lista = [
            periodo({ periodo: '2026-11-01', estado: 'futuro' }),
            periodo({ periodo: '2026-12-01', estado: 'futuro' }),
            periodo({ periodo: '2027-01-01', estado: 'futuro', monto: null, error: 'x' }),
        ]
        const r = resumenEmision(lista, ['2026-11-01', '2026-12-01'], '200.00')
        expect(r && [r.cantidad, r.total.toFixed(2), r.cubre.toFixed(2), r.porCobrar.toFixed(2)]).toEqual([2, '300.00', '200.00', '100.00'])
        const sobra = resumenEmision(lista, ['2026-11-01'], '500.00')
        expect(sobra && [sobra.cubre.toFixed(2), sobra.porCobrar.toFixed(2)]).toEqual(['150.00', '0.00'])
        expect(resumenEmision(lista, ['2027-01-01'], '0.00')).toBeNull()
        // con un monto editado, el total usa el que se cobrará
        const editado = resumenEmision(lista, ['2026-11-01', '2026-12-01'], '0.00', { '2026-11-01': '99.50', '2026-12-01': 'abc' })
        expect(editado?.total.toFixed(2)).toBe('249.50')
        expect(cubiertoPorSaldo(periodo({ periodo: '2026-11-01', estado: 'futuro', pagado: '150.00' }))).toBe('150.00')
        expect(cubiertoPorSaldo(periodo({ periodo: '2026-09-01', estado: 'emitida', factura_id: 1, pagado: '150.00' }))).toBeNull()
    })

    it('esquema: motivo obligatorio con anteriores; de 3 a 500; cuerpo ordenado', () => {
        expect(esquemaFacturasPeriodo(false).safeParse({ periodos: [], montos: {}, motivo: '' }).success).toBe(false)
        expect(esquemaFacturasPeriodo(false).safeParse({ periodos: ['2026-11-01'], montos: {}, motivo: '' }).success).toBe(true)
        const sinMotivo = esquemaFacturasPeriodo(true).safeParse({ periodos: ['2026-08-01'], montos: {}, motivo: '  ' })
        expect(sinMotivo.error?.issues.map(i => i.path.join('.'))).toEqual(['motivo'])
        expect(esquemaFacturasPeriodo(false).safeParse({ periodos: ['2026-11-01'], montos: {}, motivo: 'ab' }).success).toBe(false)
        expect(esquemaFacturasPeriodo(false).safeParse({ periodos: ['2026-11-01'], montos: {}, motivo: 'x'.repeat(501) }).success).toBe(false)
        const datos = esquemaFacturasPeriodo(true).parse({ periodos: ['2026-12-01', '2026-08-01'], montos: {}, motivo: ' Cobro acordado ' })
        expect(cuerpoFacturasPeriodo(datos)).toEqual({ periodos: ['2026-08-01', '2026-12-01'], motivo: 'Cobro acordado' })
        expect(cuerpoFacturasPeriodo({ periodos: ['2026-11-01'], montos: {}, motivo: '', tramo: 'ninguno', monto_tramo: '' })).toEqual({ periodos: ['2026-11-01'] })
    })

    it('monto editado: mayor que cero con 2 decimales, motivo obligatorio y solo lo que cambió va al POST', () => {
        const lista = [periodo({ periodo: '2026-11-01', estado: 'futuro' }), periodo({ periodo: '2026-12-01', estado: 'futuro' })]
        expect(montoEditado(lista[0]!, { '2026-11-01': '150' })).toBeNull()
        expect(montoEditado(lista[0]!, { '2026-11-01': ' 120.5 ' })).toBe('120.50')
        expect(montoEditado(lista[0]!, { '2026-11-01': '' })).toBeNull()
        const esquema = esquemaFacturasPeriodo(false, lista)
        const sinMotivo = esquema.safeParse({ periodos: ['2026-11-01'], montos: { '2026-11-01': '120.00' }, motivo: '' })
        expect(sinMotivo.error?.issues.map(i => i.path.join('.'))).toEqual(['motivo'])
        for (const malo of ['0', '0.00', '-5', '1.234', 'abc']) {
            const r = esquema.safeParse({ periodos: ['2026-11-01'], montos: { '2026-11-01': malo }, motivo: 'Acuerdo' })
            expect(r.error?.issues.map(i => i.path.join('.'))).toEqual(['montos.2026-11-01'])
        }
        // igual al calculado: no es edición ni pide motivo
        expect(esquema.safeParse({ periodos: ['2026-11-01'], montos: { '2026-11-01': '150.00' }, motivo: '' }).success).toBe(true)
        // un monto de un periodo no marcado no cuenta
        expect(esquema.safeParse({ periodos: ['2026-12-01'], montos: { '2026-11-01': '1' }, motivo: '' }).success).toBe(true)
        const datos = esquema.parse({ periodos: ['2026-12-01', '2026-11-01'], montos: { '2026-11-01': '150', '2026-12-01': '99.9' }, motivo: 'Acuerdo' })
        expect(cuerpoFacturasPeriodo(datos, lista)).toEqual({ periodos: ['2026-11-01', '2026-12-01'], montos: [{ periodo: '2026-12-01', monto: '99.90' }], motivo: 'Acuerdo' })
    })

    it('errores de la emisión en llano por su regla', () => {
        const p = problemaEmision({ type: 'urn:argosisp:problema:antes_de_facturar_desde', title: 'Regla de negocio', status: 422, errors: [{ field: 'periodos', message: 'x', rule: 'antes_de_facturar_desde' }] })
        expect(p.title).toBe('No se emitieron las facturas')
        expect(p.detail).toContain('Emitir periodo anterior')
        expect(problemaEmision({ type: 'x', title: 'Otro', status: 422, errors: [{ field: 'motivo', message: 'x', rule: 'motivo_requerido' }] }).detail).toContain('motivo')
        expect(problemaEmision({ type: 'about:blank', title: 'Error interno', status: 500 }).title).toBe('Error interno')
        expect(avisoEmision({ servicio_id: 1, cliente_id: 1, creadas: [], bonificadas: [], omitidas: [], tramo_inicial: null, saldo_a_favor: '0.00' })).toBe('0 facturas emitidas')
    })

    it('vista previa: emitidas, futuros hasta 12 con vencimiento; hasta más allá del máximo es 422', async () => {
        const r = await useFacturasPeriodo().periodos(1)
        expect(r.ok).toBe(true)
        if (!r.ok) {
            return
        }
        expect(r.data).toMatchObject({ emitible: true, motivo: null, hoy: '2026-10-15', maximo_futuros: 12, maximo_anteriores: 24 })
        // 24 meses antes del inicio del servicio, ascendentes, que vencen desde hoy
        const anteriores = r.data.periodos.filter(p => p.estado === 'antes_del_inicio')
        expect(anteriores).toHaveLength(24)
        expect(r.data.periodos.slice(0, 24)).toEqual(anteriores)
        expect(anteriores.every(p => p.vence_en >= '2026-10-15' && p.monto === bd.servicios[0]?.precio_mensual)).toBe(true)
        expect(r.data.periodos.filter(p => p.estado === 'emitida').map(p => p.periodo)).toEqual(['2026-09-01', '2026-10-01'])
        const futuros = r.data.periodos.filter(p => p.estado === 'futuro')
        expect(futuros).toHaveLength(12)
        expect(futuros[0]).toMatchObject({ periodo: '2026-11-01', hasta: '2026-11-30', monto: bd.servicios[0]?.precio_mensual })
        const fuera = await useFacturasPeriodo().periodos(1, '2028-01-01')
        expect(!fuera.ok && fuera.problema.errors?.[0]?.rule).toBe('maximo_periodos_futuros')
    })

    it('pantalla: estados visibles, solo se marcan pendientes y futuros; adelantar 3 y emitir', async () => {
        // Octubre sin factura: pendiente (el cron la emitiría hoy).
        bd.facturas = bd.facturas.filter(f => f.clave_unica !== '1-2026-10-01')
        const vista = await mountSuspended(PaginaFacturasPeriodo, { route: '/servicios/1/facturas-periodo' })
        await esperar(() => expect(filas(vista).length).toBeGreaterThan(10))
        expect(estadoDe(vista, '2026-09-01')).toBe('emitida')
        expect(estadoDe(vista, '2026-10-01')).toBe('pendiente')
        expect(estadoDe(vista, '2026-11-01')).toBe('futuro')
        expect(vista.find('[data-periodo="2026-09-01"]').text()).toContain('Emitida')
        expect(vista.find('[data-periodo="2026-10-01"]').text()).toContain('Sin emitir')
        expect(vista.find('[data-prueba="marcar-2026-09-01"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="marcar-2026-10-01"]').exists()).toBe(true)

        await marcar(vista, '2026-10-01')
        await vista.find('[data-prueba="adelantar"]').trigger('click')
        const precio = bd.servicios[0]?.precio_mensual ?? '0'
        await esperar(() => expect(vista.find('[data-prueba="emitir-periodos"]').text()).toContain('Emitir 4 facturas'))
        expect(vista.find('[data-prueba="resumen-total"]').text()).toBe(formatearQuetzales(new Decimal(precio).times(4)))
        expect(vista.find('[data-prueba="resumen-por-cobrar"]').text()).toBe(formatearQuetzales(new Decimal(precio).times(4)))

        await vista.find('form').trigger('submit')
        await esperar(() => expect(vista.find('[data-prueba="facturas-periodo-resultado"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="facturas-periodo-resultado"]').text()).toContain('4 facturas emitidas')
        expect(vista.findAll('[data-creada]').map(c => c.attributes('data-creada'))).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01'])
        await esperar(() => expect(estadoDe(vista, '2026-12-01')).toBe('emitida'))
        expect(vista.find('[data-prueba="facturas-periodo-ver-facturas"]').attributes('href')).toContain('servicio=1')
        expect(bd.facturas.filter(f => f.clave_unica === '1-2026-11-01')).toHaveLength(1)
        vista.unmount()
    })

    it('saldo a favor: cada futuro dice cuánto cubre y el resumen lo descuenta', async () => {
        const clienteId = bd.servicios[0]?.cliente_id ?? 1
        const precio = new Decimal(bd.servicios[0]?.precio_mensual ?? '0')
        darSaldoAFavor(clienteId, precio.times(2).toFixed(2))
        const vista = await mountSuspended(PaginaFacturasPeriodo, { route: '/servicios/1/facturas-periodo' })
        await esperar(() => expect(filas(vista).length).toBeGreaterThan(10))
        expect(vista.find('[data-periodo="2026-11-01"] [data-prueba="cubierto-saldo"]').text()).toContain('cubierto por saldo a favor')
        expect(vista.find('[data-periodo="2027-01-01"] [data-prueba="cubierto-saldo"]').exists()).toBe(false)
        await vista.find('[data-prueba="adelantar"]').trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="resumen-cubre"]').text()).toBe(formatearQuetzales(precio.times(2))))
        expect(vista.find('[data-prueba="resumen-por-cobrar"]').text()).toBe(formatearQuetzales(precio))

        await vista.find('form').trigger('submit')
        await esperar(() => expect(vista.find('[data-prueba="facturas-periodo-resultado"]').exists()).toBe(true))
        expect(vista.find('[data-creada="2026-11-01"]').text()).toContain('Pagada')
        expect(vista.find('[data-creada="2027-01-01"]').text()).toContain('Emitida')
        vista.unmount()
    })

    it('anteriores al inicio del cobro: con el permiso, motivo obligatorio y la excepción explicada', async () => {
        const vista = await mountSuspended(PaginaFacturasPeriodo, { route: '/servicios/9/facturas-periodo' })
        await esperar(() => expect(filas(vista).length).toBeGreaterThan(10))
        expect(estadoDe(vista, '2026-08-01')).toBe('antes_de_facturar_desde')
        expect(vista.find('[data-prueba="aviso-anterior"]').exists()).toBe(false)

        await marcar(vista, '2026-08-01')
        await esperar(() => expect(vista.find('[data-prueba="aviso-anterior"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="aviso-anterior"]').text()).toContain('no cobrar hacia atrás')
        const antes = bd.facturas.length
        await vista.find('form').trigger('submit')
        await esperar(() => expect(vista.text()).toContain('Obligatorio: emites un periodo anterior'))
        expect(bd.facturas.length).toBe(antes)

        await vista.find('[data-prueba="motivo-periodos"]').setValue('Acuerdo con el cliente por agosto')
        await vista.find('form').trigger('submit')
        await esperar(() => expect(vista.find('[data-creada="2026-08-01"]').exists()).toBe(true))
        expect(bd.acciones.at(-1)).toMatchObject({ accion: 'facturas.emitir_periodos', entidad_id: 9 })
        vista.unmount()
    })

    it('antes del inicio del servicio: plegados, con permiso y motivo; vencen desde hoy', async () => {
        const vista = await mountSuspended(PaginaFacturasPeriodo, { route: '/servicios/1/facturas-periodo' })
        await esperar(() => expect(filas(vista).length).toBeGreaterThan(10))
        const r = await useFacturasPeriodo().periodos(1)
        const ultimo = r.ok ? r.data.periodos.filter(p => p.estado === 'antes_del_inicio').at(-1) : undefined
        expect(ultimo).toBeDefined()
        const inicio = ultimo?.periodo ?? ''
        // plegados al entrar
        expect(vista.find(`[data-periodo="${inicio}"]`).exists()).toBe(false)
        expect(vista.find('[data-prueba="ver-anteriores"]').text()).toContain('24 periodos antes del inicio del servicio')
        await vista.find('[data-prueba="ver-anteriores"]').trigger('click')
        await esperar(() => expect(estadoDe(vista, inicio)).toBe('antes_del_inicio'))
        expect(vista.find(`[data-periodo="${inicio}"]`).text()).toContain('Antes del inicio del servicio')

        await marcar(vista, inicio)
        await esperar(() => expect(vista.find('[data-prueba="aviso-anterior"]').text()).toContain('vencen desde hoy'))
        await vista.find('form').trigger('submit')
        await esperar(() => expect(vista.text()).toContain('Obligatorio: emites un periodo anterior'))

        await vista.find('[data-prueba="motivo-periodos"]').setValue('Usó el servicio antes del alta')
        await vista.find('form').trigger('submit')
        await esperar(() => expect(vista.find(`[data-creada="${inicio}"]`).exists()).toBe(true))
        const factura = bd.facturas.find(f => f.clave_unica === `1-${inicio}`)
        expect(factura?.vence_en).toBe(ultimo?.vence_en)
        expect((factura?.vence_en ?? '') >= '2026-10-15').toBe(true)
        vista.unmount()
    })

    it('monto editado en la fila: pide motivo y emite con el monto escrito', async () => {
        const vista = await mountSuspended(PaginaFacturasPeriodo, { route: '/servicios/1/facturas-periodo' })
        await esperar(() => expect(filas(vista).length).toBeGreaterThan(10))
        expect(vista.find('[data-prueba="monto-2026-11-01"]').exists()).toBe(false)
        await marcar(vista, '2026-11-01')
        await esperar(() => expect(vista.find('[data-prueba="monto-2026-11-01"]').exists()).toBe(true))
        await vista.find('[data-prueba="monto-2026-11-01"] input, input[data-prueba="monto-2026-11-01"]').setValue('99.50')
        await esperar(() => expect(vista.find('[data-prueba="monto-editado-2026-11-01"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="resumen-total"]').text()).toBe(formatearQuetzales('99.50'))
        await vista.find('form').trigger('submit')
        await esperar(() => expect(vista.text()).toContain('Obligatorio: cambiaste un monto'))

        await vista.find('[data-prueba="motivo-periodos"]').setValue('Acuerdo con el cliente')
        await vista.find('form').trigger('submit')
        await esperar(() => expect(vista.find('[data-creada="2026-11-01"]').exists()).toBe(true))
        expect(bd.facturas.find(f => f.clave_unica === '1-2026-11-01')?.total).toBe('99.50')
        vista.unmount()
    })

    it('tramo inicial: esquema y cuerpo (primera factura o cargo único con su monto sugerido)', () => {
        const tramo = {
            desde: '2026-09-01', hasta: '2026-09-15', dias: 15, dias_ciclo: 30, primer_periodo: '2026-09-16', primer_periodo_libre: true,
            monto_proporcional: '100.00', vence_cargo: '2026-10-20', cobrado_como: null, factura_id: null,
        } as const
        const lista = [periodo({ periodo: '2026-09-16', estado: 'pendiente' })]
        const esquema = esquemaFacturasPeriodo(false, lista, tramo)
        // el cargo puede ir solo; con motivo obligatorio
        const sinMotivo = esquema.safeParse({ periodos: [], montos: {}, motivo: '', tramo: 'cargo_unico', monto_tramo: '100.00' })
        expect(sinMotivo.error?.issues.map(i => i.path.join('.'))).toEqual(['motivo'])
        const cargo = esquema.parse({ periodos: [], montos: {}, motivo: 'Usó del 1 al 15', tramo: 'cargo_unico', monto_tramo: '100.00' })
        expect(cuerpoFacturasPeriodo(cargo, lista, tramo)).toEqual({ tramo_inicial: { modo: 'cargo_unico' }, motivo: 'Usó del 1 al 15' })
        const editado = esquema.parse({ periodos: [], montos: {}, motivo: 'Acuerdo', tramo: 'cargo_unico', monto_tramo: '80' })
        expect(cuerpoFacturasPeriodo(editado, lista, tramo)).toEqual({ tramo_inicial: { modo: 'cargo_unico', monto: '80.00' }, motivo: 'Acuerdo' })
        expect(esquema.safeParse({ periodos: [], montos: {}, motivo: 'Acuerdo', tramo: 'cargo_unico', monto_tramo: '0' }).error?.issues.map(i => i.path.join('.'))).toEqual(['monto_tramo'])
        // primera factura: exige el primer periodo marcado
        expect(esquema.safeParse({ periodos: [], montos: {}, motivo: 'Acuerdo', tramo: 'primera_factura', monto_tramo: '' }).error?.issues.map(i => i.path.join('.'))).toEqual(['periodos', 'tramo'])
        const primera = esquema.parse({ periodos: ['2026-09-16'], montos: {}, motivo: 'Acuerdo', tramo: 'primera_factura', monto_tramo: '100.00' })
        expect(cuerpoFacturasPeriodo(primera, lista, tramo)).toEqual({ periodos: ['2026-09-16'], tramo_inicial: { modo: 'primera_factura' }, motivo: 'Acuerdo' })
        // el resumen suma el cargo
        expect(resumenEmision(lista, [], '0.00', {}, '100.00')?.total.toFixed(2)).toBe('100.00')
    })

    it('pantalla: días antes del primer periodo como cargo único (sugerido proporcional) o en la primera factura', async () => {
        // servicio 1 instalado el 16 de septiembre, sin facturas aún
        bd.facturacionServicios[1] = { inicio: '2026-09-16', facturar_desde: null }
        bd.facturas = bd.facturas.filter(f => f.servicio_id !== 1)
        const precio = new Decimal(bd.servicios[0]?.precio_mensual ?? '0')
        const sugerido = precio.times(15).div(30).toFixed(2)
        const vista = await mountSuspended(PaginaFacturasPeriodo, { route: '/servicios/1/facturas-periodo' })
        await esperar(() => expect(vista.find('[data-prueba="tramo-inicial"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="tramo-inicial"]').text()).toContain('15 días')
        expect(estadoDe(vista, '2026-09-16')).toBe('pendiente')

        await vista.find('[data-prueba="opciones-tramo"] input[value="cargo_unico"], [data-prueba="opciones-tramo"] button[value="cargo_unico"]').trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="monto-tramo"]').exists()).toBe(true))
        expect((vista.find('input[data-prueba="monto-tramo"], [data-prueba="monto-tramo"] input').element as HTMLInputElement).value).toBe(sugerido)
        await esperar(() => expect(vista.find('[data-prueba="resumen-total"]').text()).toBe(formatearQuetzales(sugerido)))
        await vista.find('form').trigger('submit')
        await esperar(() => expect(vista.text()).toContain('Obligatorio: cobras días antes del primer periodo'))
        await vista.find('[data-prueba="motivo-periodos"]').setValue('Usó el servicio del 1 al 15')
        await vista.find('form').trigger('submit')
        await esperar(() => expect(vista.find('[data-prueba="resultado-cargo-tramo"]').exists()).toBe(true))
        expect(bd.facturas.find(f => f.clave_unica === 'cargo-tramo-1-2026-09-01')?.total).toBe(sugerido)
        await esperar(() => expect(vista.find('[data-prueba="tramo-cobrado"]').text()).toContain('como cargo único'))
        vista.unmount()

        // otra vez desde cero: incluirlo en la primera factura marca ese periodo
        reiniciarFixtures()
        fijarHoyFixtures()
        bd.facturacionServicios[1] = { inicio: '2026-09-16', facturar_desde: null }
        bd.facturas = bd.facturas.filter(f => f.servicio_id !== 1)
        const otra = await mountSuspended(PaginaFacturasPeriodo, { route: '/servicios/1/facturas-periodo' })
        await esperar(() => expect(otra.find('[data-prueba="tramo-inicial"]').exists()).toBe(true))
        await otra.find('[data-prueba="opciones-tramo"] input[value="primera_factura"], [data-prueba="opciones-tramo"] button[value="primera_factura"]').trigger('click')
        await esperar(() => expect(otra.find('[data-prueba="incluye-tramo"]').exists()).toBe(true))
        expect(otra.find('[data-prueba="emitir-periodos"]').text()).toContain('Emitir 1 factura')
        await otra.find('[data-prueba="motivo-periodos"]').setValue('Usó el servicio desde el 1')
        await otra.find('form').trigger('submit')
        await esperar(() => expect(otra.find('[data-creada="2026-09-16"]').exists()).toBe(true))
        await esperar(() => expect(otra.find('[data-prueba="tramo-cobrado"]').text()).toContain('en la primera factura'))
        otra.unmount()
    })

    it('tramo sin el permiso (cajero): se explica pero no hay opciones; la API responde 422', async () => {
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        bd.facturacionServicios[1] = { inicio: '2026-09-16', facturar_desde: null }
        bd.facturas = bd.facturas.filter(f => f.servicio_id !== 1)
        const vista = await mountSuspended(PaginaFacturasPeriodo, { route: '/servicios/1/facturas-periodo' })
        await esperar(() => expect(vista.find('[data-prueba="tramo-inicial"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="tramo-inicial"]').text()).toContain('Emitir periodo anterior')
        expect(vista.find('[data-prueba="opciones-tramo"]').exists()).toBe(false)
        vista.unmount()
        const r = await useFacturasPeriodo().emitir(1, { tramo_inicial: { modo: 'cargo_unico' }, motivo: 'Prueba' }, nuevaClaveIdempotencia())
        expect(!r.ok && reglaEmision(r.problema)).toBe('tramo_inicial_sin_permiso')
    })

    it('anteriores sin el permiso (cajero): se ven pero no se eligen; la API responde 422', async () => {
        sesionFixture('fixture-cajero')
        useUsuarioActual().value = meCajero
        expect(meCajero.permisos).toContain('facturas.emitir_periodos')
        expect(meCajero.permisos).not.toContain('facturas.emitir_periodo_anterior')
        const vista = await mountSuspended(PaginaFacturasPeriodo, { route: '/servicios/9/facturas-periodo' })
        await esperar(() => expect(filas(vista).length).toBeGreaterThan(10))
        expect(vista.find('[data-prueba="marcar-2026-08-01"]').exists()).toBe(false)
        expect(vista.find('[data-periodo="2026-08-01"]').text()).toContain('Emitir periodo anterior')
        expect(vista.find('[data-prueba="marcar-2026-11-01"]').exists()).toBe(true)
        vista.unmount()

        const r = await useFacturasPeriodo().emitir(9, { periodos: ['2026-08-01'], motivo: 'Prueba' }, nuevaClaveIdempotencia())
        expect(!r.ok && reglaEmision(r.problema)).toBe('antes_de_facturar_desde')
        const delInicio = await useFacturasPeriodo().emitir(9, { periodos: ['2026-06-01'], motivo: 'Prueba' }, nuevaClaveIdempotencia())
        expect(!delInicio.ok && reglaEmision(delInicio.problema)).toBe('antes_del_inicio')
        // sin editar_monto_periodo: ni el campo ni el permiso en la API
        expect(meCajero.permisos).not.toContain('facturas.editar_monto_periodo')
        const editar = await useFacturasPeriodo().emitir(9, { periodos: ['2026-11-01'], montos: [{ periodo: '2026-11-01', monto: '1.00' }], motivo: 'Prueba' }, nuevaClaveIdempotencia())
        expect(!editar.ok && reglaEmision(editar.problema)).toBe('editar_monto_sin_permiso')
    })

    it('la emisión no duplica: lo ocupado va en omitidas; motivo_requerido sin motivo', async () => {
        const r = await useFacturasPeriodo().emitir(1, { periodos: ['2026-10-01', '2026-11-01'] }, nuevaClaveIdempotencia())
        expect(r.ok && r.data.omitidas).toEqual([{ periodo: '2026-10-01', motivo: 'ya_emitida', factura_id: expect.any(Number), bonificacion_id: null }])
        expect(r.ok && r.data.creadas.map(c => c.periodo)).toEqual(['2026-11-01'])
        const sinMotivo = await useFacturasPeriodo().emitir(9, { periodos: ['2026-07-01'] }, nuevaClaveIdempotencia())
        expect(!sinMotivo.ok && reglaEmision(sinMotivo.problema)).toBe('motivo_requerido')
    })

    it('si la vista previa falla: error con Reintentar y sin totales', async () => {
        simularFalla(RUTA_VISTA, 500)
        const vista = await mountSuspended(PaginaFacturasPeriodo, { route: '/servicios/1/facturas-periodo' })
        await esperar(() => expect(vista.find('[data-prueba="facturas-periodo-problema"]').exists()).toBe(true))
        expect(vista.text()).toContain('Reintentar')
        expect(vista.find('[data-prueba="resumen-periodos"]').exists()).toBe(false)
        expect(vista.find('[data-prueba="lista-periodos"]').exists()).toBe(false)

        bd.fallas = {}
        const boton = vista.findAll('button').find(b => b.text().includes('Reintentar'))
        await boton?.trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="lista-periodos"]').exists()).toBe(true))
        vista.unmount()
    })

    it('si la emisión falla: error visible con Reintentar, que repite con la misma clave', async () => {
        simularFalla(RUTA_EMITIR, 500)
        const vista = await mountSuspended(PaginaFacturasPeriodo, { route: '/servicios/1/facturas-periodo' })
        await esperar(() => expect(filas(vista).length).toBeGreaterThan(10))
        await vista.find('[data-prueba="adelantar"]').trigger('click')
        await vista.find('form').trigger('submit')
        await esperar(() => expect(vista.find('[data-prueba="facturas-periodo-error-envio"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="facturas-periodo-resultado"]').exists()).toBe(false)

        bd.fallas = {}
        const boton = vista.find('[data-prueba="facturas-periodo-error-envio"]').findAll('button').find(b => b.text().includes('Reintentar'))
        await boton?.trigger('click')
        await esperar(() => expect(vista.find('[data-prueba="facturas-periodo-resultado"]').exists()).toBe(true))
        expect(vista.findAll('[data-creada]')).toHaveLength(3)
        vista.unmount()
    })

    it('no emitible: retirado y sin plantilla explican el motivo y no dejan emitir', async () => {
        const retirado = bd.servicios.find(s => s.estado === 'retirado')
        const sinPlantilla = bd.servicios.find(s => s.plantilla_facturacion_id === null && s.estado !== 'retirado')
        for (const [servicio, texto] of [[retirado, 'retirado'], [sinPlantilla, 'plantilla de facturación']] as const) {
            const vista = await mountSuspended(PaginaFacturasPeriodo, { route: `/servicios/${servicio?.id ?? 0}/facturas-periodo` })
            await esperar(() => expect(vista.find('[data-prueba="facturas-periodo-no-emitible"]').exists()).toBe(true))
            expect(vista.find('[data-prueba="facturas-periodo-no-emitible"]').text()).toContain(texto)
            expect(vista.find('[data-prueba="emitir-periodos"]').exists()).toBe(false)
            vista.unmount()
        }
        const r = await useFacturasPeriodo().emitir(retirado?.id ?? 0, { periodos: ['2026-11-01'] }, nuevaClaveIdempotencia())
        expect(!r.ok && reglaEmision(r.problema)).toBe('servicio_retirado')
    })

    it('ficha del servicio: el botón lleva a la pantalla propia; no en un retirado', async () => {
        const ficha = await mountSuspended(PaginaServicio, { route: '/servicios/1' })
        await esperar(() => expect(ficha.find('[data-prueba="mas-acciones-servicio"]').exists()).toBe(true))
        expect(await opcionesMasServicio(ficha)).toContain('Emitir facturas de periodos')
        const enlace = [...document.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]')].find(e => e.textContent?.includes('Emitir facturas de periodos'))
        expect(enlace?.getAttribute('href')).toBe('/servicios/1/facturas-periodo')
        ficha.unmount()

        const retirado = bd.servicios.find(s => s.estado === 'retirado')
        const otra = await mountSuspended(PaginaServicio, { route: `/servicios/${retirado?.id ?? 0}` })
        await esperar(() => expect(otra.text()).toContain('Servicio retirado'))
        expect(otra.find('[data-prueba="mas-acciones-servicio"]').exists()).toBe(false)
        otra.unmount()
    })
})
