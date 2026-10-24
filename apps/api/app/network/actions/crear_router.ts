import { DomainAction, type Transaccion } from '#shared/domain_action'
import { cifrarOpcional } from '#shared/cifrado'
import { verRouter, type RouterVista } from '#network/consultas/routers'
import type { ControlVelocidad } from '#network/velocidad'
import { vincularExterno, type IdExterno } from '#core/ids_externos'
import { exigirEmpresaActiva } from '#core/empresas'

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
    api_url?: string | null
    api_tls_verificar?: boolean
    api_ca?: string | null
    dhcp_servidor?: string | null
    interfaz_clientes?: string | null
    /** empresa sugerida para los servicios nuevos del router (multiempresa) */
    empresa_sugerida_id?: number | null
    activo?: boolean
}

export interface EntradaCrearRouter extends DatosRouter {
    /** en el alta; después solo con `CambiarControlVelocidad` */
    control_velocidad?: ControlVelocidad
    /** id en un sistema de origen (importador); 409 `externo_duplicado` si ya está vinculado */
    externo?: IdExterno
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

/**
 * Instantánea auditable: las credenciales y la CA se registran solo como "definida" o null (y
 * `registrarCambios` las guarda como `***`, `esCampoSensible`). Telemetría (`en_linea`,
 * `ultimo_contacto`) y derivados no se auditan.
 */
export function auditableRouter(router: RouterVista) {
    const {
        tiene_api_password: api,
        tiene_radius_secret: secreto,
        tiene_api_ca: ca,
        api_ca: mascara,
        modo_velocidad: derivado,
        en_linea: enLinea,
        ultimo_contacto: contacto,
        ...resto
    } = router
    void [mascara, derivado, enLinea, contacto]
    return {
        ...resto,
        api_password: api ? 'definida' : null,
        radius_secret: secreto ? 'definido' : null,
        api_ca: ca ? 'definida' : null,
    }
}

/** Alta de un router MikroTik (NAS RADIUS y API REST). */
export default class CrearRouter extends DomainAction<EntradaCrearRouter, RouterVista> {
    readonly nombre = 'routers.crear'

    protected async handle(input: EntradaCrearRouter, t: Transaccion): Promise<RouterVista> {
        const { externo, ...datos } = input
        if (datos.empresa_sugerida_id) {
            await exigirEmpresaActiva(t.trx, datos.empresa_sugerida_id, 'empresa_sugerida_id')
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('network.routers')
            .insert(columnasRouter(datos))
            .returning('id')) as Array<{ id: number }>
        const id = fila!.id
        t.fijarEntidad('router', id)
        await vincularExterno(t.trx, 'router', id, externo)
        const router = await verRouter(id, t.trx)
        await t.registrarCambios({ tipo: 'router', id }, null, auditableRouter(router))
        return router
    }
}
