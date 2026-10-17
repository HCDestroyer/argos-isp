import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { exigirAlcance, type DimensionesRecurso } from '#core/acl'
import { EMPRESA_PRINCIPAL, exigirEmpresaActiva, unicaEmpresaActiva } from '#core/empresas'
import type { ContextoAccion } from '#shared/contexto'
import { EmpresaNoPermitida, exigirAccesoEmpresa, type EmpresaPeticion } from '#shared/empresa_activa'
import { NoEncontrado } from '#shared/errores'

/**
 * Multiempresa en billing y ledger (`contratos/multiempresa.md`): cada documento financiero
 * (factura, pago, promesa, caja, asiento…) es de UNA empresa (`empresa_id`).
 *
 * - Un documento concreto (`/facturas/:id`, `/pagos/:id`…) se abre si su empresa está en el
 *   alcance del usuario (todas sus empresas, no solo la activa), igual que en el núcleo; si no,
 *   403 `empresa_no_permitida`.
 * - Las listas filtran con `empresasDeLaLista` + `filtrarPorEmpresa` (`#shared/empresa_activa`).
 */

/** Dimensiones de un documento: alcance ACL (router/zona/caja) y su empresa. */
export type DimensionesDocumento = DimensionesRecurso & { empresa_id?: number | null }

/** 403 `empresa_no_permitida` si la empresa está fuera del alcance de la petición. */
export function exigirEmpresaPeticion(empresa: EmpresaPeticion | undefined, empresaId: number): void {
    const permitidas = empresa?.permitidas
    if (permitidas && !permitidas.includes(empresaId)) throw new EmpresaNoPermitida(empresaId)
}

/** Alcance (router/zona/caja) y empresa de un documento concreto, en una ruta. */
export function exigirAcceso(ctx: HttpContext, recurso: DimensionesDocumento): void {
    const { empresa_id: empresaId, ...dimensiones } = recurso
    exigirAlcance(ctx.alcance, dimensiones)
    if (empresaId !== undefined && empresaId !== null) exigirEmpresaPeticion(ctx.empresa, Number(empresaId))
}

/** `empresa_id` de una fila (`billing.facturas`, `ledger.cajas`…); 404 si no existe. */
export async function empresaDe(
    tabla: string,
    id: number,
    cliente: QueryClientContract = db.connection(),
    que = 'El documento',
): Promise<number> {
    const fila = (await cliente.from(tabla).where('id', id).select('empresa_id').first()) as {
        empresa_id: number
    } | null
    if (!fila) throw new NoEncontrado(`${que} ${id} no existe`)
    return Number(fila.empresa_id)
}

/**
 * Empresa de algo importado (`contratos/importacion.md`): la explícita (`empresa_id`, 422 si no
 * existe o está desactivada), la del servicio, la activa del contexto, la única activa o la 1.
 */
export async function empresaDeImportacion(
    cliente: QueryClientContract,
    ctx: ContextoAccion,
    datos: { empresa_id?: number | null; servicio_id?: number | null; cliente_id?: number | null },
): Promise<number> {
    let id: number | null = null
    if (datos.empresa_id) {
        await exigirEmpresaActiva(cliente, datos.empresa_id)
        id = datos.empresa_id
    }
    if (id === null && datos.servicio_id) {
        const fila = await cliente
            .from('core.servicios')
            .where('id', datos.servicio_id)
            .select('empresa_id')
            .first()
        if (fila) id = Number(fila.empresa_id)
    }
    if (id === null && datos.cliente_id) {
        // un cliente con servicios de una sola empresa: esa
        const filas = (await cliente
            .from('core.servicios')
            .where('cliente_id', datos.cliente_id)
            .distinct('empresa_id')) as Array<{ empresa_id: number }>
        if (filas.length === 1) id = Number(filas[0]!.empresa_id)
    }
    id ??= ctx.empresaId ?? (await unicaEmpresaActiva(cliente)) ?? EMPRESA_PRINCIPAL
    exigirAccesoEmpresa(ctx, id)
    return id
}

/** Nombre comercial y NIT de unas empresas (recibos, estados de cuenta, reportes consolidados). */
export async function resumenEmpresas(
    ids: number[],
    cliente: QueryClientContract = db.connection(),
): Promise<Map<number, { id: number; nombre_comercial: string; nit: string | null }>> {
    if (ids.length === 0) return new Map()
    const filas = (await cliente
        .from('core.empresas')
        .whereIn('id', [...new Set(ids)])
        .select('id', 'nombre_comercial', 'nit')) as Array<{
        id: number
        nombre_comercial: string
        nit: string | null
    }>
    return new Map(filas.map((f) => [Number(f.id), { ...f, id: Number(f.id) }]))
}

/**
 * Emisor de una factura para FEL (semana 5): los datos fiscales de SU empresa. Solo lectura; FEL
 * construye el XML con esto (NIT, razón social, régimen ISR para las frases, establecimiento).
 */
export interface EmisorFactura {
    empresa_id: number
    nit: string | null
    razon_social: string | null
    nombre_comercial: string
    direccion_fiscal: string | null
    municipio: string | null
    departamento: string | null
    correo: string | null
    regimen_isr: string | null
    codigo_establecimiento: number | null
}

export async function emisorDeFactura(
    facturaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<EmisorFactura> {
    const fila = (await cliente
        .from('billing.facturas as f')
        .join('core.empresas as e', 'e.id', 'f.empresa_id')
        .where('f.id', facturaId)
        .select(
            'e.id as empresa_id',
            'e.nit',
            'e.razon_social',
            'e.nombre_comercial',
            'e.direccion_fiscal',
            'e.municipio',
            'e.departamento',
            'e.correo',
            'e.regimen_isr',
            'e.codigo_establecimiento',
        )
        .first()) as EmisorFactura | null
    if (!fila) throw new NoEncontrado(`La factura ${facturaId} no existe`)
    return {
        ...fila,
        empresa_id: Number(fila.empresa_id),
        codigo_establecimiento:
            fila.codigo_establecimiento === null ? null : Number(fila.codigo_establecimiento),
    }
}
