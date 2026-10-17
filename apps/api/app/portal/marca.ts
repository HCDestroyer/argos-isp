import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { EMPRESA_PRINCIPAL } from '#core/empresas'
import { empresaPorDefecto } from '#portal/empresa'

/**
 * Marca de la empresa que factura (multiempresa, `contratos/multiempresa.md` § Marca): el portal
 * muestra el logo, el nombre comercial, el NIT, la dirección fiscal y el contacto de soporte de la
 * empresa **del servicio** (o de la factura), nunca la de otra.
 *
 * - `/corte` por IP: la empresa del servicio de esa IP (`QuienSoy.empresa`).
 * - Con sesión: cada servicio y cada factura llevan la suya; la *principal* del cliente (título,
 *   encabezado de `/cuenta` y manifiesto PWA) es la que tiene más servicios sin retirar y, a
 *   igualdad, la del servicio más antiguo. Un cliente sin servicios queda con la principal (1).
 *
 * La empresa 1 sin guardar (`version = 0`) usa los valores por defecto del entorno, como siempre.
 */

/** Espejo del schema `PortalMarcaEmpresa` (`app/portal/esquemas.ts`). */
export interface MarcaEmpresa {
    id: number
    nombre_comercial: string
    /** `/api/v1/portal/empresas/:id/logo?v=<etag>` (mismo origen del portal); null sin logo */
    logo_url: string | null
    nit: string | null
    direccion_fiscal: string | null
    telefono: string | null
    whatsapp: string | null
}

/**
 * URL del logo **por el portal** (`GET /portal/empresas/:id/logo`): el navegador del cliente
 * suspendido solo alcanza `/api/v1/portal/**` (walled garden). Lleva el ETag para que un logo nuevo
 * no quede en la caché.
 */
export function urlLogoPortal(id: number, etag: string | null): string | null {
    return etag ? `/api/v1/portal/empresas/${id}/logo?v=${etag.slice(0, 16)}` : null
}

interface FilaMarca {
    id: number
    version: number
    nombre_comercial: string
    nit: string | null
    direccion_fiscal: string | null
    telefono: string | null
    whatsapp: string | null
    logo_etag: string | null
}

function aMarca(fila: FilaMarca): MarcaEmpresa {
    const id = Number(fila.id)
    const logo = urlLogoPortal(id, fila.logo_etag)
    if (Number(fila.version) === 0) {
        // La empresa 1 nunca se guardó: nombre y teléfono del entorno, lo demás vacío.
        const defecto = empresaPorDefecto()
        return {
            id,
            nombre_comercial: defecto.nombre,
            logo_url: logo,
            nit: null,
            direccion_fiscal: null,
            telefono: defecto.telefono,
            whatsapp: null,
        }
    }
    return {
        id,
        nombre_comercial: fila.nombre_comercial,
        logo_url: logo,
        nit: fila.nit,
        direccion_fiscal: fila.direccion_fiscal,
        telefono: fila.telefono,
        whatsapp: fila.whatsapp,
    }
}

/** Marcas de varias empresas en una consulta. Las que no existen no aparecen en el mapa. */
export async function marcasDeEmpresas(
    ids: Iterable<number>,
    cliente: QueryClientContract = db.connection(),
): Promise<Map<number, MarcaEmpresa>> {
    const unicos = [...new Set([...ids].map(Number))]
    if (unicos.length === 0) return new Map()
    const filas = (await cliente
        .from('core.empresas')
        .whereIn('id', unicos)
        .select(
            'id',
            'version',
            'nombre_comercial',
            'nit',
            'direccion_fiscal',
            'telefono',
            'whatsapp',
            'logo_etag',
        )) as FilaMarca[]
    return new Map(filas.map((fila) => [Number(fila.id), aMarca(fila)]))
}

/** Marca de una empresa; una que no existe cae en la principal (nunca deja la pantalla sin marca). */
export async function marcaDeEmpresa(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<MarcaEmpresa> {
    const marcas = await marcasDeEmpresas([empresaId, EMPRESA_PRINCIPAL], cliente)
    return marcas.get(empresaId) ?? marcas.get(EMPRESA_PRINCIPAL)!
}

/**
 * Empresa principal del cliente: la que tiene más servicios sin retirar; a igualdad, la de su
 * servicio más antiguo. Sin servicios, la principal de la instalación.
 */
export async function empresaPrincipalDelCliente(
    clienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<number> {
    const fila = (await cliente
        .from('core.servicios')
        .where('cliente_id', clienteId)
        .groupBy('empresa_id')
        .select('empresa_id')
        .orderByRaw(`count(*) FILTER (WHERE estado <> 'retirado') DESC, min(id) ASC`)
        .first()) as { empresa_id: number } | null
    return fila ? Number(fila.empresa_id) : EMPRESA_PRINCIPAL
}

/** Empresa de un servicio (null si no existe). */
export async function empresaDelServicio(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<number | null> {
    const fila = (await cliente
        .from('core.servicios')
        .where('id', servicioId)
        .select('empresa_id')
        .first()) as {
        empresa_id: number
    } | null
    return fila ? Number(fila.empresa_id) : null
}

/**
 * Empresa de una factura, como expresión SQL sobre `billing.facturas as f` unida (left join) con
 * `core.servicios as s`.
 *
 * **Punto de cambio (multiempresa, A3):** cuando exista `billing.facturas.empresa_id`, cambiar a
 * `coalesce(f.empresa_id, s.empresa_id, 1)`: la empresa que emitió la factura manda sobre la del
 * servicio (un servicio puede cambiar de empresa sin saldo; sus facturas viejas siguen siendo de la
 * anterior). Mientras, la del servicio; sin servicio (mora suelta), la principal.
 */
export const SQL_EMPRESA_FACTURA = 'coalesce(s.empresa_id, 1)'
