/**
 * "Base de datos" en memoria de los fixtures. Las altas y ediciones hechas en modo fixtures
 * viven aquí hasta recargar la página; las pruebas llaman `reiniciarFixtures()`.
 */
import type { Schema } from '@argosisp/contracts'
import type { RespuestaFixture } from '~/utils/fetchFixtures'
import { acciones } from './bitacora/datos'
import { clientes } from './clientes/datos'
import { planes, planesPorRouter } from './planes/datos'
import { plantillas } from './plantillas/datos'
import { ipv6Bloques, redesIpv4, routers } from './routers/datos'
import { servicios } from './servicios/datos'
import { sesiones } from './sesiones/datos'
import { zonas } from './zonas/datos'

interface BaseFixtures {
    clientes: Schema<'Cliente'>[]
    servicios: Schema<'Servicio'>[]
    zonas: Schema<'Zona'>[]
    routers: Schema<'Router'>[]
    redesIpv4: Schema<'RedIpv4'>[]
    ipv6Bloques: Schema<'Ipv6Bloque'>[]
    planes: Schema<'Plan'>[]
    planesPorRouter: Record<number, number[]>
    plantillas: Schema<'PlantillaFacturacion'>[]
    acciones: Schema<'AccionAuditoria'>[]
    sesiones: Schema<'Sesion'>[]
    /** Contraseñas PPPoE por servicio (la vista `Servicio` nunca las trae). */
    clavesPpp: Record<number, string>
    /** Respuestas guardadas por `Idempotency-Key`. */
    idempotencia: Record<string, RespuestaFixture>
    /**
     * Fallas simuladas: `'GET /api/v1/clientes/:id/estado-cuenta': 501` hace que esa ruta
     * responda ese status (como hoy la API real). Ver `simularFalla()` en `fixtures/index.ts`.
     */
    fallas: Record<string, number>
}

function inicial(): BaseFixtures {
    return structuredClone({
        clientes,
        servicios,
        zonas,
        routers,
        redesIpv4,
        ipv6Bloques,
        planes,
        planesPorRouter,
        plantillas,
        acciones,
        sesiones,
        clavesPpp: {},
        idempotencia: {},
        fallas: {},
    })
}

export const bd: BaseFixtures = inicial()

export function reiniciarFixtures(): void {
    Object.assign(bd, inicial())
}

export function siguienteId(filas: readonly { id: number }[]): number {
    return filas.reduce((maximo, fila) => Math.max(maximo, fila.id), 0) + 1
}
