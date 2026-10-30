import type { Transaccion } from '#shared/domain_action'
import { Conflicto, Problema, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import {
    clasesDePerfil,
    routersAfectados,
    usoPerfil,
    verPerfil,
    type ClaseQosVista,
    type PerfilQosVista,
} from '#network/consultas/qos'
import { QOS_MAX_HOJAS, validarPerfil, type ClaseQos, type ReglaQos } from '#network/qos'

/**
 * Piezas comunes de las acciones de QoS por clases (`contratos/qos.md` §4). Todas usan el permiso
 * `qos.gestionar` (mismo nombre en `audit.acciones`, como las dos acciones de
 * `routers.cambiar_control_velocidad`).
 */

export const ACCION_QOS = 'qos.gestionar'

/** Datos editables de una clase (como llegan del validador). */
export interface DatosClaseQos {
    nombre?: string
    orden?: number
    prioridad?: number
    garantizado_pct?: number
    tope_pct?: number | null
    reglas?: Array<Partial<ReglaQos>>
    bytes_minimo?: number | null
    reclasifica_de?: number[]
}

export const CAMPOS_CLASE = [
    'nombre',
    'orden',
    'prioridad',
    'garantizado_pct',
    'tope_pct',
    'reglas',
    'bytes_minimo',
    'reclasifica_de',
    'activa',
] as const

/**
 * Un perfil común (sin empresa) solo lo cambia quien tiene alcance global; uno de empresa, quien tiene
 * acceso a ella (403 `empresa_no_permitida`). Deja la empresa en la auditoría.
 */
export function exigirEscrituraPerfil(t: Transaccion, perfil: Pick<PerfilQosVista, 'empresa_id'>): void {
    if (perfil.empresa_id === null) {
        const permitidas = t.ctx.empresasPermitidas
        if (permitidas !== null && permitidas !== undefined) {
            throw new Problema(
                403,
                'empresa_no_permitida',
                'Empresa no permitida',
                'Un perfil de QoS común a todas las empresas solo lo cambia quien tiene alcance global',
            )
        }
        return
    }
    t.fijarEmpresa(perfil.empresa_id)
    exigirAccesoEmpresa(t.ctx, perfil.empresa_id)
}

export function reglaCompleta(r: Partial<ReglaQos>): ReglaQos {
    return {
        protocolo: r.protocolo ?? null,
        puertos_destino: r.puertos_destino?.trim() || null,
        puertos_origen: r.puertos_origen?.trim() || null,
        dscp: r.dscp ?? null,
        lista_destino: r.lista_destino?.trim() || null,
    }
}

/** 409 si otra clase del perfil ya tiene ese nombre (sin distinguir mayúsculas). */
export function exigirNombreLibre(clases: ClaseQos[], nombre: string, excepto: number | null): void {
    const repetida = clases.find(
        (c) => c.id !== excepto && c.nombre.toLowerCase() === nombre.trim().toLowerCase(),
    )
    if (repetida) {
        throw new Conflicto(`El perfil ya tiene una clase «${repetida.nombre}»`, 'qos_nombre_duplicado')
    }
}

/**
 * Valida el perfil como quedaría (`clases` completas) y el costo en cada router que lo usa: 422 con
 * los `field` de la clase que se cambia sin el prefijo `clases.<id>.`.
 */
export async function exigirPerfilValido(
    t: Transaccion,
    perfilId: number,
    clases: ClaseQos[],
    claseId: number | null,
): Promise<void> {
    const { errores } = validarPerfil(clases)
    const prefijo = claseId === null ? null : `clases.${claseId}.`
    const limpios = errores.map((e) => ({
        field: prefijo && e.field.startsWith(prefijo) ? e.field.slice(prefijo.length) : e.field,
        rule: e.rule,
        message: e.message,
    }))
    if (limpios.length > 0) {
        throw new ValidacionFallida(limpios, `El perfil de QoS no sería válido: ${limpios[0]!.message}`)
    }
    for (const uso of await usoPerfil(perfilId, t.trx, clases)) {
        if (uso.hojas > QOS_MAX_HOJAS) {
            throw new ValidacionFallida(
                [
                    {
                        field: 'activa',
                        rule: 'qos_costo',
                        message:
                            `el router ${uso.nombre} pasaría de ${QOS_MAX_HOJAS} hojas de QoS (${uso.planes_qos} planes × 4 × ` +
                            `${uso.clases} clases = ${uso.hojas}): apaga qos en sus planes dedicados o usa menos clases`,
                    },
                ],
                `El router ${uso.nombre} pasaría del límite de QoS`,
            )
        }
    }
}

/** Fila para `network.qos_clases` desde la clase. */
export function filaClase(c: Omit<ClaseQos, 'id'>): Record<string, unknown> {
    return {
        nombre: c.nombre.trim(),
        orden: c.orden,
        prioridad: c.prioridad,
        garantizado_pct: c.garantizado_pct,
        tope_pct: c.tope_pct,
        es_resto: c.es_resto,
        reglas: JSON.stringify(c.reglas),
        bytes_minimo: c.bytes_minimo,
        reclasifica_de: c.reclasifica_de,
        activa: c.activa,
    }
}

/** Lo que se audita de una clase (sin fechas). */
export function auditableClase(c: ClaseQosVista) {
    const { created_at: creada, updated_at: actualizada, ...resto } = c
    void [creada, actualizada]
    return resto
}

/** Campos que cambiaron entre dos clases (para el evento). */
export function camposCambiados(antes: ClaseQos | null, despues: ClaseQos): string[] {
    if (!antes) return [...CAMPOS_CLASE]
    return CAMPOS_CLASE.filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
}

/** `qos.config_cambiada` con los routers que hay que reconciliar. */
export async function emitirQos(
    t: Transaccion,
    datos: {
        perfil_id: number
        clase_id: number | null
        router_id?: number | null
        campos: string[]
        routers?: number[]
    },
): Promise<void> {
    const perfil = (await t.trx
        .from('network.qos_perfiles')
        .where('id', datos.perfil_id)
        .select('empresa_id')
        .first()) as { empresa_id: number | null }
    await t.emit('qos.config_cambiada', {
        perfil_id: datos.perfil_id,
        empresa_id: perfil.empresa_id === null ? null : Number(perfil.empresa_id),
        clase_id: datos.clase_id,
        router_id: datos.router_id ?? null,
        campos: datos.campos,
        routers: datos.routers ?? (await routersAfectados(datos.perfil_id, t.trx)),
    })
}

export { clasesDePerfil, verPerfil }
