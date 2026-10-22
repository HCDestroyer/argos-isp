import type { Schema } from '@argosisp/contracts'

/**
 * Libros legales con folio (A3, fase 6 PR D). ArgosNet (empresa 1) tiene habilitados el Diario
 * (1–50), el Mayor (1–50) y Ventas (1–20); Compras, Inventarios y Estados financieros sin
 * habilitación (emitir compras responde 422 `folios_agotados`). Fibra del Sur, nada. Historial: el
 * Diario de enero a junio (folios 1–8) y Ventas de junio dos veces (la segunda es la reimpresión de la
 * primera, folios nuevos). Las tablas son de solo inserción, como `fiscal.libros_*`.
 */

type Habilitacion = Schema<'HabilitacionLibro'>
type Emision = Schema<'EmisionLibro'>

/** Huella simulada de 64 caracteres hex (la API guarda el SHA-256 real del archivo). */
export function huellaFixture(texto: string): string {
    let hex = ''
    let h = 0x811C9DC5
    while (hex.length < 64) {
        for (const caracter of `${texto}:${hex.length}`) {
            h ^= caracter.charCodeAt(0)
            h = Math.imul(h, 0x01000193) >>> 0
        }
        hex += h.toString(16).padStart(8, '0')
    }
    return hex.slice(0, 64)
}

function habilitacion(id: number, datos: Pick<Habilitacion, 'libro' | 'autorizacion' | 'folio_desde' | 'folio_hasta' | 'fecha'> & Partial<Habilitacion>): Habilitacion {
    return {
        id,
        empresa_id: 1,
        tipo: 'computarizado',
        nota: null,
        usados: 0,
        disponibles: datos.folio_hasta - datos.folio_desde + 1,
        registrado_por: 1,
        registrado_por_nombre: 'Ana Administradora',
        created_at: `${datos.fecha}T16:00:00.000Z`,
        ...datos,
    }
}

export const habilitacionesLibros: Habilitacion[] = [
    habilitacion(1, { libro: 'diario', autorizacion: 'SAT-7121-2026-000184', folio_desde: 1, folio_hasta: 50, fecha: '2026-01-12', nota: 'Primera habilitación del sistema computarizado' }),
    habilitacion(2, { libro: 'mayor', autorizacion: 'SAT-7121-2026-000185', folio_desde: 1, folio_hasta: 50, fecha: '2026-01-12' }),
    habilitacion(3, { libro: 'ventas', autorizacion: 'SAT-7121-2026-000186', folio_desde: 1, folio_hasta: 20, fecha: '2026-01-12' }),
]

function emision(id: number, datos: Pick<Emision, 'libro' | 'desde' | 'hasta' | 'folio_inicial' | 'folio_final' | 'filas' | 'totales' | 'generado_en'> & Partial<Emision>): Emision {
    return {
        id,
        empresa_id: 1,
        paginas: datos.folio_final - datos.folio_inicial + 1,
        formato: 'pdf',
        tamano: 48_213 * (datos.folio_final - datos.folio_inicial + 1),
        sha256: huellaFixture(`emision-${id}`),
        ultimo_sello: 120 + id,
        ultimo_hash: huellaFixture(`sello-${id}`),
        reimpresion: false,
        reimpresion_de: null,
        generado_por: 1,
        generado_por_nombre: 'Ana Administradora',
        ...datos,
    }
}

export const emisionesLibros: Emision[] = [
    emision(1, { libro: 'diario', desde: '2026-01-01', hasta: '2026-06-30', folio_inicial: 1, folio_final: 8, filas: 186, totales: { debe: '1204331.80', haber: '1204331.80' }, generado_en: '2026-07-21T15:00:00.000Z' }),
    emision(2, { libro: 'ventas', desde: '2026-06-01', hasta: '2026-06-30', folio_inicial: 1, folio_final: 1, filas: 18, totales: { servicios: '4910.71', iva: '589.29', total: '5500.00', exento: '0.00', bienes: '0.00', exportacion: '0.00', retenciones: '0.00' }, generado_en: '2026-07-21T15:10:00.000Z' }),
    emision(3, { libro: 'ventas', desde: '2026-06-01', hasta: '2026-06-30', folio_inicial: 2, folio_final: 2, filas: 18, totales: { servicios: '4910.71', iva: '589.29', total: '5500.00', exento: '0.00', bienes: '0.00', exportacion: '0.00', retenciones: '0.00' }, reimpresion: true, reimpresion_de: 2, formato: 'xlsx', generado_en: '2026-07-28T17:30:00.000Z' }),
]
