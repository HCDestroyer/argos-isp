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
