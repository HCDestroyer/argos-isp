import type { HttpContext } from '@adonisjs/core/http'
import type { Reporte } from '#billing/reportes/definicion'
import {
    TIPOS_CONTENIDO,
    empresasDelReporte,
    exportarArchivo,
    nombreArchivo,
} from '#billing/reportes/exportar'
import { empresasDeLaLista } from '#shared/empresa_activa'

/**
 * Respuesta de un reporte por HTTP (todas las rutas `/reportes/*` con `formato`): JSON, o el archivo
 * CSV, XLSX o PDF con `Content-Disposition: attachment` y `Cache-Control: private, no-store`.
 */
export async function responderReporte(
    ctx: HttpContext,
    reporte: Reporte,
    formato?: 'json' | 'csv' | 'xlsx' | 'pdf',
): Promise<Reporte | undefined> {
    if (!formato || formato === 'json') return reporte
    const archivo = await exportarArchivo(reporte, formato, {
        empresas: empresasDelReporte(reporte, empresasDeLaLista(ctx.empresa)),
        generado_para: ctx.auth.user?.nombre ?? null,
    })
    ctx.response.header('Content-Type', TIPOS_CONTENIDO[formato])
    ctx.response.header('Content-Disposition', `attachment; filename="${nombreArchivo(reporte, formato)}"`)
    ctx.response.header('Cache-Control', 'private, no-store')
    ctx.response.send(archivo)
    return undefined
}

export const DESCRIPCION_EXPORTACION =
    ' Con `formato=csv`, `formato=xlsx` o `formato=pdf` responde el archivo (Content-Type text/csv, de Excel o application/pdf; Content-Disposition attachment) con la fila de totales al final. El PDF lleva el logo y el nombre de la empresa (o «Consolidado»), los filtros usados y la fecha de generación.'
