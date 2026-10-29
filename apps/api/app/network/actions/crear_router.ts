import { DomainAction, type Transaccion } from '#shared/domain_action'
import { cifrarOpcional } from '#shared/cifrado'
import { verRouter, type RouterVista } from '#network/consultas/routers'
import type { ControlVelocidad } from '#network/velocidad'
import { vincularExterno, type IdExterno } from '#core/ids_externos'
import { exigirEmpresaActiva } from '#core/empresas'
import { exigirRouterUnico } from '#network/routers_duplicados'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { ValidacionFallida } from '#shared/errores'
import { X509Certificate } from 'node:crypto'
import { MENSAJE_PROPOSITO } from '#network/diagnostico_routeros'

/**
 * La `api_ca` debe ser el certificado de una CA (`basicConstraints CA:TRUE`): pegar el del servicio
 * (`argosisp-api`) hace fallar la verificación con `unsuitable certificate purpose` (caso real del PM).
 * 422 en `api_ca` con lo que hay que revisar.
 */
export function exigirCaValida(pem: string | null | undefined) {
    if (!pem) return
    let esCa: boolean
    try {
        esCa = new X509Certificate(pem).ca
    } catch {
        throw new ValidacionFallida([
            {
                field: 'api_ca',
                rule: 'pem',
                message: 'No es un certificado PEM válido (-----BEGIN CERTIFICATE-----)',
            },
        ])
    }
    if (!esCa) throw new ValidacionFallida([{ field: 'api_ca', rule: 'ca', message: MENSAJE_PROPOSITO }])
}

/** 422 en `zona_id` si la zona no existe. */
export async function exigirZona(trx: TransactionClientContract, zonaId: number | null | undefined) {
    if (!zonaId) return
    const zona = await trx.from('core.zonas').where('id', zonaId).select('id').first()
    if (!zona) {
        throw new ValidacionFallida([
            { field: 'zona_id', rule: 'existe', message: `La zona ${zonaId} no existe` },
        ])
    }
}

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
    /** zona del router (opcional) */
    zona_id?: number | null
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

/** Nunca se guarda una credencial vacía cifrada. */
const CREDENCIALES = new Set(['api_password', 'radius_secret'])

/**
 * Columnas a escribir: `api_password` y `radius_secret` se cifran (formato v1, `AAA_PPP_KEY`). Una
 * credencial vacía (`""`, si llega sin pasar por el bodyparser) no se escribe.
 */
export function columnasRouter(datos: DatosRouter): Record<string, unknown> {
    const columnas: Record<string, unknown> = {}
    for (const [clave, valor] of Object.entries(datos)) {
        if (valor === undefined) continue
        if (CREDENCIALES.has(clave) && valor === '') continue
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
        modo_velocidad: derivado,
        en_linea: enLinea,
        ultimo_contacto: contacto,
        ...resto
    } = router
    void [derivado, enLinea, contacto]
    return {
        ...resto,
        api_password: api ? 'definida' : null,
        radius_secret: secreto ? 'definido' : null,
        api_ca: ca ? 'definida' : null,
    }
}

/** Campos del router que FreeRADIUS necesita (dirección del NAS y secreto). */
const CAMPOS_RADIUS = ['nas_ip', 'radius_secret'] as const

/**
 * Emite `router.radius_cambiado` si entre los campos auditados (`registrarCambios`) cambió
 * `nas_ip` o `radius_secret`: A2 regenera el cliente de FreeRADIUS. Nunca lleva el secreto.
 */
export async function avisarRadius(t: Transaccion, router: RouterVista, cambiados: string[]) {
    const campos = CAMPOS_RADIUS.filter((campo) => cambiados.includes(campo))
    if (campos.length === 0) return
    await t.emit('router.radius_cambiado', {
        router_id: router.id,
        empresa_id: router.empresa_sugerida_id,
        campos,
    })
}

/**
 * Alta de un router MikroTik (NAS RADIUS y API REST). 409 `router_duplicado` si otro router activo
 * tiene el mismo extremo de la API (`host`/`api_url` con su puerto) o cualquiera la misma `nas_ip`
 * (`contratos/routers.md`): el mismo equipo no se registra dos veces.
 */
export default class CrearRouter extends DomainAction<EntradaCrearRouter, RouterVista> {
    readonly nombre = 'routers.crear'

    protected async handle(input: EntradaCrearRouter, t: Transaccion): Promise<RouterVista> {
        const { externo, ...datos } = input
        if (datos.empresa_sugerida_id) {
            await exigirEmpresaActiva(t.trx, datos.empresa_sugerida_id, 'empresa_sugerida_id')
        }
        await exigirZona(t.trx, datos.zona_id)
        exigirCaValida(datos.api_ca)
        // 409 `router_duplicado` si ese MikroTik ya está registrado (`contratos/routers.md`)
        await exigirRouterUnico(
            t.trx,
            { host: datos.host, api_url: datos.api_url ?? null, nas_ip: datos.nas_ip, serial: null },
            { api: datos.activo !== false, nas_ip: true, serial: false },
        )
        const [fila] = (await t.trx
            .insertQuery()
            .table('network.routers')
            .insert(columnasRouter(datos))
            .returning('id')) as Array<{ id: number }>
        const id = fila!.id
        t.fijarEntidad('router', id)
        await vincularExterno(t.trx, 'router', id, externo)
        const router = await verRouter(id, t.trx)
        const cambiados = await t.registrarCambios({ tipo: 'router', id }, null, auditableRouter(router))
        await avisarRadius(t, router, cambiados)
        return router
    }
}
