import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, numeroQuery, paginar, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { pdfFixture } from '../documentos/datos'
import { fechaGuatemala } from '../libro/datos'
import { huellaFixture } from './datos'

/**
 * Libros legales con folio (A3, fase 6 PR D) como `start/routes/libros.ts`: vista previa del Diario,
 * Mayor, Ventas y Compras armada con los asientos, facturas y compras de los fixtures (JSON, CSV, XLSX
 * o el PDF «Borrador sin folio», `inline`); folios por libro; emisión con las reglas de `EmitirLibro`
 * (meses cerrados y bloqueo global o duro → 422 `periodo_sin_bloqueo` con `mes_abierto` y
 * `sin_bloqueo`; cadena rota → 409 `integridad_rota`; sin folios → 422 `folios_agotados`; un rango que
 * se cruza con otro emitido es reimpresión); historial y archivo (409 `archivo_alterado`); y
 * habilitaciones correlativas (422 `habilitacion_no_correlativa`). Una página cada 25 filas.
 */

type Libro = Schema<'HabilitacionLibro'>['libro']
type Emitible = 'diario' | 'mayor' | 'ventas' | 'compras'
type Diario = Schema<'ReporteLibroDiario'>
type Mayor = Schema<'ReporteLibroMayor'>
type Ventas = Schema<'ReporteLibroVentas'>
type Compras = Schema<'ReporteLibroCompras'>
type Columna = Schema<'ColumnaReporte'>

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const HABILITABLES: readonly Libro[] = ['diario', 'mayor', 'inventarios', 'estados_financieros', 'compras', 'ventas']
const EMITIBLES: readonly Emitible[] = ['diario', 'mayor', 'compras', 'ventas']
export const FILAS_POR_PAGINA_FIXTURE = 25
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const NOMBRES: Record<Libro, string> = {
    diario: 'Libro Diario',
    mayor: 'Libro Mayor',
    inventarios: 'Libro de Inventarios',
    estados_financieros: 'Libro de Estados Financieros',
    compras: 'Libro de Compras y Servicios Recibidos',
    ventas: 'Libro de Ventas y Servicios Prestados',
}

/** Para pruebas: el archivo guardado de una emisión deja de coincidir con su SHA-256. */
export function alterarArchivoLibroFixture(id: number): void {
    bd.librosAlterados.push(id)
}

/* Fechas y meses. */

function finDeMes(fecha: string): string {
    const dia = new Date(`${fecha.slice(0, 7)}-01T00:00:00Z`)
    dia.setUTCMonth(dia.getUTCMonth() + 1)
    dia.setUTCDate(0)
    return dia.toISOString().slice(0, 10)
}

function mesesEntre(desde: string, hasta: string): string[] {
    const meses: string[] = []
    const actual = new Date(`${desde.slice(0, 7)}-01T00:00:00Z`)
    while (actual.toISOString().slice(0, 7) <= hasta.slice(0, 7)) {
        meses.push(actual.toISOString().slice(0, 7))
        actual.setUTCMonth(actual.getUTCMonth() + 1)
    }
    return meses
}

/** Por defecto el mes en curso; `hasta` por defecto el fin del mes de `desde` (como `rangoFechas`). */
function rangoDe(solicitud: SolicitudFixture): { desde: string, hasta: string } | null {
    const hoy = fechaGuatemala(new Date().toISOString())
    const desde = solicitud.query.get('desde') || `${hoy.slice(0, 7)}-01`
    const hasta = solicitud.query.get('hasta') || finDeMes(desde)
    return FECHA.test(desde) && FECHA.test(hasta) ? { desde, hasta } : null
}

function empresaDe(solicitud: SolicitudFixture, cuerpo: Record<string, unknown> = {}): number | null {
    const pedida = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : numeroQuery(solicitud, 'empresa_id')
    return pedida ?? empresaActivaDe(solicitud)
}

const empresaRequerida = (): RespuestaFixture => problemaTipado(422, 'empresa_requerida', 'Empresa requerida', 'Elige la empresa en el selector (X-Empresa-Id)')

function mesCerrado(empresaId: number, mes: string): boolean {
    return bd.cierres.some(c => (c.empresa_id ?? 1) === empresaId && c.periodo === mes && c.estado === 'cerrado')
}

/* Vista previa con los datos de los fixtures. */

const FILA: Columna = { clave: 'fila', titulo: 'Tipo de fila', tipo: 'texto' }

function texto(valor: Decimal): string {
    return valor.toFixed(2)
}

function asientosDe(empresaId: number, desde: string, hasta: string): Schema<'Asiento'>[] {
    return bd.asientos
        .filter(a => (a.empresa_id ?? 1) === empresaId && a.fecha >= desde && a.fecha <= hasta)
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id)
}

/** Partida guardada al cerrar el mes (consecutiva por mes); null en meses abiertos. */
function partidas(empresaId: number, asientos: readonly Schema<'Asiento'>[]): Map<number, number> {
    const mapa = new Map<number, number>()
    const porMes = new Map<string, number>()
    for (const a of asientos) {
        const mes = a.fecha.slice(0, 7)
        if (mesCerrado(empresaId, mes)) {
            const n = (porMes.get(mes) ?? 0) + 1
            porMes.set(mes, n)
            mapa.set(a.id, n)
        }
    }
    return mapa
}

function libroDiario(empresaId: number, desde: string, hasta: string): Diario {
    const asientos = asientosDe(empresaId, desde, hasta)
    const partida = partidas(empresaId, asientos)
    const filas: Diario['filas'] = []
    let debe = new Decimal(0)
    let haber = new Decimal(0)
    for (const a of asientos) {
        const base = { partida: partida.get(a.id) ?? null, fecha: a.fecha, diario: null, numero: null, asiento_id: a.id }
        let debeAsiento = new Decimal(0)
        let haberAsiento = new Decimal(0)
        for (const m of a.movimientos) {
            debeAsiento = debeAsiento.plus(m.debe)
            haberAsiento = haberAsiento.plus(m.haber)
            filas.push({ fila: 'movimiento', ...base, cuenta: m.cuenta_codigo, cuenta_nombre: m.cuenta_nombre, descripcion: a.descripcion, debe: texto(new Decimal(m.debe)), haber: texto(new Decimal(m.haber)) })
        }
        debe = debe.plus(debeAsiento)
        haber = haber.plus(haberAsiento)
        filas.push({ fila: 'total', ...base, cuenta: null, cuenta_nombre: null, descripcion: base.partida === null ? `Total del asiento ${a.id}` : `Total de la partida ${base.partida}`, debe: texto(debeAsiento), haber: texto(haberAsiento) })
    }
    return {
        reporte: 'libro-diario',
        titulo: 'Libro Diario (vista previa, borrador sin folio)',
        filtros: { empresa_id: empresaId, desde, hasta },
        columnas: [FILA, { clave: 'partida', titulo: 'Partida', tipo: 'entero', nulable: true }, { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' }, { clave: 'diario', titulo: 'Diario', tipo: 'texto', nulable: true }, { clave: 'numero', titulo: 'Número', tipo: 'entero', nulable: true }, { clave: 'asiento_id', titulo: 'Asiento', tipo: 'id' }, { clave: 'cuenta', titulo: 'Cuenta', tipo: 'texto', nulable: true }, { clave: 'cuenta_nombre', titulo: 'Nombre de la cuenta', tipo: 'texto', nulable: true }, { clave: 'descripcion', titulo: 'Descripción', tipo: 'texto' }, { clave: 'debe', titulo: 'Debe', tipo: 'dinero' }, { clave: 'haber', titulo: 'Haber', tipo: 'dinero' }],
        filas,
        totales: { fila: null, partida: null, fecha: null, diario: null, numero: null, asiento_id: null, cuenta: null, cuenta_nombre: null, descripcion: null, debe: texto(debe), haber: texto(haber) },
        generado_en: new Date().toISOString(),
    }
}

/** Saldo según la naturaleza: activo y gasto, deudora; el resto, acreedora. */
function saldoNatural(tipo: Schema<'Cuenta'>['tipo'], debe: Decimal, haber: Decimal): Decimal {
    return tipo === 'activo' || tipo === 'gasto' ? debe.minus(haber) : haber.minus(debe)
}

function libroMayor(empresaId: number, desde: string, hasta: string): Mayor {
    const previos = bd.asientos.filter(a => (a.empresa_id ?? 1) === empresaId && a.fecha < desde)
    const enRango = asientosDe(empresaId, desde, hasta)
    const filas: Mayor['filas'] = []
    let debeTotal = new Decimal(0)
    let haberTotal = new Decimal(0)
    for (const cuenta of [...bd.cuentas].filter(c => c.imputable).sort((a, b) => a.codigo.localeCompare(b.codigo))) {
        const previosCuenta = previos.flatMap(a => a.movimientos).filter(m => m.cuenta_id === cuenta.id)
        const inicialDebe = previosCuenta.reduce((s, m) => s.plus(m.debe), new Decimal(0))
        const inicialHaber = previosCuenta.reduce((s, m) => s.plus(m.haber), new Decimal(0))
        const movimientos = enRango.flatMap(a => a.movimientos.filter(m => m.cuenta_id === cuenta.id).map(m => ({ a, m })))
        if (!movimientos.length && inicialDebe.equals(inicialHaber)) {
            continue
        }
        const base = { cuenta: cuenta.codigo, cuenta_nombre: cuenta.nombre }
        let saldo = saldoNatural(cuenta.tipo, inicialDebe, inicialHaber)
        filas.push({ fila: 'saldo_inicial', ...base, fecha: null, partida: null, asiento_id: null, descripcion: 'Saldo inicial', debe: '0.00', haber: '0.00', saldo: texto(saldo) })
        let debe = new Decimal(0)
        let haber = new Decimal(0)
        for (const { a, m } of movimientos) {
            debe = debe.plus(m.debe)
            haber = haber.plus(m.haber)
            saldo = saldo.plus(saldoNatural(cuenta.tipo, new Decimal(m.debe), new Decimal(m.haber)))
            filas.push({ fila: 'movimiento', ...base, fecha: a.fecha, partida: null, asiento_id: a.id, descripcion: a.descripcion, debe: texto(new Decimal(m.debe)), haber: texto(new Decimal(m.haber)), saldo: texto(saldo) })
        }
        debeTotal = debeTotal.plus(debe)
        haberTotal = haberTotal.plus(haber)
        filas.push({ fila: 'saldo_final', ...base, fecha: null, partida: null, asiento_id: null, descripcion: 'Saldo final', debe: texto(debe), haber: texto(haber), saldo: texto(saldo) })
    }
    return {
        reporte: 'libro-mayor',
        titulo: 'Libro Mayor (vista previa, borrador sin folio)',
        filtros: { empresa_id: empresaId, desde, hasta },
        columnas: [FILA, { clave: 'cuenta', titulo: 'Cuenta', tipo: 'texto' }, { clave: 'cuenta_nombre', titulo: 'Nombre de la cuenta', tipo: 'texto' }, { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha', nulable: true }, { clave: 'partida', titulo: 'Partida', tipo: 'entero', nulable: true }, { clave: 'asiento_id', titulo: 'Asiento', tipo: 'id', nulable: true }, { clave: 'descripcion', titulo: 'Descripción', tipo: 'texto' }, { clave: 'debe', titulo: 'Debe', tipo: 'dinero' }, { clave: 'haber', titulo: 'Haber', tipo: 'dinero' }, { clave: 'saldo', titulo: 'Saldo', tipo: 'dinero' }],
        filas,
        totales: { fila: null, cuenta: null, cuenta_nombre: null, fecha: null, partida: null, asiento_id: null, descripcion: null, debe: texto(debeTotal), haber: texto(haberTotal), saldo: null },
        generado_en: new Date().toISOString(),
    }
}

/** Sin FEL: las facturas (fecha de su asiento) con su base a `servicios` o todo a `exento` si no llevan IVA. */
function libroVentas(empresaId: number, desde: string, hasta: string): Ventas {
    const facturas = bd.facturas
        .filter(f => (f.empresa_id ?? 1) === empresaId)
        .map(f => ({ f, fecha: fechaGuatemala(f.emitida_en) }))
        .filter(({ fecha }) => fecha >= desde && fecha <= hasta)
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.f.id - b.f.id)
    const filas: Ventas['filas'] = facturas.map(({ f, fecha }) => {
        const cliente = bd.clientes.find(c => c.id === f.cliente_id)
        const anulada = f.estado === 'anulada'
        const total = anulada ? new Decimal(0) : new Decimal(f.total)
        const iva = anulada ? new Decimal(0) : new Decimal(f.iva)
        const nit = cliente?.nit_cui && cliente.nit_cui !== 'CF' && !cliente.nit_cui_invalido ? cliente.nit_cui : 'CF'
        return {
            fecha,
            origen: 'interno',
            documento: `Factura ${f.id}`,
            tipo: 'FACT',
            serie: f.fel_serie,
            numero: f.fel_numero,
            autorizacion: f.fel_uuid,
            nit,
            cliente: nit === 'CF' ? 'Consumidor final' : (cliente?.nombre_fiscal ?? cliente?.nombre ?? ''),
            bienes: '0.00',
            servicios: texto(iva.isZero() ? new Decimal(0) : total.minus(iva)),
            exportacion: '0.00',
            exento: texto(iva.isZero() ? total : new Decimal(0)),
            iva: texto(iva),
            total: texto(total),
            estado: anulada ? 'anulado' : 'vigente',
            retenciones: '0.00',
        }
    })
    const suma = (clave: 'bienes' | 'servicios' | 'exportacion' | 'exento' | 'iva' | 'total' | 'retenciones') => texto(filas.reduce((s, fila) => s.plus(fila[clave]), new Decimal(0)))
    return {
        reporte: 'libro-ventas',
        titulo: 'Libro de Ventas y Servicios Prestados (vista previa, borrador sin folio)',
        filtros: { empresa_id: empresaId, desde, hasta },
        columnas: [{ clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' }, { clave: 'origen', titulo: 'Origen', tipo: 'texto' }, { clave: 'documento', titulo: 'Documento', tipo: 'texto' }, { clave: 'tipo', titulo: 'Tipo DTE', tipo: 'texto' }, { clave: 'serie', titulo: 'Serie', tipo: 'texto', nulable: true }, { clave: 'numero', titulo: 'Número', tipo: 'texto', nulable: true }, { clave: 'autorizacion', titulo: 'Autorización', tipo: 'texto', nulable: true }, { clave: 'nit', titulo: 'NIT/CUI/CF', tipo: 'texto' }, { clave: 'cliente', titulo: 'Cliente', tipo: 'texto' }, { clave: 'bienes', titulo: 'Bienes', tipo: 'dinero' }, { clave: 'servicios', titulo: 'Servicios', tipo: 'dinero' }, { clave: 'exportacion', titulo: 'Exportación', tipo: 'dinero' }, { clave: 'exento', titulo: 'Exento', tipo: 'dinero' }, { clave: 'iva', titulo: 'IVA', tipo: 'dinero' }, { clave: 'total', titulo: 'Total', tipo: 'dinero' }, { clave: 'estado', titulo: 'Estado', tipo: 'texto' }, { clave: 'retenciones', titulo: 'Retenciones recibidas', tipo: 'dinero' }],
        filas,
        totales: { fecha: null, origen: null, documento: null, tipo: null, serie: null, numero: null, autorizacion: null, nit: null, cliente: null, bienes: suma('bienes'), servicios: suma('servicios'), exportacion: suma('exportacion'), exento: suma('exento'), iva: suma('iva'), total: suma('total'), estado: null, retenciones: suma('retenciones') },
        generado_en: new Date().toISOString(),
    }
}

/** Por mes del IVA: registro en `periodo_iva`; la anulación, en negativo, en el mes en que se anuló. */
function libroCompras(empresaId: number, desde: string, hasta: string): Compras {
    const inicio = `${desde.slice(0, 7)}-01`
    const fin = finDeMes(hasta)
    const compras = bd.compras.filter(c => c.empresa_id === empresaId)
    const fila = (c: Schema<'Compra'>, movimiento: 'registro' | 'anulacion', fecha: string): Compras['filas'][number] => {
        const factor = (c.tipo_documento === 'NCRE' ? -1 : 1) * (movimiento === 'anulacion' ? -1 : 1)
        const valor = (monto: string) => texto(new Decimal(monto).times(factor))
        return {
            compra_id: c.id,
            movimiento,
            fecha,
            tipo: c.tipo_documento,
            serie: c.serie ?? '',
            numero: c.numero,
            nit: c.proveedor_nit ?? 'CF',
            proveedor: c.proveedor_nombre,
            bienes: valor(c.base_bienes),
            servicios: valor(c.base_servicios),
            importaciones: valor(c.base_importaciones),
            exento: valor(c.exento),
            iva: valor(c.iva),
            total: valor(c.total),
            retencion_iva: valor(c.retencion_iva),
            retencion_isr: valor(c.retencion_isr),
            credito: c.credito_fiscal ? 'sí' : 'no',
            iva_credito: c.credito_fiscal ? valor(c.iva) : '0.00',
            periodo_iva: c.periodo_iva.slice(0, 7),
        }
    }
    const filas = [
        ...compras.filter(c => c.periodo_iva >= inicio && c.periodo_iva <= fin).map(c => fila(c, 'registro', c.fecha_documento)),
        ...compras.filter(c => c.anulado_en && fechaGuatemala(c.anulado_en) >= inicio && fechaGuatemala(c.anulado_en) <= fin).map(c => fila(c, 'anulacion', fechaGuatemala(c.anulado_en ?? ''))),
    ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.compra_id - b.compra_id)
    const suma = (clave: 'bienes' | 'servicios' | 'importaciones' | 'exento' | 'iva' | 'total' | 'retencion_iva' | 'retencion_isr' | 'iva_credito') => texto(filas.reduce((s, f) => s.plus(f[clave]), new Decimal(0)))
    return {
        reporte: 'libro-compras',
        titulo: 'Libro de Compras y Servicios Recibidos (vista previa, borrador sin folio)',
        filtros: { empresa_id: empresaId, desde: inicio, hasta: fin },
        columnas: [{ clave: 'compra_id', titulo: 'Compra', tipo: 'id' }, { clave: 'movimiento', titulo: 'Movimiento', tipo: 'texto' }, { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' }, { clave: 'tipo', titulo: 'Tipo', tipo: 'texto' }, { clave: 'serie', titulo: 'Serie', tipo: 'texto' }, { clave: 'numero', titulo: 'Número', tipo: 'texto' }, { clave: 'nit', titulo: 'NIT', tipo: 'texto' }, { clave: 'proveedor', titulo: 'Proveedor', tipo: 'texto' }, { clave: 'bienes', titulo: 'Bienes', tipo: 'dinero' }, { clave: 'servicios', titulo: 'Servicios', tipo: 'dinero' }, { clave: 'importaciones', titulo: 'Importaciones', tipo: 'dinero' }, { clave: 'exento', titulo: 'Exento', tipo: 'dinero' }, { clave: 'iva', titulo: 'IVA', tipo: 'dinero' }, { clave: 'total', titulo: 'Total', tipo: 'dinero' }, { clave: 'retencion_iva', titulo: 'Retención IVA', tipo: 'dinero' }, { clave: 'retencion_isr', titulo: 'Retención ISR', tipo: 'dinero' }, { clave: 'credito', titulo: 'Crédito fiscal', tipo: 'texto' }, { clave: 'iva_credito', titulo: 'IVA crédito', tipo: 'dinero' }, { clave: 'periodo_iva', titulo: 'Periodo IVA', tipo: 'texto' }],
        filas,
        totales: { compra_id: null, movimiento: null, fecha: null, tipo: null, serie: null, numero: null, nit: null, proveedor: null, bienes: suma('bienes'), servicios: suma('servicios'), importaciones: suma('importaciones'), exento: suma('exento'), iva: suma('iva'), total: suma('total'), retencion_iva: suma('retencion_iva'), retencion_isr: suma('retencion_isr'), credito: null, iva_credito: suma('iva_credito'), periodo_iva: null },
        generado_en: new Date().toISOString(),
    }
}

function construir(libro: Emitible, empresaId: number, desde: string, hasta: string): Diario | Mayor | Ventas | Compras {
    switch (libro) {
        case 'diario': return libroDiario(empresaId, desde, hasta)
        case 'mayor': return libroMayor(empresaId, desde, hasta)
        case 'ventas': return libroVentas(empresaId, desde, hasta)
        case 'compras': return libroCompras(empresaId, desde, hasta)
    }
}

function csv(reporte: Diario | Mayor | Ventas | Compras): Uint8Array {
    const lineas = [reporte.columnas.map(c => c.titulo).join(','), ...reporte.filas.map(f => reporte.columnas.map(c => JSON.stringify(Object.entries(f).find(([k]) => k === c.clave)?.[1] ?? '')).join(','))]
    return new TextEncoder().encode(lineas.join('\n'))
}

function vistaPrevia(libro: Emitible) {
    return conPermiso('libros.ver', (solicitud) => {
        const empresaId = empresaDe(solicitud)
        if (!empresaId) {
            return empresaRequerida()
        }
        const rango = rangoDe(solicitud)
        if (!rango) {
            return datosInvalidos([{ field: 'desde', message: 'Fecha inválida (AAAA-MM-DD)', rule: 'date' }])
        }
        const reporte = construir(libro, empresaId, rango.desde, rango.hasta)
        const formato = solicitud.query.get('formato') ?? 'json'
        const nombre = `${reporte.reporte}-${rango.desde}-${rango.hasta}-borrador.${formato}`
        if (formato === 'csv') {
            return { status: 200, cuerpo: csv(reporte), contentType: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': `attachment; filename="${nombre}"` } }
        }
        if (formato === 'xlsx') {
            return { status: 200, cuerpo: csv(reporte), contentType: XLSX, headers: { 'Content-Disposition': `attachment; filename="${nombre}"` } }
        }
        if (formato === 'pdf') {
            return { status: 200, cuerpo: pdfFixture(`${NOMBRES[libro]} - Borrador sin folio`), contentType: 'application/pdf', headers: { 'Content-Disposition': `inline; filename="${nombre}"` } }
        }
        return { status: 200, cuerpo: reporte }
    })
}

/* Folios y habilitaciones. */

function usadosEn(h: Schema<'HabilitacionLibro'>): number {
    return bd.librosEmisiones
        .filter(e => e.empresa_id === h.empresa_id && e.libro === h.libro)
        .reduce((usados, e) => usados + Math.max(0, Math.min(e.folio_final, h.folio_hasta) - Math.max(e.folio_inicial, h.folio_desde) + 1), 0)
}

function conUso(h: Schema<'HabilitacionLibro'>): Schema<'HabilitacionLibro'> {
    const usados = usadosEn(h)
    return { ...h, usados, disponibles: h.folio_hasta - h.folio_desde + 1 - usados }
}

export function foliosDe(empresaId: number, libro: Libro): Schema<'FoliosLibro'> {
    const rangos = bd.librosHabilitaciones.filter(h => h.empresa_id === empresaId && h.libro === libro)
    const emisiones = bd.librosEmisiones.filter(e => e.empresa_id === empresaId && e.libro === libro)
    const primero = rangos.length ? Math.min(...rangos.map(h => h.folio_desde)) : null
    const ultimoHabilitado = rangos.length ? Math.max(...rangos.map(h => h.folio_hasta)) : null
    const ultimoUsado = emisiones.length ? Math.max(...emisiones.map(e => e.folio_final)) : null
    const siguiente = primero === null ? null : (ultimoUsado ?? primero - 1) + 1
    const disponibles = ultimoHabilitado === null || siguiente === null ? 0 : Math.max(0, ultimoHabilitado - siguiente + 1)
    return { empresa_id: empresaId, libro, primero, ultimo_habilitado: ultimoHabilitado, ultimo_usado: ultimoUsado, siguiente, disponibles }
}

function filtrarPorLibro<T extends { libro: Libro, empresa_id: number }>(filas: readonly T[], solicitud: SolicitudFixture): T[] {
    const libro = solicitud.query.get('libro')
    return deLaEmpresa(filas, solicitud).filter(f => !libro || f.libro === libro)
}

function regla(status: number, codigo: string, titulo: string, detalle: string, errores: NonNullable<Problem['errors']>): RespuestaFixture {
    return problemaTipado(status, codigo, titulo, detalle, errores)
}

function vigente(empresaId: number, tipo: Schema<'BloqueoLibro'>['tipo']): string | null {
    return bd.bloqueosLibro.filter(b => b.empresa_id === empresaId && b.tipo === tipo).sort((a, b) => b.id - a.id)[0]?.hasta ?? null
}

/** Bytes del archivo de una emisión (el PDF o un XLSX simulado). */
function archivoDe(e: Schema<'EmisionLibro'>): Uint8Array {
    const titulo = `${NOMBRES[e.libro]} - Folios ${e.folio_inicial} a ${e.folio_final}${e.reimpresion ? ' - REIMPRESION' : ''}`
    return e.formato === 'pdf' ? pdfFixture(titulo) : new TextEncoder().encode(titulo)
}

export const rutasLibros: RutasFixture = {
    'GET /api/v1/libros/diario': vistaPrevia('diario'),
    'GET /api/v1/libros/mayor': vistaPrevia('mayor'),
    'GET /api/v1/libros/ventas': vistaPrevia('ventas'),
    'GET /api/v1/libros/compras': vistaPrevia('compras'),

    'GET /api/v1/libros/folios': conPermiso('libros.ver', (solicitud) => {
        const empresaId = empresaDe(solicitud)
        if (!empresaId) {
            return empresaRequerida()
        }
        return { status: 200, cuerpo: HABILITABLES.map(libro => foliosDe(empresaId, libro)) }
    }),

    'GET /api/v1/libros/habilitaciones': conPermiso('libros.ver', (solicitud) => {
        const filas = filtrarPorLibro(bd.librosHabilitaciones, solicitud).sort((a, b) => b.id - a.id).map(conUso)
        return { status: 200, cuerpo: paginar(filas, solicitud, 50) }
    }),

    /** Rangos correlativos por libro; fecha no futura; solo inserción. */
    'POST /api/v1/libros/habilitaciones': conPermiso('libros.habilitar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const libro = HABILITABLES.find(l => l === cuerpo.libro)
        const autorizacion = typeof cuerpo.autorizacion === 'string' ? cuerpo.autorizacion.trim() : ''
        const desde = cuerpo.folio_desde
        const hasta = cuerpo.folio_hasta
        const fecha = typeof cuerpo.fecha === 'string' ? cuerpo.fecha : ''
        const nota = typeof cuerpo.nota === 'string' ? cuerpo.nota.trim() : ''
        const errores: NonNullable<Problem['errors']> = []
        if (!libro) {
            errores.push({ field: 'libro', message: 'Libro desconocido', rule: 'enum' })
        }
        if (autorizacion.length < 3 || autorizacion.length > 120) {
            errores.push({ field: 'autorizacion', message: 'Número de la autorización', rule: 'required' })
        }
        if (typeof desde !== 'number' || !Number.isInteger(desde) || desde < 1) {
            errores.push({ field: 'folio_desde', message: 'Folio inicial positivo', rule: 'min' })
        }
        if (typeof hasta !== 'number' || !Number.isInteger(hasta) || typeof desde !== 'number' || hasta < desde) {
            errores.push({ field: 'folio_hasta', message: 'Debe ser igual o mayor que folio_desde', rule: 'rango' })
        }
        if (!FECHA.test(fecha)) {
            errores.push({ field: 'fecha', message: 'Fecha inválida', rule: 'date' })
        }
        else if (fecha > fechaGuatemala(new Date().toISOString())) {
            errores.push({ field: 'fecha', message: 'La fecha de la autorización no puede ser futura', rule: 'fecha' })
        }
        if (nota.length > 500) {
            errores.push({ field: 'nota', message: 'Hasta 500 caracteres', rule: 'maxLength' })
        }
        if (errores.length || !libro || typeof desde !== 'number' || typeof hasta !== 'number') {
            return datosInvalidos(errores)
        }
        const empresaId = empresaDe(solicitud, cuerpo)
        if (!empresaId) {
            return empresaRequerida()
        }
        const ultimo = foliosDe(empresaId, libro).ultimo_habilitado
        if (ultimo !== null && desde !== ultimo + 1) {
            return regla(422, 'habilitacion_no_correlativa', 'Habilitación no correlativa', `El último folio habilitado del libro ${libro} es ${ultimo}: la habilitación nueva empieza en ${ultimo + 1}`, [{ field: 'folio_desde', message: `Debe ser ${ultimo + 1}`, rule: 'habilitacion_no_correlativa' }])
        }
        const quien = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const nueva: Schema<'HabilitacionLibro'> = {
            id: siguienteId(bd.librosHabilitaciones),
            empresa_id: empresaId,
            libro,
            tipo: 'computarizado',
            autorizacion,
            folio_desde: desde,
            folio_hasta: hasta,
            fecha,
            nota: nota || null,
            usados: 0,
            disponibles: hasta - desde + 1,
            registrado_por: quien?.id ?? null,
            created_at: new Date().toISOString(),
        }
        bd.librosHabilitaciones.push(nueva)
        registrarAccion(solicitud, 'libros.habilitar', { tipo: 'libro_habilitacion', id: nueva.id }, cuerpo)
        return { status: 201, cuerpo: conUso(nueva) }
    })),

    'GET /api/v1/libros/emisiones': conPermiso('libros.ver', (solicitud) => {
        const filas = filtrarPorLibro(bd.librosEmisiones, solicitud).sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud, 50) }
    }),

    'GET /api/v1/libros/emisiones/:id': conPermiso('libros.ver', (solicitud) => {
        const emision = deLaEmpresa(bd.librosEmisiones, solicitud).find(e => e.id === idDe(solicitud))
        return emision ? { status: 200, cuerpo: emision } : noEncontrado('la emisión')
    }),

    'GET /api/v1/libros/emisiones/:id/archivo': conPermiso('libros.ver', (solicitud) => {
        const emision = deLaEmpresa(bd.librosEmisiones, solicitud).find(e => e.id === idDe(solicitud))
        if (!emision) {
            return noEncontrado('la emisión')
        }
        if (bd.librosAlterados.includes(emision.id)) {
            return problemaTipado(409, 'archivo_alterado', 'Archivo alterado', `El archivo de la emisión ${emision.id} no coincide con su SHA-256 registrado`)
        }
        const nombre = `libro-${emision.libro}-${emision.desde}-${emision.hasta}-folios-${emision.folio_inicial}-${emision.folio_final}.${emision.formato}`
        return { status: 200, cuerpo: archivoDe(emision), contentType: emision.formato === 'pdf' ? 'application/pdf' : XLSX, headers: { 'Content-Disposition': `attachment; filename="${nombre}"` } }
    }),

    /** Las reglas de `EmitirLibro`, en el mismo orden. */
    'POST /api/v1/libros/:libro/emitir': conPermiso('libros.emitir', conIdempotencia((solicitud) => {
        const libro = EMITIBLES.find(l => l === solicitud.params.libro)
        if (!libro) {
            return noEncontrado(`el libro ${solicitud.params.libro ?? ''} (todavía no se emite)`)
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const desdePedido = typeof cuerpo.desde === 'string' ? cuerpo.desde : ''
        const hastaPedido = typeof cuerpo.hasta === 'string' ? cuerpo.hasta : desdePedido
        const formato = cuerpo.formato === 'xlsx' ? 'xlsx' : 'pdf'
        if (!FECHA.test(desdePedido) || !FECHA.test(hastaPedido) || (cuerpo.formato !== undefined && cuerpo.formato !== 'pdf' && cuerpo.formato !== 'xlsx')) {
            return datosInvalidos([{ field: FECHA.test(desdePedido) ? 'hasta' : 'desde', message: 'Fecha inválida (AAAA-MM-DD)', rule: 'date' }])
        }
        const desde = `${desdePedido.slice(0, 7)}-01`
        const hasta = finDeMes(hastaPedido)
        const empresaId = empresaDe(solicitud, cuerpo)
        if (!empresaId) {
            return empresaRequerida()
        }

        const errores: NonNullable<Problem['errors']> = mesesEntre(desde, hasta)
            .filter(mes => !mesCerrado(empresaId, mes))
            .map(mes => ({ field: 'hasta', message: `El mes ${mes} está abierto`, rule: 'mes_abierto' }))
        const bloqueo = [vigente(empresaId, 'global'), vigente(empresaId, 'duro')].filter((f): f is string => f !== null).sort().at(-1) ?? null
        if (bloqueo === null || bloqueo < hasta) {
            errores.push({ field: 'hasta', message: bloqueo ? `El libro está bloqueado hasta ${bloqueo}; falta hasta ${hasta}` : 'El libro no tiene bloqueo global ni duro', rule: 'sin_bloqueo' })
        }
        if (errores.length) {
            return regla(422, 'periodo_sin_bloqueo', 'Periodo sin bloqueo', `El libro oficial se emite solo de meses cerrados y bajo el bloqueo global o duro (${desde} a ${hasta})`, errores)
        }
        const ruptura = bd.fel.rupturas[empresaId]
        if (ruptura) {
            return problemaTipado(409, 'integridad_rota', 'Integridad del libro', `La cadena de hash del libro está rota en el sello ${ruptura.sello} (${ruptura.motivo}): no se puede emitir`)
        }
        const folios = foliosDe(empresaId, libro)
        if (folios.siguiente === null) {
            return regla(422, 'folios_agotados', 'Folios agotados', `El libro ${libro} no tiene folios habilitados: registre la habilitación (POST /libros/habilitaciones)`, [{ field: 'libro', message: 'Sin rango habilitado', rule: 'folios_agotados' }])
        }
        const reporte = construir(libro, empresaId, desde, hasta)
        const paginas = Math.max(1, Math.ceil(reporte.filas.length / FILAS_POR_PAGINA_FIXTURE))
        if (paginas > folios.disponibles) {
            return regla(422, 'folios_agotados', 'Folios agotados', `El libro necesita ${paginas} folios y quedan ${folios.disponibles} habilitados (del ${folios.siguiente} al ${folios.ultimo_habilitado ?? '—'})`, [{ field: 'libro', message: `Necesita ${paginas} folios; disponibles ${folios.disponibles}`, rule: 'folios_agotados' }])
        }
        const anterior = bd.librosEmisiones
            .filter(e => e.empresa_id === empresaId && e.libro === libro && e.desde <= hasta && e.hasta >= desde)
            .sort((a, b) => b.id - a.id)[0] ?? null
        const quien = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const id = siguienteId(bd.librosEmisiones)
        const totales = Object.fromEntries(Object.entries(reporte.totales).filter(([, v]) => v !== null))
        const borrador: Schema<'EmisionLibro'> = {
            id,
            empresa_id: empresaId,
            libro,
            desde,
            hasta,
            folio_inicial: folios.siguiente,
            folio_final: folios.siguiente + paginas - 1,
            paginas,
            formato,
            tamano: 0,
            sha256: '',
            filas: reporte.filas.length,
            totales,
            ultimo_sello: 300 + id,
            ultimo_hash: huellaFixture(`sello-${empresaId}-${hasta}`),
            reimpresion: anterior !== null,
            reimpresion_de: anterior?.id ?? null,
            generado_por: quien?.id ?? null,
            generado_por_nombre: quien?.nombre ?? null,
            generado_en: new Date().toISOString(),
        }
        const archivo = archivoDe(borrador)
        const emision = { ...borrador, tamano: archivo.length, sha256: huellaFixture(`emision-${id}-${archivo.length}`) }
        bd.librosEmisiones.push(emision)
        registrarAccion(solicitud, 'libros.emitir', { tipo: 'libro_emision', id }, { ...cuerpo, libro })
        return { status: 201, cuerpo: emision }
    })),
}
