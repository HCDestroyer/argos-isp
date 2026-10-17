import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { Actor, ContextoAccion } from '#shared/contexto'
import { MASCARA, enmascarar, esCampoSensible } from '#shared/enmascarar'
import { nombreCampo } from '#shared/nombres_campo'
import { insertarEvento } from '#shared/outbox'
import type { NombreEvento, PayloadEvento } from '#shared/eventos'

/**
 * Clase base de toda acción de dominio.
 *
 * ```ts
 * export default class SuspenderServicio extends DomainAction<{ servicioId: number; motivo: string }, Servicio> {
 *     readonly nombre = 'servicios.suspender'
 *     protected async handle(input, t: Transaccion) {
 *         const antes = await Servicio.findOrFail(input.servicioId, { client: t.trx })
 *         ...
 *         await t.registrarCambios({ tipo: 'servicio', id }, antesPlano, despuesPlano)
 *         await t.emit('servicio.estado_cambiado', { servicio_id: id, de, a, motivo })
 *         return servicio
 *     }
 * }
 * await new SuspenderServicio().execute(input, ctx.contextoAccion())
 * ```
 *
 * - `execute` abre una transacción Lucid (o un savepoint si recibe `{ trx }` de otra acción).
 * - Al terminar bien escribe `audit.acciones` con resultado `ok` en la MISMA transacción.
 * - Antes del COMMIT ejecuta `SET CONSTRAINTS ALL IMMEDIATE` (ver `verificarRestriccionesDiferidas`):
 *   así un asiento descuadrado falla como error normal de la acción y no se pierde en el COMMIT.
 * - Si falla, la transacción se revierte y la auditoría del error se escribe en una transacción
 *   aparte; el error se relanza.
 * - `nombre` es el mismo nombre del permiso del ACL (`servicios.suspender`).
 * - `t.alConfirmar(fn)` registra trabajo que solo debe correr si el COMMIT se confirmó (invalidar
 *   cachés de Redis, despertar workers). En acciones anidadas se acumula en la transacción externa
 *   y se descarta si el savepoint o la transacción externa se revierten.
 */
export abstract class DomainAction<Entrada, Salida> {
    /** Nombre de la acción = nombre del permiso (`modulo.verbo`). */
    abstract readonly nombre: string

    protected abstract handle(input: Entrada, t: Transaccion): Promise<Salida>

    /**
     * Si el resultado exitoso se registra en `audit.acciones`. Por defecto siempre (regla 9).
     * Única excepción admitida: telemetría de alta frecuencia que no es una acción de nadie
     * (Interim-Update de accounting). Los errores se auditan siempre.
     */
    protected auditarExito(_salida: Salida): boolean {
        return true
    }

    async execute(
        input: Entrada,
        ctx: ContextoAccion,
        opciones: { trx?: TransactionClientContract } = {},
    ): Promise<Salida> {
        const entrada = enmascarar(input)
        let t: Transaccion | undefined

        const anidada = Boolean(opciones.trx)
        const ejecutar = async (trx: TransactionClientContract) => {
            t = new Transaccion(trx, ctx)
            transacciones.set(trx, t)
            const salida = await this.handle(input, t)
            if (this.auditarExito(salida)) {
                // t.ctx: la acción pudo identificar al actor (login)
                await registrarAccion(trx, t.ctx, this.nombre, entrada, t.entidadActual, null)
            }
            // Las acciones anidadas dejan la verificación a la transacción externa.
            if (!anidada) await verificarRestriccionesDiferidas(trx)
            return salida
        }

        let salida: Salida
        try {
            salida = opciones.trx ? await opciones.trx.transaction(ejecutar) : await db.transaction(ejecutar)
        } catch (error) {
            await this.auditarError(ctx, entrada, t?.entidadActual, error)
            throw error
        }

        const pendientes = t?.extraerGanchos() ?? []
        if (opciones.trx) {
            // El savepoint se liberó, pero la transacción externa aún puede revertirse.
            const externa = transacciones.get(opciones.trx)
            if (externa) externa.agregarGanchos(pendientes)
            else {
                for (const gancho of pendientes) opciones.trx.after('commit', () => correrGancho(gancho, ctx))
            }
        } else {
            for (const gancho of pendientes) await correrGancho(gancho, ctx)
        }
        return salida
    }

    private async auditarError(
        ctx: ContextoAccion,
        entrada: unknown,
        entidad: EntidadRef | undefined,
        error: unknown,
    ) {
        try {
            await db.transaction((trx) => registrarAccion(trx, ctx, this.nombre, entrada, entidad, error))
        } catch (errorAuditoria) {
            logger.error(
                { err: errorAuditoria, accion: this.nombre, requestId: ctx.requestId },
                'No se pudo auditar el error de la acción',
            )
        }
    }
}

/**
 * Ejecuta ya las restricciones DEFERRABLE pendientes (p. ej. el cuadre de `ledger.asientos`).
 *
 * Importante: knex (y por tanto Lucid) NO rechaza la promesa de `commit()` si el COMMIT falla por
 * una restricción diferida; la transacción se revierte en silencio. Toda transacción que inserte en
 * `ledger.*` fuera de una `DomainAction` debe llamar a esta función justo antes de terminar.
 */
export async function verificarRestriccionesDiferidas(trx: TransactionClientContract): Promise<void> {
    await trx.rawQuery('SET CONSTRAINTS ALL IMMEDIATE')
}

export interface EntidadRef {
    /** tipo en singular y snake_case: `servicio`, `cliente`, `factura` */
    tipo: string
    id: number
}

type Registro = Record<string, unknown>

/** Trabajo posterior al COMMIT (invalidar cachés, avisar a workers). */
export type GanchoConfirmacion = () => Promise<void> | void

/** Transacción Lucid → unidad de trabajo de la acción que la abrió (para acciones anidadas). */
const transacciones = new WeakMap<TransactionClientContract, Transaccion>()

async function correrGancho(gancho: GanchoConfirmacion, ctx: ContextoAccion) {
    try {
        await gancho()
    } catch (error) {
        // El cambio ya está confirmado: un gancho que falla se registra pero no revierte nada.
        logger.error({ err: error, requestId: ctx.requestId }, 'Falló un gancho posterior al COMMIT')
    }
}

/** Campos que no se auditan como cambio. */
const CAMPOS_IGNORADOS = new Set(['created_at', 'updated_at', 'version'])

/**
 * Unidad de trabajo de una ejecución: transacción, contexto y helpers de auditoría/outbox.
 */
export class Transaccion {
    #entidad?: EntidadRef
    #empresaId?: number | null
    #ganchos: GanchoConfirmacion[] = []
    #ctx: ContextoAccion

    constructor(
        readonly trx: TransactionClientContract,
        ctx: ContextoAccion,
    ) {
        this.#ctx = ctx
    }

    get ctx(): ContextoAccion {
        return this.#ctx
    }

    /**
     * Fija el actor de la acción cuando se conoce dentro de ella: `auth.login` llega anónima y
     * queda auditada (acción, cambios y eventos posteriores) con el usuario que inició sesión. Solo
     * para acciones que autentican; las demás usan el actor del contexto.
     */
    identificarActor(actor: Actor) {
        this.#ctx = { ...this.#ctx, actor }
    }

    get entidadActual(): EntidadRef | undefined {
        return this.#entidad
    }

    /**
     * Empresa a la que pertenece lo que hizo la acción (la del servicio, la de la factura…); se
     * guarda en `audit.acciones.empresa_id`. Sin llamarla, se usa la empresa activa del contexto.
     */
    fijarEmpresa(empresaId: number | null) {
        this.#empresaId = empresaId
    }

    /** Empresa para la auditoría: la fijada por la acción o la activa del contexto. */
    get empresaAuditoria(): number | null {
        return this.#empresaId !== undefined ? this.#empresaId : (this.#ctx.empresaId ?? null)
    }

    /** Entidad principal afectada; se guarda en `audit.acciones.entidad_tipo/entidad_id`. */
    fijarEntidad(tipo: string, id: number) {
        this.#entidad = { tipo, id }
    }

    /** Inserta el evento en `audit.outbox` dentro de la transacción de la acción. */
    async emit<E extends NombreEvento>(evento: E, payload: PayloadEvento<E>): Promise<void> {
        await insertarEvento(this.trx, evento, payload, this.ctx.requestId)
    }

    /**
     * Ejecuta `gancho` solo después de que la transacción más externa confirme el COMMIT.
     * Si la acción (o la que la envuelve) falla, el gancho se descarta. Errores del gancho se
     * registran en el log y no afectan la respuesta.
     */
    alConfirmar(gancho: GanchoConfirmacion): void {
        this.#ganchos.push(gancho)
    }

    /** @internal */
    extraerGanchos(): GanchoConfirmacion[] {
        const ganchos = this.#ganchos
        this.#ganchos = []
        return ganchos
    }

    /** @internal ganchos de una acción anidada que terminó bien */
    agregarGanchos(ganchos: GanchoConfirmacion[]): void {
        this.#ganchos.push(...ganchos)
    }

    /**
     * Escribe en `audit.cambios` un registro por campo que cambió entre `antes` y `despues`.
     * Acepta objetos planos o modelos Lucid (se usa `$attributes`). Los nombres de campo se
     * guardan en snake_case con `nombreCampo` (las claves snake_case quedan igual: `ipv4`,
     * `prefijo_enlace_v6`); los sensibles se enmascaran como `***`. Devuelve los campos escritos.
     */
    async registrarCambios(
        entidad: EntidadRef,
        antes: object | null | undefined,
        despues: object | null | undefined,
    ): Promise<string[]> {
        this.#entidad ??= entidad
        const a = normalizar(antes)
        const d = normalizar(despues)
        const campos = [...new Set([...Object.keys(a), ...Object.keys(d)])]
            .filter((campo) => !CAMPOS_IGNORADOS.has(campo))
            .sort()

        const filas = []
        for (const campo of campos) {
            const valorAntes = a[campo] ?? null
            const valorDespues = d[campo] ?? null
            if (JSON.stringify(valorAntes) === JSON.stringify(valorDespues)) continue
            const sensible = esCampoSensible(campo)
            filas.push({
                entidad_tipo: entidad.tipo,
                entidad_id: entidad.id,
                campo,
                antes: JSON.stringify(sensible && valorAntes !== null ? MASCARA : valorAntes),
                despues: JSON.stringify(sensible && valorDespues !== null ? MASCARA : valorDespues),
                actor_tipo: this.ctx.actor.tipo,
                actor_id: this.ctx.actor.id,
                request_id: this.ctx.requestId,
            })
        }

        if (filas.length > 0) {
            await this.trx.insertQuery().table('audit.cambios').multiInsert(filas)
        }
        return filas.map((fila) => fila.campo)
    }
}

function normalizar(entrada: object | null | undefined): Registro {
    if (!entrada) return {}
    const valor = entrada as Registro
    const origen =
        '$attributes' in valor && typeof valor.$attributes === 'object' && valor.$attributes !== null
            ? (valor.$attributes as Registro)
            : valor
    const plano = JSON.parse(JSON.stringify(origen)) as Registro
    const salida: Registro = {}
    for (const [clave, interno] of Object.entries(plano)) {
        salida[nombreCampo(clave)] = interno
    }
    return salida
}

async function registrarAccion(
    trx: TransactionClientContract,
    ctx: ContextoAccion,
    accion: string,
    entrada: unknown,
    entidad: EntidadRef | undefined,
    error: unknown,
) {
    await trx
        .insertQuery()
        .table('audit.acciones')
        .insert({
            actor_tipo: ctx.actor.tipo,
            actor_id: ctx.actor.id,
            canal: ctx.canal,
            accion,
            entidad_tipo: entidad?.tipo ?? null,
            entidad_id: entidad?.id ?? null,
            entrada: JSON.stringify(entrada ?? null),
            resultado: error ? 'error' : 'ok',
            error: error ? describirError(error) : null,
            request_id: ctx.requestId,
        })
}

function describirError(error: unknown): string {
    if (error instanceof Error) {
        const codigo = (error as { code?: unknown }).code
        return typeof codigo === 'string' ? `${codigo}: ${error.message}` : error.message
    }
    return String(error)
}
