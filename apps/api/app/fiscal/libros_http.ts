import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { exportar, TIPOS_CONTENIDO } from '#billing/reportes/exportar'
import type { LibroLegal } from '#fiscal/libros_legales'
import { empresaDelLibroLegal, generarArchivoLibro } from '#fiscal/libros_emisiones'

/** Respuesta HTTP de la vista previa de un libro legal (rutas `GET /libros/*`). */

export const DESCRIPCION_PDF =
    ' Con `formato=pdf` responde el libro en PDF (carta horizontal, encabezado legal, «Página N de M», «Van» y «Vienen») con la marca de agua «Borrador sin folio».'

/**
 * Vista previa de un libro: JSON (`columnas`, `filas`, `totales`), CSV, XLSX (con el encabezado del
 * libro y «Borrador sin folio») o PDF con la marca de agua.
 */
export async function responderLibro(
    ctx: HttpContext,
    libro: LibroLegal,
    formato?: 'json' | 'csv' | 'xlsx' | 'pdf',
) {
    if (!formato || formato === 'json') return libro.reporte
    const nombre = `${libro.reporte.reporte}-${libro.desde}-${libro.hasta}-borrador.${formato}`
    ctx.response.header('Cache-Control', 'private, no-store')
    if (formato === 'csv') {
        ctx.response.header('Content-Type', TIPOS_CONTENIDO.csv)
        ctx.response.header('Content-Disposition', `attachment; filename="${nombre}"`)
        ctx.response.send(exportar(libro.reporte, 'csv'))
        return undefined
    }
    const empresa = await empresaDelLibroLegal(db.connection(), libro.empresa_id)
    const archivo = await generarArchivoLibro(libro, empresa, formato, new Date(), null)
    ctx.response.header('Content-Type', formato === 'pdf' ? 'application/pdf' : TIPOS_CONTENIDO.xlsx)
    ctx.response.header(
        'Content-Disposition',
        `${formato === 'pdf' ? 'inline' : 'attachment'}; filename="${nombre}"`,
    )
    ctx.response.send(archivo.contenido)
    return undefined
}
