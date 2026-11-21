import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import { usuarioIris } from '#core/integraciones_iris'
import { alcanceEmpresasDeUsuario } from '#core/alcance_empresas'
import { contratoAdmite, leerFilaIris } from '#integraciones/iris/configuracion'
import { bodegasDelUsuario } from '#inventario/tecnicos'

/**
 * Vínculo de cada técnico de Iris con su usuario de Argos (contrato Iris 0.14.0 §3.9 y §6.6; R-10, T-6,
 * N-1 a N-3). Llega por los webhooks `tecnico.argos_vinculado` / `tecnico.argos_desvinculado` (acción
 * `inventario.sincronizar_vinculo_tecnico`) y se concilia con `GET <iris>/…/tecnicos/:usuario_id`.
 *
 * - **Solo con un Iris que informó contrato ≥ 0.14.0.** En las peticiones del token de Iris que traen
 *   `tecnico` (consumos, comodatos, devoluciones, recepciones, cambios): sin vínculo conocido del actor,
 *   `403 actor_desconocido` (mientras dura la carga inicial, `409 vinculos_en_carga`, que Iris
 *   reintenta); con un vínculo de otro usuario de Argos, `403 actor_no_coincide`, también en la bodega
 *   personal. Con un contrato anterior, nada cambia (solo la cuadrilla exige el actor, §3.9).
 * - **Solo de inventario** (T-10): vive aparte del vínculo de §7.7 (`core.vinculos_iris`) y nunca
 *   autoriza una acción de pagos y atención.
 */

export const CONTRATO_VINCULOS = '0.14.0'

const FORMATO_ACTOR = /^usuario:([A-Za-z0-9_-]{1,64})$/

export function idIrisDe(actor: string | null | undefined): string | null {
    const m = actor ? FORMATO_ACTOR.exec(actor.trim()) : null
    return m ? m[1]! : null
}

/** ¿La acción la hace el usuario técnico Iris con su token? (sin mirar la ruta) */
export async function esActorIris(t: Transaccion): Promise<boolean> {
    if (t.ctx.actor.tipo !== 'token' || t.ctx.actor.id === null) return false
    const iris = await usuarioIris(t.trx)
    return iris !== null && iris === t.ctx.actor.id
}

export interface EstadoVinculos {
    /** el Iris conectado informó contrato ≥ 0.14.0 */
    exige: boolean
    /** la carga inicial de vínculos sigue abierta (N-1) */
    enCarga: boolean
    contrato: string | null
}

/** Estado de los vínculos según el conector (sin caché: se lee en cada uso). */
export async function estadoVinculos(
    cliente: QueryClientContract = db.connection(),
): Promise<EstadoVinculos> {
    const fila = await leerFilaIris(cliente)
    const exige = contratoAdmite(fila?.contrato, CONTRATO_VINCULOS)
    return { exige, enCarga: exige && !fila?.vinculos_cargados_en, contrato: fila?.contrato ?? null }
}

export function actorDesconocido(detalle: string): Problema {
    return new Problema(403, 'actor_desconocido', 'Actor desconocido', detalle, [
        { field: 'X-Iris-Actor', message: detalle, rule: 'actor_desconocido' },
    ])
}

export function vinculosEnCarga(): Problema {
    return new Problema(
        409,
        'vinculos_en_carga',
        'Vínculos de técnicos en carga',
        'Iris todavía no cerró la carga inicial de vínculos de técnicos (PUT /integraciones/iris/contrato con vinculos_cargados): reintenta',
    )
}

function actorNoCoincideVinculo(detalle: string): Problema {
    return new Problema(403, 'actor_no_coincide', 'El actor no coincide', detalle, [
        { field: 'X-Iris-Actor', message: detalle, rule: 'actor_no_coincide' },
    ])
}

export interface VinculoVigente {
    id: number
    usuario_id: number
    iris_usuario_id: string
}

/** Vínculo vigente del usuario de Iris en la empresa, o null. */
export async function vinculoVigente(
    cliente: QueryClientContract,
    empresaId: number,
    irisUsuarioId: string,
): Promise<VinculoVigente | null> {
    const fila = (await cliente
        .from('inventario.tecnicos_iris')
        .where({ empresa_id: empresaId, iris_usuario_id: irisUsuarioId, estado: 'vinculado' })
        .select('id', 'usuario_id', 'iris_usuario_id')
        .first()) as VinculoVigente | null
    return fila ? { ...fila, id: Number(fila.id), usuario_id: Number(fila.usuario_id) } : null
}

/**
 * Con el token de Iris y un contrato ≥ 0.14.0: el actor (`X-Iris-Actor`) tiene vínculo conocido en la
 * empresa y es el del técnico de la petición. Se llama **antes** de mirar bodegas y existencias. Con otro
 * actor o con un contrato anterior no hace nada. Devuelve el vínculo (o null si no aplica).
 */
export async function exigirVinculoIris(
    t: Transaccion,
    datos: { usuarioId: number; empresaId: number; iris_actor?: string | null },
): Promise<VinculoVigente | null> {
    if (!(await esActorIris(t))) return null
    const estado = await estadoVinculos(t.trx)
    if (!estado.exige) return null
    const idIris = idIrisDe(datos.iris_actor)
    if (!idIris) {
        throw new Problema(
            400,
            'cabecera_iris_requerida',
            'Faltan las cabeceras de Iris',
            'X-Iris-Actor (`usuario:<id en Iris>`) es obligatoria cuando la petición trae `tecnico`',
            [{ field: 'X-Iris-Actor', message: 'Obligatoria', rule: 'cabecera_iris_requerida' }],
        )
    }
    const vinculo = await vinculoVigente(t.trx, datos.empresaId, idIris)
    if (!vinculo) {
        if (estado.enCarga) throw vinculosEnCarga()
        throw actorDesconocido(
            `El usuario de Iris ${idIris} no tiene un vínculo de técnico conocido en la empresa ${datos.empresaId}`,
        )
    }
    if (vinculo.usuario_id !== datos.usuarioId) {
        throw actorNoCoincideVinculo(
            `X-Iris-Actor (usuario:${idIris}) está vinculado a otro usuario de Argos, no al técnico ${datos.usuarioId}`,
        )
    }
    return vinculo
}

/**
 * Usuario de Argos aceptable como técnico de la empresa (§3.9 y §6.6): activo, con bodega de técnico en
 * ella o con el rol `tecnico` y la empresa en su alcance. `motivo` si no (`usuario_inexistente`,
 * `usuario_inactivo`, `no_es_tecnico`, `fuera_de_la_empresa`). Lo comparten la cuadrilla y el vínculo.
 */
export async function validarTecnicoDeEmpresa(
    cliente: QueryClientContract,
    idExterno: string | null,
    empresaId: number,
): Promise<{ usuarioId: number | null; motivo: string | null }> {
    if (idExterno === null) return { usuarioId: null, motivo: 'sin_vinculo' }
    if (!/^\d{1,18}$/.test(idExterno)) return { usuarioId: null, motivo: 'usuario_inexistente' }
    const usuarioId = Number(idExterno)
    const usuario = await cliente.from('core.usuarios').where('id', usuarioId).select('activo').first()
    if (!usuario) return { usuarioId: null, motivo: 'usuario_inexistente' }
    if (!usuario.activo) return { usuarioId, motivo: 'usuario_inactivo' }
    const propias = await bodegasDelUsuario(cliente, usuarioId, [empresaId])
    if (propias.length > 0) return { usuarioId, motivo: null }
    const rol = await cliente
        .from('core.usuarios_roles as ur')
        .join('core.roles as r', 'r.id', 'ur.role_id')
        .where('ur.usuario_id', usuarioId)
        .where('r.nombre', 'tecnico')
        .select('ur.usuario_id')
        .first()
    if (!rol) return { usuarioId, motivo: 'no_es_tecnico' }
    const alcance = await alcanceEmpresasDeUsuario(usuarioId, cliente)
    if (!alcance.alcanceGlobal && !alcance.empresas.includes(empresaId)) {
        return { usuarioId, motivo: 'fuera_de_la_empresa' }
    }
    return { usuarioId, motivo: null }
}

export interface VinculoTecnicoVista {
    id: number
    empresa_id: number
    iris_usuario_id: string
    iris_tecnico_id: string | null
    id_externo: string | null
    usuario_id: number | null
    usuario_nombre: string | null
    estado: 'vinculado' | 'rechazado' | 'desvinculado'
    motivo: string | null
    version: number
    origen: 'webhook' | 'conciliacion'
    reevaluar_en: Date | null
    updated_at: Date
}

/** Vínculos de técnicos de Iris (panel: `vinculo_rechazado` y su motivo). */
export async function listarVinculosTecnicos(
    filtros: { estado?: string | null },
    empresas: number[] | null,
): Promise<VinculoTecnicoVista[]> {
    const q = db
        .from('inventario.tecnicos_iris as v')
        .leftJoin('core.usuarios as u', 'u.id', 'v.usuario_id')
        .if(filtros.estado, (c) => c.where('v.estado', filtros.estado!))
        .orderBy('v.id')
        .select(
            'v.id',
            'v.empresa_id',
            'v.iris_usuario_id',
            'v.iris_tecnico_id',
            'v.id_externo',
            'v.usuario_id',
            'u.nombre as usuario_nombre',
            'v.estado',
            'v.motivo',
            'v.version',
            'v.origen',
            'v.reevaluar_en',
            'v.updated_at',
        )
    if (empresas !== null) q.whereIn('v.empresa_id', empresas)
    const filas = (await q) as VinculoTecnicoVista[]
    return filas.map((f) => ({
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        usuario_id: f.usuario_id === null ? null : Number(f.usuario_id),
        version: Number(f.version),
    }))
}

/** ¿La empresa está en el alcance del usuario técnico Iris? (sin usuario Iris, sí) */
export async function empresaEnAlcanceIris(
    cliente: QueryClientContract,
    empresaId: number,
): Promise<boolean> {
    const iris = await usuarioIris(cliente)
    if (!iris) return true
    const alcance = await alcanceEmpresasDeUsuario(iris, cliente)
    return alcance.alcanceGlobal || alcance.empresas.includes(empresaId)
}
