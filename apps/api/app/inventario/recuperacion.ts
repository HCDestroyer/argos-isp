import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import { actualizarUnidad } from '#inventario/unidades'
import { enmascararSerie } from '#inventario/equipos'
import type { OrigenExterno, OrigenExternoTipo } from '#inventario/origen_externo'

/**
 * Intentos de recuperación y cambios con cobro propuesto verificados con Iris (contrato Iris 0.14.0 §3.10,
 * §4.5; R-01 a R-03, T-1, T-2, T-7, N-4, N-5).
 *
 * **Estado de la verificación** de un intento (o de un cambio con cobro propuesto), en
 * `inventario.verificaciones_iris`:
 *
 * | Estado | Qué es | ¿Cuenta? |
 * | --- | --- | --- |
 * | (sin fila) `no_aplica` | registrado por una persona en Argos (no viene de Iris) | sí |
 * | `pendiente` | de un Iris ≥ 0.14.0, esperando la respuesta de Iris (con su `motivo`) | no |
 * | `verificado` | Iris lo confirmó | sí |
 * | `no_verificado` | Iris no lo confirma (`motivo`); queda solo como registro | no |
 * | `anterior` | de un Iris < 0.14.0 o anterior a la verificación: lo decide una persona | no |
 * | `aceptado` / `descartado` | decisión de una persona sobre uno `anterior` | aceptado sí |
 *
 * «Cuenta» quiere decir: pasa la unidad a `por_recuperar`, avisa al titular (verificados y de Argos, uno
 * por servicio al día) y suma para el mínimo de técnicos distintos al declarar la unidad no recuperada.
 */

export const ESTADOS_VERIFICACION = [
    'no_aplica',
    'pendiente',
    'verificado',
    'no_verificado',
    'anterior',
    'aceptado',
    'descartado',
] as const
export type EstadoVerificacion = (typeof ESTADOS_VERIFICACION)[number]

/** Motivos de la lista cerrada de Iris (§3.10) y los de Argos mientras la verificación no es concluyente. */
export const MOTIVOS_VERIFICACION = [
    // de Iris
    'envio_en_curso',
    'foto_pendiente',
    'no_enviado_por_iris',
    'no_coincide',
    'foto_invalida',
    // de Argos
    'desconocido_en_iris',
    'error_iris',
    'timeout',
    'sin_acceso',
    'limitado',
    'sin_conector',
    'respuesta_invalida',
] as const
export type MotivoVerificacion = (typeof MOTIVOS_VERIFICACION)[number]

/** Motivos de `no_verificado` con los que un intento no ocupa el cupo del día (T-2). */
export const MOTIVOS_SIN_CUPO: readonly string[] = [
    'desconocido_en_iris',
    'no_enviado_por_iris',
    'no_coincide',
]

/** Condición SQL (sobre el alias `v` de `inventario.verificaciones_iris`, con LEFT JOIN): el intento cuenta. */
export const SQL_CUENTA = `(v.id IS NULL OR v.estado IN ('verificado', 'aceptado'))`

/** Estado visible: sin fila, `no_aplica`. */
export function estadoVisible(estado: string | null | undefined): EstadoVerificacion {
    return (estado ?? 'no_aplica') as EstadoVerificacion
}

/**
 * El intento que ocupa el cupo del día está pendiente de verificar: la ruta lo verifica con Iris y vuelve
 * a intentar una vez. Si sale de la acción (no se pudo verificar), es un `503` con `Retry-After` (N-4):
 * nunca `429 demasiados_intentos` con una verificación no concluyente.
 */
export class CupoPorVerificar extends Problema {
    constructor(
        readonly verificaciones: number[],
        readonly reintentarEnS = 60,
    ) {
        super(
            503,
            'verificacion_no_concluyente',
            'Verificación no concluyente',
            'El intento que ocupa el cupo de hoy espera la verificación de Iris: reintenta más tarde',
        )
    }
}

/**
 * Aplica los efectos de un intento que cuenta: si la unidad sigue en comodato en el servicio del intento,
 * pasa a `por_recuperar`; con `avisar`, el aviso al titular (`inventario.recuperacion_intentada`), como
 * máximo uno por servicio y día de Guatemala (`inventario.avisos_recuperacion`). Con la unidad bloqueada
 * por quien llama, o la bloquea aquí.
 */
export async function aplicarIntentoQueCuenta(
    t: Transaccion,
    intentoId: number,
    opciones: { avisar: boolean },
): Promise<{ por_recuperar: boolean; aviso: boolean }> {
    const intento = (await t.trx
        .from('inventario.intentos_recuperacion as i')
        .join('core.servicios as s', 's.id', 'i.servicio_id')
        .where('i.id', intentoId)
        .select(
            'i.id',
            'i.empresa_id',
            'i.unidad_id',
            'i.servicio_id',
            's.cliente_id',
            'i.intento_n',
            'i.motivo',
            'i.dia',
            'i.origen_externo_tipo',
            'i.origen_externo_id',
            t.trx.raw(`to_char(i.dia, 'YYYY-MM-DD') as dia_texto`),
        )
        .first()) as {
        id: number
        empresa_id: number
        unidad_id: number
        servicio_id: number
        cliente_id: number
        intento_n: number
        motivo: string
        dia_texto: string
        origen_externo_tipo: OrigenExternoTipo | null
        origen_externo_id: string | null
    }
    const unidad = (await t.trx
        .from('inventario.unidades')
        .where('id', intento.unidad_id)
        .forUpdate()
        .select('id', 'estado', 'servicio_id', 'serie', 'mac')
        .first()) as {
        id: number
        estado: string
        servicio_id: number | null
        serie: string | null
        mac: string | null
    }
    const origenExterno: OrigenExterno | null =
        intento.origen_externo_tipo && intento.origen_externo_id
            ? { tipo: intento.origen_externo_tipo, id: intento.origen_externo_id }
            : null
    let porRecuperar = false
    const delServicio =
        unidad.servicio_id !== null && Number(unidad.servicio_id) === Number(intento.servicio_id)
    if (delServicio && unidad.estado === 'en_comodato') {
        await actualizarUnidad(
            t,
            Number(unidad.id),
            { estado: 'por_recuperar' },
            { motivo: 'intento_recuperacion', origenExterno },
        )
        porRecuperar = true
    }
    let aviso = false
    if (
        opciones.avisar &&
        delServicio &&
        (unidad.estado === 'en_comodato' || unidad.estado === 'por_recuperar')
    ) {
        const filas = (await t.trx.rawQuery(
            `INSERT INTO inventario.avisos_recuperacion (empresa_id, servicio_id, dia, intento_id)
             VALUES (?, ?, ?, ?) ON CONFLICT (servicio_id, dia) DO NOTHING RETURNING id`,
            [intento.empresa_id, intento.servicio_id, intento.dia_texto, intento.id],
        )) as { rows: Array<{ id: number }> }
        if (filas.rows.length > 0) {
            aviso = true
            await t.emit('inventario.recuperacion_intentada', {
                intento_id: Number(intento.id),
                unidad_id: Number(unidad.id),
                empresa_id: Number(intento.empresa_id),
                servicio_id: Number(intento.servicio_id),
                cliente_id: Number(intento.cliente_id),
                intento_n: Number(intento.intento_n),
                motivo: intento.motivo,
                serie_enmascarada: enmascararSerie(unidad.serie, unidad.mac),
                origen_externo_tipo: intento.origen_externo_tipo,
                origen_externo_id: intento.origen_externo_id,
            })
        }
    }
    return { por_recuperar: porRecuperar, aviso }
}

export interface IntentoConVerificacion {
    id: number
    servicio_id: number
    intento_n: number
    motivo: string
    foto_ref: string | null
    lat: string
    lng: string
    precision_m: string
    nota: string | null
    fecha: Date
    dia: string
    actor_tecnico: string | null
    actor_tecnico_id: number | null
    actor_tecnico_nombre: string | null
    origen_externo_id: string | null
    created_at: Date
    verificacion_id: number | null
    verificacion: EstadoVerificacion
    verificacion_motivo: string | null
    verificado_en: Date | null
    verificacion_consultas: number
    verificacion_proxima_en: Date | null
    decidido_por: number | null
    decidido_en: Date | null
    motivo_decision: string | null
    /** cuenta para el mínimo de técnicos distintos */
    cuenta: boolean
    /** la ubicación y la autoría las afirma Iris (no las revalida Argos, §3.10) */
    afirmado_por_iris: boolean
}

/** Intentos de una unidad con su verificación (pantalla de declaración). */
export async function intentosConVerificacion(
    unidadId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<IntentoConVerificacion[]> {
    const filas = (await cliente
        .from('inventario.intentos_recuperacion as i')
        .leftJoin('inventario.verificaciones_iris as v', 'v.intento_id', 'i.id')
        .leftJoin('core.usuarios as u', 'u.id', 'i.actor_tecnico_id')
        .where('i.unidad_id', unidadId)
        .orderBy('i.id')
        .select(
            'i.id',
            'i.servicio_id',
            'i.intento_n',
            'i.motivo',
            'i.foto_ref',
            cliente.raw('i.lat::text as lat'),
            cliente.raw('i.lng::text as lng'),
            cliente.raw('i.precision_m::text as precision_m'),
            'i.nota',
            'i.fecha',
            cliente.raw(`to_char(i.dia, 'YYYY-MM-DD') as dia`),
            'i.actor_tecnico',
            'i.actor_tecnico_id',
            'u.nombre as actor_tecnico_nombre',
            'i.origen_externo_id',
            'i.created_at',
            'v.id as verificacion_id',
            'v.estado as verificacion',
            'v.motivo as verificacion_motivo',
            'v.verificado_en',
            'v.consultas as verificacion_consultas',
            'v.proxima_en as verificacion_proxima_en',
            'v.decidido_por',
            'v.decidido_en',
            'v.motivo_decision',
        )) as Array<Record<string, unknown>>
    const n = (x: unknown) => (x === null || x === undefined ? null : Number(x))
    return filas.map((f) => {
        const estado = estadoVisible(f.verificacion as string | null)
        return {
            ...(f as unknown as IntentoConVerificacion),
            id: Number(f.id),
            servicio_id: Number(f.servicio_id),
            intento_n: Number(f.intento_n),
            actor_tecnico_id: n(f.actor_tecnico_id),
            verificacion_id: n(f.verificacion_id),
            verificacion: estado,
            verificacion_consultas: Number(f.verificacion_consultas ?? 0),
            decidido_por: n(f.decidido_por),
            cuenta: estado === 'no_aplica' || estado === 'verificado' || estado === 'aceptado',
            afirmado_por_iris: estado !== 'no_aplica',
        }
    })
}
