import type { ContextoAccion } from '#shared/contexto'
import { Problema } from '#shared/errores'

/**
 * Empresa activa y alcance por empresa en las acciones (`contratos/multiempresa.md`).
 *
 * El middleware `empresa` deja en el `ContextoAccion` de cada petición del panel o la API:
 * - `empresaId`: la empresa activa (`X-Empresa-Id` o la única del usuario); null si el usuario tiene
 *   varias y no eligió.
 * - `empresasPermitidas`: las empresas a las que tiene acceso; null = todas (alcance global).
 *
 * Fuera de HTTP (crons, workers, consola) ambos faltan: sin restricción y sin empresa activa.
 */

/** 403 `empresa_no_permitida`: el actor no tiene acceso a esa empresa. */
export class EmpresaNoPermitida extends Problema {
    constructor(empresaId: number) {
        super(
            403,
            'empresa_no_permitida',
            'Empresa no permitida',
            `No tienes acceso a la empresa ${empresaId}`,
        )
    }
}

/** 422 `empresa_requerida`: la acción necesita una empresa y no hay una activa ni se pudo deducir. */
export class EmpresaRequerida extends Problema {
    constructor(
        detalle = 'Elige la empresa con la que trabajas (cabecera X-Empresa-Id) o indica empresa_id',
    ) {
        super(422, 'empresa_requerida', 'Empresa requerida', detalle)
    }
}

/** ¿El actor del contexto puede operar en `empresaId`? */
export function tieneAccesoEmpresa(ctx: ContextoAccion, empresaId: number): boolean {
    const permitidas = ctx.empresasPermitidas
    return permitidas === null || permitidas === undefined || permitidas.includes(empresaId)
}

/** 403 `empresa_no_permitida` si el actor del contexto no tiene acceso a `empresaId`. */
export function exigirAccesoEmpresa(ctx: ContextoAccion, empresaId: number): void {
    if (!tieneAccesoEmpresa(ctx, empresaId)) throw new EmpresaNoPermitida(empresaId)
}

/**
 * Empresa activa del contexto, para lo que no depende de un servicio (cajas, egresos, cuentas
 * bancarias, asientos manuales). 422 `empresa_requerida` si no hay.
 */
export function exigirEmpresaActivaDelContexto(ctx: ContextoAccion): number {
    if (ctx.empresaId === null || ctx.empresaId === undefined) throw new EmpresaRequerida()
    return ctx.empresaId
}

/**
 * Empresa de la petición HTTP (la deja el middleware `empresa` en `ctx.empresa`, rutas con sesión).
 */
export interface EmpresaPeticion {
    /** empresa activa: `X-Empresa-Id` o la única del usuario; null si tiene varias y no eligió */
    activa: number | null
    /** empresas activas a las que tiene acceso */
    empresas: number[]
    /** null = sin restricción (alcance global) */
    permitidas: number[] | null
    alcanceGlobal: boolean
    /** tiene acceso a todas las empresas activas (global o asignadas todas) */
    accesoTotal: boolean
}

/**
 * Empresas por las que filtrar una lista (`contratos/multiempresa.md`):
 * - `?empresas=todas` (consolidado): sin filtro (`null`), solo con alcance global o acceso a todas
 *   las empresas; si no, 403 `empresa_no_permitida`.
 * - con empresa activa: `[activa]`.
 * - sin empresa activa (varias empresas y sin `X-Empresa-Id`): las de su alcance (`null` con
 *   alcance global).
 * - fuera de una petición con sesión (sin `ctx.empresa`): sin filtro.
 *
 * Con una sola empresa el resultado es `[1]` y la lista es la misma de siempre.
 */
export function empresasDeLaLista(
    peticion: EmpresaPeticion | undefined,
    consolidado?: 'todas' | null,
): number[] | null {
    if (!peticion) return null
    if (consolidado === 'todas') {
        if (!peticion.accesoTotal) {
            throw new Problema(
                403,
                'empresa_no_permitida',
                'Empresa no permitida',
                'El consolidado de todas las empresas (empresas=todas) requiere alcance global',
            )
        }
        return null
    }
    if (peticion.activa !== null) return [peticion.activa]
    return peticion.permitidas
}

/**
 * Aplica el filtro de `empresasDeLaLista` a una consulta:
 * `filtrarPorEmpresa(q, empresas, (q, ids) => q.whereIn('s.empresa_id', ids))`. Con `null` no filtra.
 */
export function filtrarPorEmpresa<Q>(
    consulta: Q,
    empresas: number[] | null,
    aplicar: (q: Q, ids: number[]) => void,
): Q {
    if (empresas !== null) aplicar(consulta, empresas)
    return consulta
}
