import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { limpiarDocumento, validarDocumentoFiscal } from '#core/nit_cui'
import { CERO, dec, type Dec } from '#ledger/dinero'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'

/**
 * Proveedores de una empresa (contrato de localización fiscal §3.4, fase 5). Catálogo con `version`
 * y `audit.cambios`; las acciones (`proveedores.crear`, `proveedores.editar`) viven en `actions/`.
 *
 * - Documento: `nit` (con el validador del núcleo, `#core/nit_cui`), `cui` (estructura del RENAP)
 *   o `id_extranjero` (no residentes: 3 a 30 letras, dígitos o guiones). Se guarda normalizado y
 *   es único por empresa entre los activos (409 `proveedor_duplicado`).
 * - `tipo`: `general`, `pequeno_contribuyente` (FPEQ/FCAP: sin crédito fiscal; la empresa agente le
 *   retiene el 5 % del total), `no_residente` (retención de ISR del art. 104) y `sin_documento`
 *   (persona a quien la empresa emite factura especial, FESP).
 * - El saldo del proveedor es la suma de su auxiliar en `2.1.03 Proveedores` (`saldoProveedor`):
 *   nunca una columna.
 */

export const TIPOS_DOCUMENTO_PROVEEDOR = ['nit', 'cui', 'id_extranjero'] as const
export type TipoDocumentoProveedor = (typeof TIPOS_DOCUMENTO_PROVEEDOR)[number]
export const TIPOS_PROVEEDOR = ['general', 'pequeno_contribuyente', 'no_residente', 'sin_documento'] as const
export type TipoProveedor = (typeof TIPOS_PROVEEDOR)[number]
export const REGIMENES_PROVEEDOR = ['utilidades', 'opcional_simplificado', 'pequeno_contribuyente'] as const
export type RegimenProveedor = (typeof REGIMENES_PROVEEDOR)[number]

export interface ProveedorVista {
    id: number
    empresa_id: number
    tipo_documento: TipoDocumentoProveedor
    nit: string
    nombre: string
    tipo: TipoProveedor
    regimen_isr: RegimenProveedor | null
    agente_retencion_iva: boolean
    pais: string
    direccion: string | null
    correo: string | null
    telefono: string | null
    dias_credito: number
    activo: boolean
    /** saldo de su auxiliar en 2.1.03 (haber − debe: lo que la empresa le debe) */
    saldo: string
    version: number
    created_at: Date
    updated_at: Date
}

/** Documento normalizado del proveedor; 422 por campo si no es válido. */
export function normalizarDocumentoProveedor(
    tipo: TipoDocumentoProveedor,
    valor: string,
    pais: string,
): string {
    if (tipo === 'id_extranjero') {
        const limpio = valor.trim().toUpperCase()
        if (!/^[A-Z0-9-]{3,30}$/.test(limpio)) {
            throw new ValidacionFallida([
                {
                    field: 'nit',
                    message: 'El identificador extranjero lleva de 3 a 30 letras, dígitos o guiones',
                    rule: 'id_extranjero',
                },
            ])
        }
        return limpio
    }
    const documento = validarDocumentoFiscal({ tipo, valor, pais })
    return documento.nit_cui ?? limpiarDocumento(valor)
}

function consultaProveedores(cliente: QueryClientContract) {
    return cliente.from('ledger.proveedores as p').select(
        'p.id',
        'p.empresa_id',
        'p.tipo_documento',
        'p.nit',
        'p.nombre',
        'p.tipo',
        'p.regimen_isr',
        'p.agente_retencion_iva',
        cliente.raw('btrim(p.pais) as pais'),
        'p.direccion',
        'p.correo',
        'p.telefono',
        'p.dias_credito',
        'p.activo',
        cliente.raw(
            `(SELECT coalesce(sum(m.haber - m.debe), 0)::numeric(14,2)::text
                    FROM ledger.movimientos m JOIN ledger.cuentas c ON c.id = m.cuenta_id
                   WHERE m.proveedor_id = p.id AND c.codigo = ?) as saldo`,
            [CUENTAS_GT.PROVEEDORES],
        ),
        'p.version',
        'p.created_at',
        'p.updated_at',
    )
}

function normalizar(fila: ProveedorVista): ProveedorVista {
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        dias_credito: Number(fila.dias_credito),
        version: Number(fila.version),
    }
}

export async function verProveedor(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ProveedorVista> {
    const fila = (await consultaProveedores(cliente).where('p.id', id).first()) as ProveedorVista | null
    if (!fila) throw new NoEncontrado(`El proveedor ${id} no existe`)
    return normalizar(fila)
}

export interface FiltrosProveedores extends OpcionesPaginacion {
    buscar?: string
    tipo?: TipoProveedor
    activo?: boolean
}

export async function listarProveedores(filtros: FiltrosProveedores, empresas: number[] | null) {
    const consulta = consultaProveedores(db.connection())
        .if(filtros.tipo, (q) => q.where('p.tipo', filtros.tipo!))
        .if(filtros.activo !== undefined, (q) => q.where('p.activo', filtros.activo!))
        .if(filtros.buscar, (q) =>
            q.where((w) =>
                w
                    .whereILike('p.nombre', `%${filtros.buscar!.trim()}%`)
                    .orWhere('p.nit', limpiarDocumento(filtros.buscar!)),
            ),
        )
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('p.empresa_id', ids))
    const pagina = await paginar<ProveedorVista>(consulta, filtros, { columna: 'p.id' })
    return { ...pagina, data: pagina.data.map(normalizar) }
}

/** Empresa del proveedor (para el ACL de la ruta); 404 si no existe. */
export async function empresaDeProveedor(id: number): Promise<{ empresa_id: number }> {
    const fila = await db.from('ledger.proveedores').where('id', id).select('empresa_id').first()
    if (!fila) throw new NoEncontrado(`El proveedor ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id) }
}

/** Saldo del auxiliar del proveedor en `2.1.03` (haber − debe), opcionalmente a una fecha. */
export async function saldoProveedor(
    proveedorId: number,
    cliente: QueryClientContract = db.connection(),
    hasta?: string,
): Promise<Dec> {
    const fila = (await cliente
        .from('ledger.movimientos as m')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .where('m.proveedor_id', proveedorId)
        .where('c.codigo', CUENTAS_GT.PROVEEDORES)
        .if(hasta, (q) => q.where('a.fecha', '<=', hasta!))
        .select(cliente.raw('coalesce(sum(m.haber - m.debe), 0)::text as saldo'))
        .first()) as { saldo: string } | null
    return fila ? dec(fila.saldo) : CERO
}
