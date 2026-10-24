import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { CLAVES_CLASE_ACTIVO } from '#ledger/compras'
import { aTexto, dec } from '#ledger/dinero'
import {
    CLASE_ACTIVO_POR_DEFECTO,
    problemaCuentaProducto,
    verProducto,
    type ProductoVista,
    type Seguimiento,
    type TipoProducto,
} from '#inventario/productos'

/**
 * `productos.crear` (`POST /productos`): un producto de la empresa activa (o de `empresa_id`).
 *
 * - `sku` único por empresa sin distinguir mayúsculas (409 `sku_duplicado`).
 * - `seguimiento`: `cantidad` o `serie`; `clase_activo` solo para `serie` (por defecto
 *   `equipo_red`). Los de serie se crean ya, pero no se mueven hasta la fase B (`unidades`).
 * - `cuenta_costo` y `cuenta_consumo`: códigos de gasto (por defecto `5.6.01` y `5.2.07`).
 * - `concepto_cargo_id`: concepto de cargo único de la misma empresa.
 * - `precio_venta`: precio sugerido del cargo único, IVA incluido (opcional, pedido de A4).
 */

export interface DatosProducto {
    sku?: string | null
    nombre?: string | null
    unidad?: string | null
    tipo?: TipoProducto | null
    seguimiento?: Seguimiento | null
    clase_activo?: string | null
    concepto_cargo_id?: number | null
    cuenta_costo?: string | null
    cuenta_consumo?: string | null
    existencia_minima?: string | null
    /** precio de venta sugerido para el cargo único, IVA incluido (2 decimales) */
    precio_venta?: string | null
}

export interface EntradaCrearProducto extends DatosProducto {
    empresa_id?: number | null
    sku: string
    nombre: string
    tipo: TipoProducto
    seguimiento: Seguimiento
}

/** Valida las reglas comunes del alta y la edición (errores 422 de campo). */
export async function validarDatosProducto(
    t: Transaccion,
    empresaId: number,
    datos: Required<Pick<DatosProducto, 'seguimiento' | 'clase_activo'>> & DatosProducto,
): Promise<void> {
    const errores: ErrorCampo[] = []
    if (datos.clase_activo) {
        if (datos.seguimiento !== 'serie') {
            errores.push({
                field: 'clase_activo',
                message: 'La clase de activo solo aplica a productos con seguimiento por serie',
                rule: 'no_aplica',
            })
        } else if (!(CLAVES_CLASE_ACTIVO as string[]).includes(datos.clase_activo)) {
            errores.push({
                field: 'clase_activo',
                message: `Clase de activo inválida (${CLAVES_CLASE_ACTIVO.join(', ')})`,
                rule: 'clase_activo',
            })
        }
    }
    for (const campo of ['cuenta_costo', 'cuenta_consumo'] as const) {
        const codigo = datos[campo]
        if (!codigo) continue
        const problema = await problemaCuentaProducto(t.trx, codigo, empresaId, campo)
        if (problema) errores.push(problema)
    }
    if (datos.concepto_cargo_id) {
        const concepto = await t.trx
            .from('billing.conceptos_cargo')
            .where({ id: datos.concepto_cargo_id, empresa_id: empresaId })
            .select('id')
            .first()
        if (!concepto) {
            errores.push({
                field: 'concepto_cargo_id',
                message: `El concepto de cargo ${datos.concepto_cargo_id} no es de esta empresa`,
                rule: 'exists',
            })
        }
    }
    if (datos.existencia_minima !== undefined && datos.existencia_minima !== null) {
        const minimo = dec(datos.existencia_minima)
        if (minimo.lt(0) || minimo.decimalPlaces() > 3) {
            errores.push({
                field: 'existencia_minima',
                message: 'La existencia mínima es >= 0 con hasta 3 decimales',
                rule: 'cantidad',
            })
        }
    }
    if (datos.precio_venta !== undefined && datos.precio_venta !== null) {
        const precio = dec(datos.precio_venta)
        if (precio.isNegative() || precio.decimalPlaces() > 2) {
            errores.push({
                field: 'precio_venta',
                message: 'El precio de venta es >= 0 con hasta 2 decimales',
                rule: 'monto',
            })
        }
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
}

/** 409 `sku_duplicado` si otro producto de la empresa tiene el SKU. */
export async function exigirSkuLibre(t: Transaccion, empresaId: number, sku: string, excepto?: number) {
    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, hashtext(?))', [
        3061,
        `${empresaId}:${sku.toUpperCase()}`,
    ])
    const repetido = await t.trx
        .from('inventario.productos')
        .where('empresa_id', empresaId)
        .whereRaw('upper(sku) = upper(?)', [sku])
        .if(excepto !== undefined, (q) => q.whereNot('id', excepto!))
        .select('id')
        .first()
    if (repetido) {
        throw new Conflicto(
            `La empresa ya tiene el producto ${repetido.id} con el SKU ${sku}`,
            'sku_duplicado',
            'SKU duplicado',
        )
    }
}

export default class CrearProducto extends DomainAction<EntradaCrearProducto, ProductoVista> {
    readonly nombre = 'productos.crear'

    protected async handle(input: EntradaCrearProducto, t: Transaccion): Promise<ProductoVista> {
        let empresaId: number
        if (input.empresa_id) {
            await exigirEmpresaActiva(t.trx, input.empresa_id)
            empresaId = input.empresa_id
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const sku = input.sku.trim()
        const claseActivo =
            input.seguimiento === 'serie'
                ? (input.clase_activo ?? CLASE_ACTIVO_POR_DEFECTO)
                : (input.clase_activo ?? null)
        await validarDatosProducto(t, empresaId, { ...input, clase_activo: claseActivo })
        await exigirSkuLibre(t, empresaId, sku)

        const [fila] = (await t.trx
            .insertQuery()
            .table('inventario.productos')
            .insert({
                empresa_id: empresaId,
                sku,
                nombre: input.nombre.trim(),
                unidad: input.unidad?.trim() || 'unidad',
                tipo: input.tipo,
                seguimiento: input.seguimiento,
                clase_activo: claseActivo,
                concepto_cargo_id: input.concepto_cargo_id ?? null,
                cuenta_costo: input.cuenta_costo?.trim() || null,
                cuenta_consumo: input.cuenta_consumo?.trim() || null,
                existencia_minima: input.existencia_minima ?? null,
                precio_venta: input.precio_venta ? aTexto(dec(input.precio_venta)) : null,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('producto', id)
        const producto = await verProducto(id, t.trx)
        await t.registrarCambios({ tipo: 'producto', id }, null, {
            sku: producto.sku,
            nombre: producto.nombre,
            unidad: producto.unidad,
            tipo: producto.tipo,
            seguimiento: producto.seguimiento,
            clase_activo: producto.clase_activo,
            concepto_cargo_id: producto.concepto_cargo_id,
            cuenta_costo: producto.cuenta_costo,
            cuenta_consumo: producto.cuenta_consumo,
            existencia_minima: producto.existencia_minima,
            precio_venta: producto.precio_venta,
            activo: producto.activo,
        })
        return producto
    }
}
