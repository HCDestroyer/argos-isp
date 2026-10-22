import { esquemaReporte } from '#billing/reportes/definicion'
import {
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    instante,
    jsonLibre,
    nulable,
    objeto,
    texto,
    booleano,
} from '#shared/openapi/esquemas'
import {
    COLUMNAS_LIBRO_DIARIO,
    COLUMNAS_LIBRO_MAYOR,
    COLUMNAS_LIBRO_VENTAS,
    LIBROS_HABILITABLES,
} from '#fiscal/libros_legales'

/** Schemas de los libros legales con folio (contrato de localización fiscal §7, fase 6 PR D). */

export const ReporteLibroDiario = esquemaReporte('ReporteLibroDiario', COLUMNAS_LIBRO_DIARIO)
export const ReporteLibroMayor = esquemaReporte('ReporteLibroMayor', COLUMNAS_LIBRO_MAYOR)
export const ReporteLibroVentas = esquemaReporte('ReporteLibroVentas', COLUMNAS_LIBRO_VENTAS)

const libro = enumerado(LIBROS_HABILITABLES)

export const HabilitacionLibro = definirEsquema(
    'HabilitacionLibro',
    objeto({
        id,
        empresa_id: id,
        libro,
        tipo: enumerado(['computarizado']),
        autorizacion: { ...texto, description: 'Número de la autorización (SAT-7121 y Registro Mercantil)' },
        folio_desde: entero,
        folio_hasta: entero,
        fecha,
        nota: nulable(texto),
        usados: { ...entero, description: 'Folios de este rango ya usados por emisiones' },
        disponibles: entero,
        registrado_por: nulable(id),
        created_at: instante,
    }),
)

export const FoliosLibro = definirEsquema(
    'FoliosLibro',
    objeto({
        empresa_id: id,
        libro,
        primero: nulable(entero),
        ultimo_habilitado: nulable(entero),
        ultimo_usado: nulable(entero),
        siguiente: {
            ...nulable(entero),
            description: 'Folio que tomará la próxima emisión (null sin habilitación)',
        },
        disponibles: entero,
    }),
)

export const EmisionLibro = definirEsquema(
    'EmisionLibro',
    objeto({
        id,
        empresa_id: id,
        libro,
        desde: fecha,
        hasta: fecha,
        folio_inicial: entero,
        folio_final: entero,
        paginas: entero,
        formato: enumerado(['pdf', 'xlsx']),
        tamano: { ...entero, description: 'Bytes del archivo' },
        sha256: { ...texto, description: 'SHA-256 (hex) del archivo guardado' },
        filas: entero,
        totales: { ...jsonLibre, description: 'Totales del libro (columnas de dinero)' },
        ultimo_sello: nulable(entero),
        ultimo_hash: { ...nulable(texto), description: 'Último hash de la cadena del periodo (§10.10)' },
        reimpresion: booleano,
        reimpresion_de: nulable(id),
        generado_por: nulable(id),
        generado_por_nombre: nulable(texto),
        generado_en: instante,
    }),
)
