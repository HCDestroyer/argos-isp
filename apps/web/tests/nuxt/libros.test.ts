import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, romperCadenaFixture, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { bd } from '~~/fixtures/bd'
import { alterarArchivoLibroFixture } from '~~/fixtures/libros/rutas'
import PaginaLibros from '~/pages/libros/index.vue'
import PaginaEmisiones from '~/pages/libros/emisiones.vue'
import PaginaHabilitaciones from '~/pages/libros/habilitaciones.vue'
import { esperar } from '../ayudas/esperar'
import { fijarHoyFixtures, soltarReloj } from '../ayudas/reloj'

/**
 * Libros legales con folio (A3, fase 6 PR D). En los fixtures, ArgosNet tiene septiembre cerrado y
 * agosto reabierto, el bloqueo global hasta el 31/08 y el duro hasta el 30/06; folios habilitados del
 * Diario (1–50, usados 1–8), Mayor (1–50) y Ventas (1–20, usados 1–2, el 2 es una reimpresión); Compras
 * sin habilitación. Hoy es el 15/10/2026 (`fijarHoyFixtures`): el mes por defecto es septiembre.
 */

function botonDelDialogo(texto: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent?.trim() === texto)
}

function bloquearSeptiembre() {
    bd.bloqueosLibro.push({ id: 99, empresa_id: 1, tipo: 'global', hasta: '2026-09-30', anterior: '2026-08-31', motivo: 'Cierre de septiembre', creado_por: 1, creado_por_nombre: 'Ana Administradora', created_at: '2026-10-05T16:00:00.000Z' })
}

describe('libros legales con folio', () => {
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

    it('esquemas espejo del validador: rango, meses completos sin futuro, confirmación; habilitación correlativa', () => {
        expect(esquemaVistaPrevia.safeParse({ desde: '2026-09-10', hasta: '2026-09-01' }).error?.issues[0]?.path).toEqual(['hasta'])
        const emitir = esquemaEmitir('2026-10-15')
        expect(emitir.safeParse({ desde: '2026-09', hasta: '2026-09', formato: 'pdf', confirmo: true }).success).toBe(true)
        expect(emitir.safeParse({ desde: '2026-09', hasta: '2026-08', formato: 'pdf', confirmo: true }).error?.issues[0]?.message).toContain('posterior')
        expect(emitir.safeParse({ desde: '2026-09', hasta: '2026-11', formato: 'pdf', confirmo: true }).error?.issues[0]?.message).toContain('futuro')
        expect(emitir.safeParse({ desde: '2026-09', hasta: '2026-09', formato: 'pdf', confirmo: false }).error?.issues[0]?.path).toEqual(['confirmo'])

        const folios: FoliosLibro[] = [{ empresa_id: 1, libro: 'diario', primero: 1, ultimo_habilitado: 50, ultimo_usado: 8, siguiente: 9, disponibles: 42 }, { empresa_id: 1, libro: 'compras', primero: null, ultimo_habilitado: null, ultimo_usado: null, siguiente: null, disponibles: 0 }]
        expect(folioDesdePropuesto(folios, 'diario')).toBe(51)
        expect(folioDesdePropuesto(folios, 'compras')).toBeNull()
        const habilitar = esquemaHabilitar('2026-10-15', folios)
        const base = { libro: 'diario' as const, autorizacion: 'SAT-7121-1', folio_desde: 51, folio_hasta: 100, fecha: '2026-10-15', nota: '' }
        expect(habilitar.safeParse(base).success).toBe(true)
        expect(habilitar.safeParse({ ...base, folio_desde: 40 }).error?.issues[0]?.message).toBe('Debe ser 51: el siguiente al último habilitado')
        expect(habilitar.safeParse({ ...base, folio_hasta: 50 }).error?.issues[0]?.path).toEqual(['folio_hasta'])
        expect(habilitar.safeParse({ ...base, fecha: '2026-10-16' }).error?.issues[0]?.message).toContain('futura')
        expect(habilitar.safeParse({ ...base, libro: 'compras', folio_desde: 7, folio_hasta: 30 }).success).toBe(true)
        expect(estadoFolios(folios[1]!).etiqueta).toBe('Sin habilitación')
        expect(estadoFolios({ ...folios[0]!, disponibles: 4 })).toEqual({ etiqueta: 'Quedan 4', color: 'warning' })
    })

    it('filas en negrita, nombres de archivo y qué hacer con cada error', () => {
        expect([tipoFila({ fila: 'total' }), tipoFila({ fila: 'saldo_final' }), tipoFila({ documento: 'Factura 1' })]).toEqual(['total', 'saldo_final', 'movimiento'])
        expect(esFilaResumen({ fila: 'saldo_inicial' })).toBe(true)
        expect(esFilaResumen({ fila: 'movimiento' })).toBe(false)
        expect(columnasLibro([{ clave: 'fila', titulo: 'Tipo de fila', tipo: 'texto' }, { clave: 'debe', titulo: 'Debe', tipo: 'dinero' }]).map(c => c.clave)).toEqual(['debe'])
        expect(periodoEmision('2026-07-01', '2026-09-30')).toBe('julio 2026 a septiembre 2026')
        expect(rangoFolios(9, 9)).toBe('Folio 9')

        const sinBloqueo = { type: 'urn:argosisp:problema:periodo_sin_bloqueo', title: 'Periodo sin bloqueo', status: 422, errors: [{ field: 'hasta', message: 'El mes 2026-08 está abierto', rule: 'mes_abierto' }, { field: 'hasta', message: 'El libro no tiene bloqueo global ni duro', rule: 'sin_bloqueo' }] }
        expect(problemaLibroLegible(sinBloqueo).title).toBe('El periodo todavía no se puede emitir')
        expect(pasosProblemaLibro(sinBloqueo).map(p => [p.texto.split(':')[0], p.accion?.ruta])).toEqual([['El mes 2026-08 está abierto', '/libro?tab=cierres'], ['El libro no tiene bloqueo global ni duro', '/libro/bloqueos']])
        const agotados = pasosProblemaLibro({ type: 'urn:argosisp:problema:folios_agotados', title: 'Folios agotados', status: 422, errors: [{ field: 'libro', message: 'Necesita 6 folios; disponibles 2', rule: 'folios_agotados' }] })
        expect([agotados[0]?.texto.startsWith('Necesita 6 folios; disponibles 2.'), agotados[0]?.accion?.permiso]).toEqual([true, 'libros.habilitar'])
        expect(pasosProblemaLibro({ type: 'urn:argosisp:problema:integridad_rota', title: 'Integridad', status: 409 })[0]?.accion?.ruta).toBe('/libro?tab=integridad')
        expect(pasosProblemaLibro({ type: 'urn:argosisp:problema:archivo_alterado', title: 'Archivo', status: 409 })[0]?.texto).toContain('SHA-256')
        expect(pasosProblemaLibro({ type: 'about:blank', title: 'Otro', status: 500 })).toEqual([])
        const emision = bd.librosEmisiones.find(e => e.id === 3)!
        expect(nombreArchivoEmision(emision)).toBe('libro-ventas-2026-06-folios-2-2.xlsx')
    })

    it('API de los fixtures: folios, reglas de la emisión en orden, reimpresión, habilitación correlativa y bitácora', async () => {
        const l = useLibros()
        const folios = await l.folios(1)
        expect(folios.ok && folios.data.filter(f => ['diario', 'ventas', 'compras'].includes(f.libro)).map(f => [f.libro, f.siguiente, f.disponibles])).toEqual([['diario', 9, 42], ['compras', null, 0], ['ventas', 3, 18]])

        // Septiembre está cerrado, pero el bloqueo global llega al 31/08; agosto está reabierto.
        const septiembre = await l.emitir('diario', { desde: '2026-09-01' }, nuevaClaveIdempotencia())
        expect(!septiembre.ok && [codigoProblema(septiembre.problema), septiembre.problema.errors?.map(e => e.rule)]).toEqual(['periodo_sin_bloqueo', ['sin_bloqueo']])
        const agosto = await l.emitir('diario', { desde: '2026-08-01', hasta: '2026-09-30' }, nuevaClaveIdempotencia())
        expect(!agosto.ok && agosto.problema.errors?.map(e => [e.rule, e.message])).toEqual([['mes_abierto', 'El mes 2026-08 está abierto'], ['sin_bloqueo', 'El libro está bloqueado hasta 2026-08-31; falta hasta 2026-09-30']])

        bloquearSeptiembre()
        romperCadenaFixture(1, { sello: 7, asiento_id: 12, motivo: 'hash_distinto', esperado: 'a', obtenido: 'b' })
        const rota = await l.emitir('diario', { desde: '2026-09-15' }, nuevaClaveIdempotencia())
        expect(!rota.ok && [rota.problema.status, codigoProblema(rota.problema)]).toEqual([409, 'integridad_rota'])
        romperCadenaFixture(1, null)

        const emitida = await l.emitir('diario', { desde: '2026-09-15' }, nuevaClaveIdempotencia())
        if (!emitida.ok) {
            throw new Error(emitida.problema.title)
        }
        expect([emitida.data.desde, emitida.data.hasta, emitida.data.folio_inicial, emitida.data.reimpresion, emitida.data.formato]).toEqual(['2026-09-01', '2026-09-30', 9, false, 'pdf'])
        expect(emitida.data.folio_final - emitida.data.folio_inicial + 1).toBe(emitida.data.paginas)
        const otraVez = await l.emitir('diario', { desde: '2026-09-01', formato: 'xlsx' }, nuevaClaveIdempotencia())
        expect(otraVez.ok && [otraVez.data.reimpresion, otraVez.data.reimpresion_de, otraVez.data.folio_inicial]).toEqual([true, emitida.data.id, emitida.data.folio_final + 1])

        const compras = await l.emitir('compras', { desde: '2026-09-01' }, nuevaClaveIdempotencia())
        expect(!compras.ok && codigoProblema(compras.problema)).toBe('folios_agotados')
        const primera = await l.habilitar({ libro: 'compras', autorizacion: 'SAT-7121-2026-000300', folio_desde: 1, folio_hasta: 25, fecha: '2026-10-10' }, nuevaClaveIdempotencia())
        expect(primera.ok && [primera.data.usados, primera.data.disponibles]).toEqual([0, 25])
        const salto = await l.habilitar({ libro: 'compras', autorizacion: 'SAT-7121-2026-000301', folio_desde: 30, folio_hasta: 40, fecha: '2026-10-10' }, nuevaClaveIdempotencia())
        expect(!salto.ok && [codigoProblema(salto.problema), salto.problema.errors?.[0]?.field, salto.problema.errors?.[0]?.message]).toEqual(['habilitacion_no_correlativa', 'folio_desde', 'Debe ser 26'])
        const futura = await l.habilitar({ libro: 'compras', autorizacion: 'SAT', folio_desde: 26, folio_hasta: 40, fecha: '2026-10-20' }, nuevaClaveIdempotencia())
        expect(!futura.ok && futura.problema.errors?.map(e => e.field)).toEqual(['fecha'])
        const comprasYa = await l.emitir('compras', { desde: '2026-09-01' }, nuevaClaveIdempotencia())
        expect(comprasYa.ok && comprasYa.data.folio_inicial).toBe(1)

        const diario = await l.habilitaciones({ libro: 'diario' })
        expect(diario.ok && diario.data.data.map(h => [h.usados, h.disponibles])).toEqual([[8 + emitida.data.paginas * 2, 42 - emitida.data.paginas * 2]])
        const historial = await l.emisiones({ libro: 'diario' })
        expect(historial.ok && historial.data.data.map(e => e.id)).toEqual([otraVez.ok ? otraVez.data.id : 0, emitida.data.id, 1])
        expect(bd.acciones.filter(a => a.accion.startsWith('libros.')).map(a => [a.accion, a.entidad_tipo])).toEqual([['libros.emitir', 'libro_emision'], ['libros.emitir', 'libro_emision'], ['libros.habilitar', 'libro_habilitacion'], ['libros.emitir', 'libro_emision']])

        alterarArchivoLibroFixture(1)
        const alterado = await l.archivoEmision(1)
        expect(!alterado.ok && [alterado.problema.status, codigoProblema(alterado.problema)]).toEqual([409, 'archivo_alterado'])
        const archivo = await l.archivoEmision(2)
        expect(archivo.ok && archivo.data.type).toBe('application/pdf')
    })

    it('vista previa: folios por libro, filas de total en negrita, totales de los movimientos y «Borrador sin folio»', async () => {
        const vista = await mountSuspended(PaginaLibros, { route: '/libros' })
        await esperar(() => expect(vista.find('[data-libro="diario"] [data-prueba="folios-siguiente"]').text()).toBe('Siguiente folio: 9'))
        expect(vista.find('[data-libro="compras"] [data-prueba="folios-estado"]').text()).toBe('Sin habilitación')
        expect(vista.find('[data-prueba="libros-borrador"]').text()).toBe('Borrador sin folio')
        await esperar(() => expect(vista.find('[data-prueba="libros-rango"]').text()).toBe('Del 01/09/2026 al 30/09/2026'))
        await esperar(() => expect(vista.findAll('[data-prueba="tabla-libro"] tbody tr').length).toBeGreaterThan(2))
        const filas = vista.findAll('[data-prueba="tabla-libro"] tbody tr')
        const resumen = filas.filter(f => f.classes().includes('font-semibold'))
        expect(resumen.length).toBeGreaterThan(0)
        expect(resumen[0]?.text()).toMatch(/Total de la partida 1/)
        // Septiembre está cerrado: las partidas van numeradas. El total del pie solo suma movimientos.
        const reporte = await useLibros().vistaPrevia('diario', { empresa_id: 1, desde: '2026-09-01', hasta: '2026-09-30' })
        expect(reporte.ok && vista.find('[data-prueba="total-debe"]').text()).toBe(formatearQuetzales(reporte.ok ? reporte.data.totales.debe ?? '' : ''))
        expect(vista.find('[data-prueba="abrir-emitir"]').exists()).toBe(true)
    })

    it('emitir: confirma antes de gastar folios; sin bloqueo dice qué hacer; con el bloqueo, emite y avisa la reimpresión', async () => {
        const vista = await mountSuspended(PaginaLibros, { route: '/libros' })
        await esperar(() => expect(vista.find('[data-prueba="abrir-emitir"]').exists()).toBe(true))
        await vista.find('[data-prueba="abrir-emitir"]').trigger('click')
        await esperar(() => expect(document.querySelector('[data-prueba="emitir-folios"]')?.textContent).toContain('Empieza en el folio 9'))
        expect(botonDelDialogo('Emitir con folio')?.disabled).toBe(true)
        document.querySelector<HTMLButtonElement>('[data-prueba="emitir-confirmo"] button[role="checkbox"], button[data-prueba="emitir-confirmo"]')?.click()
        await esperar(() => expect(botonDelDialogo('Emitir con folio')?.disabled).toBe(false))
        botonDelDialogo('Emitir con folio')?.click()
        await esperar(() => expect(document.querySelector('[data-prueba="emitir-problema"]')?.textContent).toContain('El periodo todavía no se puede emitir'))
        const pasos = [...document.querySelectorAll('[data-prueba="paso-libro"]')].map(p => p.textContent)
        expect(pasos).toHaveLength(1)
        expect(pasos[0]).toContain('bloquee el libro (global o duro) hasta el último día del rango')
        expect(document.querySelector('[data-prueba="paso-accion"]')?.textContent).toContain('Ir a bloqueos')

        bloquearSeptiembre()
        botonDelDialogo('Emitir con folio')?.click()
        await esperar(() => expect(vista.find('[data-prueba="libros-emitido"]').text()).toContain('Emisión 4 · Folios 9 a'))
        await esperar(() => expect(vista.find('[data-libro="diario"] [data-prueba="folios-siguiente"]').text()).not.toBe('Siguiente folio: 9'))
        expect(bd.librosEmisiones.at(-1)?.reimpresion).toBe(false)
    })

    it('sin `libros.emitir` no se emite; con «Todas» se pide elegir la empresa; un error se ve con «Reintentar»', async () => {
        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'libros.emitir' && p !== 'libros.habilitar') }
        const vista = await mountSuspended(PaginaLibros, { route: '/libros' })
        await esperar(() => expect(vista.find('[data-prueba="tabla-libro"]').exists()).toBe(true))
        expect(vista.find('[data-prueba="abrir-emitir"]').exists()).toBe(false)
        vista.unmount()

        useUsuarioActual().value = meAdmin
        useEmpresaActiva().elegir('todas')
        const todas = await mountSuspended(PaginaLibros, { route: '/libros' })
        expect(todas.find('[data-prueba="libros-sin-empresa"]').exists()).toBe(true)
        expect(todas.find('[data-prueba="folios-libro"]').exists()).toBe(false)
        todas.unmount()

        useEmpresaActiva().elegir(1)
        simularFalla('GET /api/v1/libros/folios', 501)
        simularFalla('GET /api/v1/libros/diario', 500)
        const falla = await mountSuspended(PaginaLibros, { route: '/libros' })
        await esperar(() => expect(falla.findAll('button').filter(b => b.text() === 'Reintentar')).toHaveLength(2))
        expect(falla.find('[data-prueba="folios-libro"]').exists()).toBe(false)
        expect(falla.find('[data-prueba="tabla-libro"]').exists()).toBe(false)
    })

    it('emisiones: reimpresión marcada, detalle por `?emision=` y el archivo alterado con qué hacer', async () => {
        alterarArchivoLibroFixture(3)
        const vista = await mountSuspended(PaginaEmisiones, { route: '/libros/emisiones?emision=3' })
        await esperar(() => expect(vista.findAll('[data-prueba="tabla-emisiones"] [data-prueba="emision-folios"]').map(f => f.text())).toEqual(['Folio 2', 'Folio 1', 'Folios 1 a 8']))
        expect(vista.findAll('[data-prueba="emision-reimpresion"]').map(b => b.text())).toEqual(['Reimpresión de #2'])
        await esperar(() => expect(document.querySelector('[data-prueba="detalle-reimpresion"]')?.textContent).toContain('Sustituye la emisión 2'))
        expect(document.querySelector('[data-prueba="detalle-sha256"]')?.textContent).toBe(bd.librosEmisiones.find(e => e.id === 3)?.sha256)
        document.querySelector<HTMLButtonElement>('[data-prueba="detalle-descargar"]')?.click()
        await esperar(() => expect(document.querySelector('[data-prueba="detalle-problema-descarga"]')?.textContent).toContain('El archivo de la emisión fue alterado'))
        expect(document.querySelector('[data-prueba="detalle-problema-descarga"]')?.textContent).toContain('Avise al administrador')
    })

    it('habilitaciones: uso por rango, propone el folio siguiente y la API rechaza un salto', async () => {
        const vista = await mountSuspended(PaginaHabilitaciones, { route: '/libros/habilitaciones' })
        await esperar(() => expect(vista.findAll('[data-prueba="habilitacion-disponibles"]').map(d => d.text())).toEqual(['18 disponibles', '50 disponibles', '42 disponibles']))
        await vista.find('[data-prueba="abrir-habilitacion"]').trigger('click')
        await esperar(() => expect(document.querySelector<HTMLInputElement>('[data-prueba="habilitacion-desde"] input, input[data-prueba="habilitacion-desde"]')?.value).toBe('51'))
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('El siguiente al último habilitado (50).')
        vista.unmount()

        useUsuarioActual().value = { ...meAdmin, permisos: meAdmin.permisos.filter(p => p !== 'libros.habilitar') }
        const lectura = await mountSuspended(PaginaHabilitaciones, { route: '/libros/habilitaciones' })
        await esperar(() => expect(lectura.findAll('[data-prueba="habilitacion-rango"]')).toHaveLength(3))
        expect(lectura.find('[data-prueba="abrir-habilitacion"]').exists()).toBe(false)
    })
})
