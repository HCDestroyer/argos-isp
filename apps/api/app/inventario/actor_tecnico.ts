import type { Transaccion } from '#shared/domain_action'

/**
 * Quién usó el material (contrato Iris 0.11.0 §3.9): cada movimiento de una operación de Iris guarda
 * `actor_tecnico` (`X-Iris-Actor`, nunca del cuerpo), `actor_tecnico_id` (el usuario de Argos del técnico)
 * y `ocurrido_en` (la `fecha` del teléfono). La acción lo fija una vez en su transacción y
 * `insertarMovimiento` lo copia en cada movimiento que registra.
 */
export interface ActorTecnico {
    actor: string | null
    usuarioId: number | null
    ocurridoEn: Date | null
}

/**
 * Por contexto de la acción: las acciones anidadas (`{ trx }`, un savepoint con otro cliente) comparten
 * el `ctx` de la que las llama. Se borra al terminar la transacción que lo fijó.
 */
const actores = new WeakMap<object, ActorTecnico>()

export function fijarActorTecnico(t: Transaccion, actor: ActorTecnico): void {
    const clave = t.ctx
    actores.set(clave, actor)
    const limpiar = () => {
        if (actores.get(clave) === actor) actores.delete(clave)
    }
    t.trx.after('commit', limpiar)
    t.trx.after('rollback', limpiar)
}

export function actorTecnicoDe(t: Transaccion): ActorTecnico | null {
    return actores.get(t.ctx) ?? null
}

/** Columnas de `inventario.movimientos` del actor fijado (todas null si no hay). */
export function columnasActorTecnico(t: Transaccion) {
    const a = actorTecnicoDe(t)
    return {
        actor_tecnico: a?.actor ?? null,
        actor_tecnico_id: a?.usuarioId ?? null,
        ocurrido_en: a?.ocurridoEn ?? null,
    }
}
