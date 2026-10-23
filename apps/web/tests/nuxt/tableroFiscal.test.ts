import { mountSuspended } from '@nuxt/test-utils/runtime'
import Decimal from 'decimal.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import PaginaTablero from '~/pages/fiscal/tablero.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * Tablero fiscal (A3, fase 8 PR A). Hoy es el jueves 15/10/2026. ArgosNet (1, sobre utilidades): ISO
 * en error (`iso_base_periodo` sin confirmar), pequeño contribuyente que no aplica, el 4.º trimestre
 * del ISR con la anual, retenciones de ISR de agosto y septiembre vencidas, libros atrasados y FEL
 * obligatoria activa. Fibra del Sur (2, pequeño contribuyente): ISR e ISO que no aplican, ventas del año
 * frente al límite y FEL obligatoria desactivada.
 */

type Empresa = TableroFiscal['empresas'][number]

async function tablero(): Promise<TableroFiscal> {
    const resultado = await useTableroFiscal().ver()
    if (!resultado.ok) {
        throw new Error(resultado.problema.title)
    }
    return resultado.data
}

function bloqueDe(raiz: HTMLElement, nombre: string): HTMLElement {
    const bloque = raiz.querySelector<HTMLElement>(`[data-bloque="${nombre}"]`)
    if (!bloque) {
        throw new Error(`Sin el bloque ${nombre}`)
    }
    return bloque
}

describe('tablero fiscal', () => {
    beforeEach(() => {
        fijarHoyFixtures()
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useEmpresaActiva().elegir(1)
    })

    afterEach(() => {
        soltarReloj()
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('textos: motivo de no aplica, meses atrasados y alertas destacadas', () => {
        expect(motivoNoAplicaTablero('regimen_pequeno_contribuyente: paga el 5 % sobre sus ventas (bloque iva)')).toBe('No aplica al régimen Pequeño contribuyente: paga el 5 % sobre sus ventas (bloque iva)')
        expect(motivoNoAplicaTablero('regimen_utilidades')).toBe('No aplica al régimen Sobre utilidades')
        expect(motivoNoAplicaTablero(null)).toBe('No aplica a esta empresa')
        expect(mesAtrasado('2025-01')).toBe('ene 2025')
        const ok = { estado: 'ok' as const, motivo: null, error: null }
        const empresa: Empresa = {
            empresa_id: 2,
            regimen: 'pequeno_contribuyente',
            bloques: {
                facturado: { estado: 'error', motivo: null, error: { type: 'urn:argosisp:problema:error_interno', title: 'Error interno', status: 500 }, datos: null },
                iva: { estado: 'no_aplica', motivo: 'regimen_x', error: null, datos: null },
                isr: { estado: 'no_aplica', motivo: 'regimen_pequeno_contribuyente', error: null, datos: null },
                iso: { estado: 'no_aplica', motivo: 'regimen_pequeno_contribuyente', error: null, datos: null },
                pequeno_contribuyente: { ...ok, datos: { anio: 2026, acumulado: '510000.00', limite: '500285.00', porcentaje: '101.94', disponible: '0.00', umbrales: ['80.00', '100.00'], umbral_alcanzado: '100.00', supera_limite: true, mensaje: 'Superó el límite anual del pequeño contribuyente: debe pasar al régimen general (inv. A.3).' } },
                vencimientos: { ...ok, datos: { hasta: '2026-11-14', mora_tributaria: '0.05', vencidas: 1, obligaciones: [] } },
                libros: { ...ok, datos: { ventana_meses: 2, inicio_libros: '2025-01-01', libros: [], alerta: 'Libros sin emitir fuera del plazo (2 meses): ventas.' } },
                fel: { ...ok, datos: { modo: 'desactivada', obligacion_legal: 'obligatoria', proveedor: null, contingencia_activa: false, dte_pendientes: [], alerta: 'FEL es obligatoria para su régimen: la empresa emite sin DTE (FEL desactivada)' } },
                compras_sin_nit: { ...ok, datos: { anio: 2026, limite: '2500.00', cantidad: 0, total: '0.00', compras: [] } },
                incobrables: { ...ok, datos: { corte: '2026-10-15', base: '0.00', porcentaje: '3.00', tope: '0.00', estimacion: '0.00', disponible: '0.00', sobre_tope: false } },
                depreciacion: { ...ok, datos: { activos: 0, bajo_maximo: 0, diferencia_anual: '0.00', detalle: [] } },
            },
        }
        expect(alertasTablero(empresa).map(a => [a.clave, a.titulo])).toEqual([
            ['vencidas', '1 obligación vencida sin presentar'],
            ['pequeno_contribuyente', 'Debe pasar al régimen general'],
            ['fel', 'FEL obligatoria desactivada'],
            ['libros', 'Libros atrasados'],
        ])
        // Un bloque en error no aporta alertas (nunca se deduce nada de datos que no se leyeron).
        expect(alertasTablero({ ...empresa, bloques: { ...empresa.bloques, fel: { estado: 'error', motivo: null, error: { type: 'about:blank', title: 'x', status: 500 }, datos: null } } }).map(a => a.clave)).not.toContain('fel')
    })

    it('fixture: bloques por separado con las cifras del libro y del borrador', async () => {
        const { hoy, empresas } = await tablero()
        expect(hoy).toBe('2026-10-15')
        expect(empresas.map(e => [e.empresa_id, e.regimen])).toEqual([[1, 'utilidades']])
        const { bloques } = empresas[0]!

        // Facturado: el libro de ventas del mes (FACT A-1150) y del año.
        expect(bloques.facturado.datos?.mes).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-15', documentos: 1, base: '3000.00', iva: '360.00', total: '3360.00' })
        expect(bloques.facturado.datos?.anio.por_tipo.map(t => [t.tipo, t.documentos])).toEqual([['FACT', 7], ['NCRE', 1]])

        // IVA de octubre: los mismos totales que el borrador, sin versión todavía.
        expect(bloques.iva).toMatchObject({ estado: 'ok', datos: { impuesto: 'iva_mensual', periodo: '2026-10', declaracion: null } })
        expect(bloques.iva.datos?.totales.debito).toBe('360.00')

        // ISR: el 4.º trimestre va con la anual; el anual proyectado × 12 / 10.
        expect(bloques.isr.datos).toMatchObject({ regimen: 'utilidades', mensual: null, trimestral: null, trimestral_con_la_anual: true })
        expect(bloques.isr.datos?.anual).toMatchObject({ periodo: '2026', meses_transcurridos: 10 })
        expect(bloques.isr.datos?.anual?.isr_proyectado).toBe(new Decimal(bloques.isr.datos?.anual?.totales.isr ?? '0').times(12).dividedBy(10).toFixed(2))

        // ISO en error, sin datos; pequeño contribuyente no aplica.
        expect(bloques.iso).toMatchObject({ estado: 'error', datos: null, error: { status: 422, type: 'urn:argosisp:problema:parametro_sin_confirmar' } })
        expect(bloques.pequeno_contribuyente).toEqual({ estado: 'no_aplica', motivo: 'regimen_utilidades', error: null, datos: null })

        // Vencimientos: las retenciones de ISR de agosto y septiembre vencidas, sin borrador (sin mora).
        expect(bloques.vencimientos.datos?.vencidas).toBe(2)
        expect(bloques.vencimientos.datos?.obligaciones.filter(o => o.vencida).map(o => [o.obligacion_id, o.dias_restantes, o.mora_estimada])).toEqual([[5, -35, null], [8, -3, null]])

        // Libros desde el 1/1/2025 con ventana de 2 meses: atrasados (multa de referencia).
        expect(bloques.libros.datos?.libros.find(l => l.libro === 'diario')).toMatchObject({ habilitado: true, ultimo_emitido_hasta: '2026-06-30', meses_atrasados: 13, al_dia: false })
        expect(bloques.libros.datos?.alerta).toContain('Q5,000 por libro')

        // FEL obligatoria y activa: sin alerta.
        expect(bloques.fel.datos).toMatchObject({ modo: 'obligatoria', obligacion_legal: 'obligatoria', alerta: null })

        // Fibra del Sur: pequeño contribuyente bajo el límite, ISR e ISO no aplican, FEL desactivada.
        useEmpresaActiva().elegir(2)
        const fibra = (await tablero()).empresas[0]!
        expect(fibra.bloques.iva.datos?.impuesto).toBe('pc_mensual')
        expect(fibra.bloques.isr).toMatchObject({ estado: 'no_aplica', motivo: 'regimen_pequeno_contribuyente: paga el 5 % sobre sus ventas (bloque iva)' })
        expect(fibra.bloques.iso.estado).toBe('no_aplica')
        expect(fibra.bloques.pequeno_contribuyente.datos).toMatchObject({ anio: 2026, acumulado: '45400.00', limite: '500285.00', porcentaje: '9.07', supera_limite: false, mensaje: null })
        expect(fibra.bloques.fel.datos).toMatchObject({ modo: 'desactivada', alerta: 'FEL es obligatoria para su régimen: la empresa emite sin DTE (FEL desactivada)' })

        // «Todas» (alcance global): una sección por empresa.
        useEmpresaActiva().elegir('todas')
        expect((await tablero()).empresas.map(e => e.empresa_id)).toEqual([1, 2])
    })

    it('pantalla: bloque en error con «Reintentar» y sin cifras, no aplica atenuado, alertas y vencidas en rojo', async () => {
        const pagina = await mountSuspended(PaginaTablero)
        const raiz = pagina.element as HTMLElement
        await esperar(() => expect(raiz.querySelector('[data-empresa="1"]')).not.toBeNull())

        const iso = bloqueDe(raiz, 'iso')
        expect(iso.dataset.estado).toBe('error')
        expect(iso.textContent).toContain('Falta un valor que debe confirmar el contador')
        expect(iso.textContent).toContain('iso_base_periodo')
        expect(iso.textContent).toContain('Reintentar')
        expect(iso.textContent).not.toMatch(/Q\s?\d/)
        expect(iso.querySelector('[data-estimado]')).toBeNull()

        const pc = bloqueDe(raiz, 'pequeno_contribuyente')
        expect(pc.dataset.estado).toBe('no_aplica')
        expect(pc.querySelector('[data-prueba="bloque-motivo"]')?.textContent?.trim()).toBe('No aplica al régimen Sobre utilidades')
        expect(pc.textContent).not.toMatch(/Q\s?\d/)

        expect(raiz.querySelector('[data-alerta="vencidas"]')?.textContent).toContain('2 obligaciones vencidas sin presentar')
        expect(raiz.querySelector('[data-alerta="libros"]')?.textContent).toContain('Libros atrasados')
        expect(raiz.querySelector('[data-alerta="fel"]')).toBeNull()
        const vencida = raiz.querySelector<HTMLElement>('[data-obligacion="8"]')
        expect(vencida?.dataset.vencida).toBe('si')
        expect(vencida?.textContent).toContain('Venció hace 3 días')
        expect(vencida?.querySelector('a')?.getAttribute('href')).toBe('/fiscal/calendario?obligacion=8')
        expect(bloqueDe(raiz, 'isr').querySelector('[data-prueba="isr-con-la-anual"]')).not.toBeNull()
        expect(bloqueDe(raiz, 'isr').textContent).toContain('Confirmar con contador')
        expect(bloqueDe(raiz, 'facturado').textContent).toContain('3,360.00')

        // Con un borrador de las retenciones de septiembre, la vencida trae su mora estimada (300 × 0.05 % × 3 días).
        const calculada = await useDeclaraciones().calcular({ impuesto: 'retenciones_isr', periodo: '2026-09', sustitutiva: false }, 'tablero-ret-isr')
        expect(calculada.ok).toBe(true)
        const boton = [...iso.querySelectorAll('button')].find(b => b.textContent?.includes('Reintentar'))
        boton?.click()
        await esperar(() => expect(raiz.querySelector('[data-obligacion="8"] [data-prueba="mora-estimada"]')?.textContent).toContain('0.45'))
        expect(raiz.querySelector('[data-obligacion="8"]')?.textContent).toContain('A pagar Q')
        expect(raiz.querySelector('[data-obligacion="8"]')?.textContent).toContain('confirmar con contador')
    })

    it('Fibra del Sur: alertas de FEL y de límite superado, sin cambiar el régimen', async () => {
        useEmpresaActiva().elegir(2)
        bd.datosDeclaraciones.push({ empresa_id: 2, periodo: '2026-10', renglones: [{ seccion: 'ventas', origen: 'dte', documento: 'FPEQ S-399', fecha: '2026-10-12', tipo: 'FPEQ', nit: 'CF', base: '470000.00', iva: '0.00', total: '470000.00', estado: 'certificado' }] })
        const pagina = await mountSuspended(PaginaTablero)
        const raiz = pagina.element as HTMLElement
        await esperar(() => expect(raiz.querySelector('[data-empresa="2"]')).not.toBeNull())
        expect(raiz.querySelector('[data-alerta="fel"]')?.textContent).toContain('FEL es obligatoria para su régimen')
        expect(raiz.querySelector('[data-alerta="pequeno_contribuyente"]')?.textContent).toContain('debe pasar al régimen general')
        expect(raiz.querySelector('[data-prueba="pc-porcentaje"]')?.textContent).toContain('103.02 %')
        expect(raiz.querySelector('[data-prueba="tablero-regimen"]')?.textContent).toContain('Pequeño contribuyente')
        expect(bloqueDe(raiz, 'isr').dataset.estado).toBe('no_aplica')
        expect(bloqueDe(raiz, 'iso').dataset.estado).toBe('no_aplica')
    })

    it('«Todas»: una sección por empresa y sin totales; si la API falla, error con «Reintentar» y nada más', async () => {
        useEmpresaActiva().elegir('todas')
        const pagina = await mountSuspended(PaginaTablero)
        const raiz = pagina.element as HTMLElement
        await esperar(() => expect(raiz.querySelectorAll('[data-empresa]').length).toBe(2))
        expect(raiz.textContent).toContain('sin totales consolidados')
        expect(raiz.querySelector('[data-empresa="1"] h2')?.textContent).toContain('ArgosNet')
        expect(raiz.querySelector('[data-empresa="2"] h2')?.textContent).toContain('Fibra del Sur')

        simularFalla('GET /api/v1/fiscal/tablero', 500)
        const fallida = await mountSuspended(PaginaTablero)
        const otra = fallida.element as HTMLElement
        await esperar(() => expect(otra.querySelector('[data-prueba="tablero-problema"]')).not.toBeNull())
        expect(otra.querySelector('[data-bloque]')).toBeNull()
        expect(otra.textContent).toContain('Reintentar')
        expect(otra.textContent).not.toMatch(/Q\s?\d/)
    })
    it('bloques del libro (PR D): compras sin NIT con enlace al libro de compras, incobrables y depreciación', async () => {
        const compra = structuredClone(bd.compras[0]!)
        bd.compras.push({ ...compra, id: 90, proveedor_id: 90, proveedor_nombre: 'Ferretería El Tornillo', proveedor_nit: 'CF', numero: '7781', fecha_documento: '2026-09-21', total: '3150.00', estado: 'vigente' })
        const resultado = await useTableroFiscal().ver()
        const bloques = resultado.ok ? resultado.data.empresas[0]!.bloques : null
        expect(bloques?.compras_sin_nit.datos).toMatchObject({ anio: 2026, limite: '2500.00', cantidad: 1, total: '3150.00', compras: [{ compra_id: 90, fecha: '2026-09-21', proveedor: 'Ferretería El Tornillo', identificacion: 'nit: CF' }] })
        expect(bloques?.depreciacion.datos).toMatchObject({ activos: 3, bajo_maximo: 1, diferencia_anual: '1439.64', detalle: [{ activo_id: 2, clase: 'computacion', tasa_maxima: '33.33', depreciacion_anual: '2160.00', depreciacion_anual_maxima: '3599.64' }] })
        const inc = bloques?.incobrables.datos
        expect(inc?.porcentaje).toBe('3.00')
        expect(inc?.tope).toBe(new Decimal(inc?.base ?? '0').times('0.03').toDecimalPlaces(2).toFixed(2))
        expect(inc?.disponible).toBe(Decimal.max(new Decimal(inc?.tope ?? '0').minus(inc?.estimacion ?? '0'), 0).toFixed(2))

        const pagina = await mountSuspended(PaginaTablero)
        const raiz = pagina.element as HTMLElement
        await esperar(() => expect(raiz.querySelector('[data-bloque="compras_sin_nit"] [data-compra="90"]')).not.toBeNull())
        expect(bloqueDe(raiz, 'compras_sin_nit').querySelector('[data-prueba="compra-libro"]')?.getAttribute('href')).toBe('/libros?libro=compras&desde=2026-09-01&hasta=2026-09-30')
        expect(bloqueDe(raiz, 'depreciacion').querySelector('[data-activo="2"]')?.textContent).toContain('Equipo de cómputo')
        expect(bloqueDe(raiz, 'incobrables').textContent).toContain('Por provisionar')

        // Un parámetro sin valor deja su bloque en error, sin cifras, y el resto sigue.
        bd.fiscal.valores.push({ id: 9002, pais: 'GT', empresa_id: 1, clave: 'depreciacion', valor: null, vigente_desde: '2026-01-01', origen: 'usuario', motivo: 'Por confirmar', creado_por: 1, created_at: '2026-10-01T00:00:00.000Z', nivel: 'empresa' })
        const sinTopes = await mountSuspended(PaginaTablero)
        const otra = sinTopes.element as HTMLElement
        await esperar(() => expect(otra.querySelector('[data-bloque="depreciacion"]')?.getAttribute('data-estado')).toBe('error'))
        expect(bloqueDe(otra, 'depreciacion').textContent).not.toMatch(/Q\s?\d/)
        expect(bloqueDe(otra, 'depreciacion').textContent).toContain('Reintentar')
        expect(bloqueDe(otra, 'incobrables').dataset.estado).toBe('ok')
    })
})
