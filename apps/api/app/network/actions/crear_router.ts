import { DomainAction, type Transaccion } from '#shared/domain_action'
import { cifrarOpcional } from '#shared/cifrado'
import { verRouter, type RouterVista } from '#network/consultas/routers'
import type { ControlVelocidad } from '#network/velocidad'

export interface DatosRouter {
    nombre?: string
    host?: string
    api_usuario?: string | null
    api_password?: string | null
    radius_secret?: string | null
    nas_ip?: string
    modo_seguridad?: 'radius' | 'api'
    capacidad_bajada_kbps?: number | null
    capacidad_subida_kbps?: number | null
    activo?: boolean
}

export interface EntradaCrearRouter extends DatosRouter {
    /** en el alta; después solo con `CambiarControlVelocidad` */
    control_velocidad?: ControlVelocidad
    nombre: string
    host: string
    nas_ip: string
}

/** Columnas a escribir: `api_password` y `radius_secret` se cifran (formato v1, `AAA_PPP_KEY`). */
export function columnasRouter(datos: DatosRouter): Record<string, unknown> {
    const columnas: Record<string, unknown> = {}
    for (const [clave, valor] of Object.entries(datos)) {
        if (valor === undefined) continue
        columnas[clave] =
            clave === 'api_password' || clave === 'radius_secret'
                ? cifrarOpcional(valor as string | null)
                : valor
    }
    return columnas
}

/** Instantánea auditable: las credenciales se registran solo como "definida" o null. */
export function auditableRouter(router: RouterVista) {
    // modo_velocidad es derivado de control_velocidad: no se audita dos veces
    const {
        tiene_api_password: api,
        tiene_radius_secret: secreto,
        modo_velocidad: derivado,
        ...resto
    } = router
    void derivado
    return { ...resto, api_password: api ? 'definida' : null, radius_secret: secreto ? 'definido' : null }
}

/** Alta de un router MikroTik (NAS RADIUS y API REST). */
export default class CrearRouter extends DomainAction<EntradaCrearRouter, RouterVista> {
    readonly nombre = 'routers.crear'

    protected async handle(input: EntradaCrearRouter, t: Transaccion): Promise<RouterVista> {
        const [fila] = (await t.trx
            .insertQuery()
            .table('network.routers')
            .insert(columnasRouter(input))
            .returning('id')) as Array<{ id: number }>
        const id = fila!.id
        t.fijarEntidad('router', id)
        const router = await verRouter(id, t.trx)
        await t.registrarCambios({ tipo: 'router', id }, null, auditableRouter(router))
        return router
    }
}
