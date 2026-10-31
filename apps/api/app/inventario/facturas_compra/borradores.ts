import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import type { Confianza, ExtraccionCompra } from '#inventario/facturas_compra/extraccion'

/**
 * Borradores de compra (fase D, `contratos/inventario.md` D.5): lecturas, la propuesta de proveedor y
 * productos, y los duplicados. Nunca crean nada: la compra nace solo al confirmar.
 *
 * - **Proveedor**: por NIT (sin guiones ni mayúsculas) entre los proveedores activos de la empresa; si
 *   no está, se propone crearlo con el NIT y el nombre del emisor.
 * - **Productos**, por línea de bien: 1) el código del proveedor ya aprendido
 *   (`inventario.productos_codigos_proveedor`), 2) el código contra el SKU, 3) el nombre normalizado
 *   (minúsculas, sin tildes ni signos) igual al del producto. Sin coincidencia: se propone crear un
 *   producto `material` con un SKU sugerido. Una línea de servicio no lleva producto (va a gasto).
 */

export const ESTADOS_BORRADOR = ['borrador', 'confirmado', 'descartado'] as const
export type EstadoBorrador = (typeof ESTADOS_BORRADOR)[number]

export interface PropuestaLinea {
    indice: number
    /** código del proveedor, SKU o nombre; null sin coincidencia */
    coincidencia: 'codigo_proveedor' | 'sku' | 'nombre' | null
    producto_id: number | null
    producto_sku: string | null
    producto_nombre: string | null
    /** sin coincidencia: el producto que se propone crear */
    crear: { sku: string; nombre: string; tipo: string; unidad: string } | null
    /** servicio: va a gasto, sin producto */
    gasto: boolean
}

export interface Propuesta {
    proveedor: { id: number | null; nit: string; nombre: string; crear: boolean } | null
    lineas: PropuestaLinea[]
}

export interface BorradorVista {
    id: number
    empresa_id: number
    estado: EstadoBorrador
    fuente: 'xml_fel' | 'ia' | 'manual'
    archivo_tipo: string | null
    archivo_tamano: number | null
    archivo_nombre: string | null
    archivo_sha256: string | null
    extraccion: ExtraccionCompra | null
    confianza: Confianza | null
    error_extraccion: string | null
    ia_proveedor: string | null
    ia_modelo: string | null
    datos: Partial<ExtraccionCompra>
    propuesta: Propuesta
    emisor_nit: string | null
    serie: string | null
    numero: string | null
    compra_id: number | null
    motivo_descarte: string | null
    creado_por: number | null
    confirmado_por: number | null
    confirmado_en: Date | null
    version: number
    created_at: Date
    updated_at: Date
}

const COLUMNAS = [
    'id',
    'empresa_id',
    'estado',
    'fuente',
    'archivo_tipo',
    'archivo_tamano',
    'archivo_nombre',
    'archivo_sha256',
    'extraccion',
    'confianza',
    'error_extraccion',
    'ia_proveedor',
    'ia_modelo',
    'datos',
    'propuesta',
    'emisor_nit',
    'serie',
    'numero',
    'compra_id',
    'motivo_descarte',
    'creado_por',
    'confirmado_por',
    'confirmado_en',
    'version',
    'created_at',
    'updated_at',
]

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function normalizar(f: BorradorVista): BorradorVista {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        archivo_tamano: n(f.archivo_tamano),
        compra_id: n(f.compra_id),
        creado_por: n(f.creado_por),
        confirmado_por: n(f.confirmado_por),
        version: Number(f.version),
    }
}

export async function verBorrador(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await cliente
        .from('inventario.compras_borradores')
        .where('id', id)
        .select(COLUMNAS)
        .first()) as BorradorVista | null
    if (!fila) throw new NoEncontrado(`El borrador de compra ${id} no existe`)
    return normalizar(fila)
}

export async function empresaDeBorrador(id: number) {
    const fila = await db.from('inventario.compras_borradores').where('id', id).select('empresa_id').first()
    if (!fila) throw new NoEncontrado(`El borrador de compra ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id) }
}

export async function archivoDeBorrador(id: number) {
    const fila = (await db
        .from('inventario.compras_borradores')
        .where('id', id)
        .select('archivo_ruta', 'archivo_sha256', 'archivo_tipo', 'archivo_nombre')
        .first()) as {
        archivo_ruta: string | null
        archivo_sha256: string | null
        archivo_tipo: string | null
        archivo_nombre: string | null
    } | null
    if (!fila) throw new NoEncontrado(`El borrador de compra ${id} no existe`)
    return fila
}

export interface FiltrosBorradores extends OpcionesPaginacion {
    estado?: EstadoBorrador
}

export async function listarBorradores(filtros: FiltrosBorradores, empresas: number[] | null) {
    const q = db
        .from('inventario.compras_borradores')
        .select(COLUMNAS)
        .if(filtros.estado, (c) => c.where('estado', filtros.estado!))
    filtrarPorEmpresa(q, empresas, (c, ids) => c.whereIn('empresa_id', ids))
    const pagina = await paginar<BorradorVista>(q, filtros, { columna: 'id' })
    return { data: pagina.data.map(normalizar), nextCursor: pagina.nextCursor }
}

/** NIT sin guiones ni espacios, en mayúsculas (`CF` queda igual). */
export function nitLimpio(nit: string | null | undefined): string {
    return (nit ?? '').replaceAll(/[\s-]/g, '').toUpperCase()
}

/** Nombre normalizado para comparar: minúsculas, sin tildes ni signos, espacios simples. */
export function nombreNormalizado(nombre: string): string {
    return nombre
        .normalize('NFD')
        .replaceAll(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, ' ')
        .trim()
}

/**
 * 409 si la factura (NIT del emisor, serie y número, sin distinguir mayúsculas) ya está registrada
 * como compra de la empresa (`compra_duplicada`) o en otro borrador vivo (`borrador_duplicado`).
 */
export async function exigirFacturaNueva(
    cliente: QueryClientContract,
    empresaId: number,
    documento: { nit: string; serie: string | null; numero: string },
    exceptoBorrador?: number,
): Promise<void> {
    const nit = nitLimpio(documento.nit)
    const serie = (documento.serie ?? '').trim().toUpperCase()
    const numero = documento.numero.trim().toUpperCase()
    if (!nit || !numero) return
    const compra = await cliente
        .from('ledger.compras as c')
        .join('ledger.proveedores as p', 'p.id', 'c.proveedor_id')
        .where('c.empresa_id', empresaId)
        .whereRaw(`upper(replace(p.nit, '-', '')) = ?`, [nit])
        .whereRaw(`upper(coalesce(c.serie, '')) = ?`, [serie])
        .whereRaw('upper(c.numero) = ?', [numero])
        .select('c.id')
        .first()
    if (compra) {
        throw new Conflicto(
            `La factura ${serie ? `${serie}-` : ''}${numero} del NIT ${nit} ya está registrada (compra ${compra.id})`,
            'compra_duplicada',
            'Compra duplicada',
        )
    }
    const borrador = await cliente
        .from('inventario.compras_borradores')
        .where('empresa_id', empresaId)
        .whereIn('estado', ['borrador', 'confirmado'])
        .where('emisor_nit', nit)
        .whereRaw(`upper(coalesce(serie, '')) = ?`, [serie])
        .whereRaw('upper(numero) = ?', [numero])
        .if(exceptoBorrador !== undefined, (q) => q.whereNot('id', exceptoBorrador!))
        .select('id')
        .first()
    if (borrador) {
        throw new Conflicto(
            `La factura ${serie ? `${serie}-` : ''}${numero} del NIT ${nit} ya está en el borrador ${borrador.id}`,
            'borrador_duplicado',
            'Factura ya cargada',
        )
    }
}

function skuSugerido(linea: { codigo: string | null; descripcion: string }, usados: Set<string>): string {
    const base =
        (
            linea.codigo?.trim().toUpperCase() ||
            nombreNormalizado(linea.descripcion)
                .split(' ')
                .filter(Boolean)
                .slice(0, 3)
                .join('-')
                .toUpperCase()
        ).slice(0, 50) || 'PRODUCTO'
    let sku = base
    for (let k = 2; usados.has(sku.toUpperCase()); k++) sku = `${base}-${k}`
    usados.add(sku.toUpperCase())
    return sku
}

/** Propuesta de proveedor y productos para unos datos (sin escribir nada). */
export async function proponer(
    cliente: QueryClientContract,
    empresaId: number,
    datos: Partial<ExtraccionCompra>,
): Promise<Propuesta> {
    let proveedor: Propuesta['proveedor'] = null
    let proveedorId: number | null = null
    if (datos.emisor?.nit) {
        const nit = nitLimpio(datos.emisor.nit)
        const fila = await cliente
            .from('ledger.proveedores')
            .where({ empresa_id: empresaId, activo: true })
            .whereRaw(`upper(replace(nit, '-', '')) = ?`, [nit])
            .select('id', 'nombre')
            .first()
        proveedorId = fila ? Number(fila.id) : null
        proveedor = {
            id: proveedorId,
            nit,
            nombre: fila?.nombre ?? datos.emisor.nombre ?? nit,
            crear: !fila,
        }
    }
    const productos = (await cliente
        .from('inventario.productos')
        .where({ empresa_id: empresaId, activo: true })
        .select('id', 'sku', 'nombre')) as Array<{ id: number; sku: string; nombre: string }>
    const porSku = new Map(productos.map((p) => [p.sku.toUpperCase(), p]))
    const porNombre = new Map(productos.map((p) => [nombreNormalizado(p.nombre), p]))
    const codigos = proveedorId
        ? new Map(
              (
                  (await cliente
                      .from('inventario.productos_codigos_proveedor as c')
                      .join('inventario.productos as p', 'p.id', 'c.producto_id')
                      .where({ 'c.proveedor_id': proveedorId, 'p.activo': true })
                      .select('c.codigo', 'p.id', 'p.sku', 'p.nombre')) as Array<{
                      codigo: string
                      id: number
                      sku: string
                      nombre: string
                  }>
              ).map((c) => [c.codigo.toUpperCase(), c]),
          )
        : new Map<string, { id: number; sku: string; nombre: string }>()
    const usados = new Set(productos.map((p) => p.sku.toUpperCase()))
    const lineas: PropuestaLinea[] = (datos.lineas ?? []).map((l, indice) => {
        const vacia = {
            indice,
            coincidencia: null,
            producto_id: null,
            producto_sku: null,
            producto_nombre: null,
            crear: null,
            gasto: false,
        }
        if (l.bien_o_servicio === 'S') return { ...vacia, gasto: true }
        const codigo = l.codigo?.trim().toUpperCase() ?? ''
        const encontrado: [
            PropuestaLinea['coincidencia'],
            { id: number; sku: string; nombre: string } | undefined,
        ][] = [
            ['codigo_proveedor', codigo ? codigos.get(codigo) : undefined],
            ['sku', codigo ? porSku.get(codigo) : undefined],
            ['nombre', porNombre.get(nombreNormalizado(l.descripcion ?? ''))],
        ]
        const hallado = encontrado.find(([, p]) => p !== undefined)
        if (hallado) {
            const [coincidencia, p] = hallado
            return {
                ...vacia,
                coincidencia,
                producto_id: Number(p!.id),
                producto_sku: p!.sku,
                producto_nombre: p!.nombre,
            }
        }
        return {
            ...vacia,
            crear: {
                sku: skuSugerido({ codigo: l.codigo ?? null, descripcion: l.descripcion ?? '' }, usados),
                nombre: (l.descripcion ?? '').slice(0, 200),
                tipo: 'material',
                unidad: (l.unidad ?? 'unidad').toLowerCase().slice(0, 30) || 'unidad',
            },
        }
    })
    return { proveedor, lineas }
}
