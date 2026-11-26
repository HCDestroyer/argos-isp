/**
 * Catálogo de reportes del usuario y sus favoritos (A3): `GET /reportes/catalogo` con los favoritos
 * primero, y `PUT`/`DELETE /reportes/favoritos/:reporte` (una preferencia propia: pide `reportes.ver`).
 * Como la API: marcar dos veces no cambia nada y un código fuera del catálogo es 404.
 */
import type { Schema } from '@argosisp/contracts'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { REPORTES, type ClaveReporte } from '~/utils/reportes'
import { bd } from '../bd'
import { conIdempotencia, conPermiso, noEncontrado, usuariosPorToken } from '../comun'

type Entrada = Schema<'ReporteCatalogo'>

const CODIGOS = ['cartera-vencida', 'facturado-vs-cobrado', 'ingresos', 'cobranza-diaria', 'cierres-caja', 'iva', 'promesas', 'altas-bajas', 'egresos', 'bonificaciones', 'cuentas-por-pagar']

function usuarioDe(solicitud: SolicitudFixture): number {
    return solicitud.token ? usuariosPorToken[solicitud.token]?.id ?? 0 : 0
}

function entrada(codigo: ClaveReporte, favoritos: string[]): Entrada {
    const datos = REPORTES[codigo]
    return {
        codigo,
        titulo: datos.titulo,
        descripcion: datos.descripcion,
        ruta: `/reportes/${codigo}`,
        permiso: 'reportes.ver',
        compartible: true,
        formatos: ['json', 'csv', 'xlsx', 'pdf'],
        favorito: favoritos.includes(codigo),
        vistas: [],
    }
}

export const rutasCatalogoReportes: RutasFixture = {
    'GET /api/v1/reportes/catalogo': conPermiso('reportes.ver', (solicitud) => {
        const favoritos = bd.operacionPm.favoritosReportes[usuarioDe(solicitud)] ?? []
        const filas = CODIGOS.map(c => entrada(c as ClaveReporte, favoritos))
        return { status: 200, cuerpo: [...filas.filter(f => f.favorito), ...filas.filter(f => !f.favorito)] }
    }),

    'PUT /api/v1/reportes/favoritos/:reporte': conPermiso('reportes.ver', conIdempotencia((solicitud) => {
        const codigo = solicitud.params.reporte ?? ''
        if (!CODIGOS.includes(codigo)) {
            return noEncontrado('el reporte')
        }
        const usuario = usuarioDe(solicitud)
        const actuales = bd.operacionPm.favoritosReportes[usuario] ?? []
        bd.operacionPm.favoritosReportes[usuario] = actuales.includes(codigo) ? actuales : [...actuales, codigo]
        return { status: 200, cuerpo: { favorito: true } }
    })),

    'DELETE /api/v1/reportes/favoritos/:reporte': conPermiso('reportes.ver', conIdempotencia((solicitud) => {
        const codigo = solicitud.params.reporte ?? ''
        if (!CODIGOS.includes(codigo)) {
            return noEncontrado('el reporte')
        }
        const usuario = usuarioDe(solicitud)
        bd.operacionPm.favoritosReportes[usuario] = (bd.operacionPm.favoritosReportes[usuario] ?? []).filter(c => c !== codigo)
        return { status: 200, cuerpo: { favorito: false } }
    })),
}
