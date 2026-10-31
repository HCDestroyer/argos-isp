import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ConflictoVersion, NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { aTexto, dec } from '#ledger/dinero'
import { verProducto, type ProductoVista, type Seguimiento } from '#inventario/productos'
import {
    modalidadPorDefecto,
    problemaModalidad,
    resolverTipo,
    type Modalidad,
} from '#inventario/tipos_producto'
import { exigirSkuLibre, validarDatosProducto, type DatosProducto } from '#inventario/actions/crear_producto'

/**
 * `productos.editar` (`POST /productos/:id/editar`): datos del producto con `version` (409 si cambió)
 * y `audit.cambios`. `seguimiento` no cambia si el producto ya tiene movimientos (409
 * `producto_con_movimientos`). `null` limpia los opcionales (clase de activo, concepto, cuentas,
 * mínimo, precio de venta). Para desactivar: `productos.desactivar`.
 */

export interface EntradaEditarProducto extends DatosProducto {
    id: number
    version: number
}

const EDITABLES = [
    'sku',
    'nombre',
    'unidad',
    'tipo',
    'seguimiento',
    'modalidad',
    'clase_activo',
    'concepto_cargo_id',
    'cuenta_costo',
    'cuenta_consumo',
    'existencia_minima',
    'precio_venta',
] as const
const OPCIONALES = new Set<string>([
    'clase_activo',
    'concepto_cargo_id',
    'cuenta_costo',
    'cuenta_consumo',
    'existencia_minima',
    'precio_venta',
])

export default class EditarProducto extends DomainAction<EntradaEditarProducto, ProductoVista> {
    readonly nombre = 'productos.editar'

    protected async handle(input: EntradaEditarProducto, t: Transaccion): Promise<ProductoVista> {
        t.fijarEntidad('producto', input.id)
        const actual = (await t.trx
            .from('inventario.productos')
            .where('id', input.id)
            .forUpdate()
            .select(
                '*',
                t.trx.raw('existencia_minima::text as existencia_minima'),
                t.trx.raw('precio_venta::text as precio_venta'),
            )
            .first()) as Record<string, unknown> | null
        if (!actual) throw new NoEncontrado(`El producto ${input.id} no existe`)
        const empresaId = Number(actual.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (Number(actual.version) !== input.version) throw new ConflictoVersion('producto', input.id)

        const antes: Record<string, unknown> = Object.fromEntries(
            EDITABLES.map((c) => [c, actual[c] === undefined ? null : actual[c]]),
        )
        if (antes.concepto_cargo_id !== null) antes.concepto_cargo_id = Number(antes.concepto_cargo_id)
        const nuevo: Record<string, unknown> = { ...antes }
        for (const campo of EDITABLES) {
            const valor = input[campo]
            if (valor === undefined) continue
            if (valor === null) {
                if (OPCIONALES.has(campo)) nuevo[campo] = null
                continue
            }
            nuevo[campo] = typeof valor === 'string' ? valor.trim() || null : valor
        }
        if (typeof nuevo.precio_venta === 'string' && nuevo.precio_venta !== antes.precio_venta) {
            const precio = dec(nuevo.precio_venta)
            if (!precio.isNegative() && precio.decimalPlaces() <= 2) nuevo.precio_venta = aTexto(precio)
        }
        // tipo: el código del catálogo (de la empresa o global, activo)
        let tipoId = Number(actual.tipo_id)
        if (
            input.tipo !== undefined &&
            input.tipo !== null &&
            input.tipo.trim().toLowerCase() !== antes.tipo
        ) {
            const tipo = await resolverTipo(t, empresaId, input.tipo)
            nuevo.tipo = tipo.codigo
            tipoId = tipo.id
        }
        // un cambio de seguimiento sin modalidad explícita deja la del nuevo seguimiento si la de antes no va
        if (
            (input.modalidad === undefined || input.modalidad === null) &&
            problemaModalidad(nuevo.modalidad as Modalidad, nuevo.seguimiento as Seguimiento)
        ) {
            nuevo.modalidad = modalidadPorDefecto(nuevo.seguimiento as Seguimiento)
        }
        if (nuevo.seguimiento === 'cantidad') nuevo.clase_activo = null
        if (nuevo.seguimiento === 'serie' && !nuevo.clase_activo) nuevo.clase_activo = 'equipo_red'
        if (nuevo.seguimiento !== antes.seguimiento) {
            const movimiento = await t.trx
                .from('inventario.movimientos')
                .where('producto_id', input.id)
                .select('id')
                .first()
            if (movimiento) {
                throw new Conflicto(
                    `El producto ${String(actual.sku)} ya tiene movimientos: su seguimiento no cambia`,
                    'producto_con_movimientos',
                    'Producto con movimientos',
                )
            }
        }
        await validarDatosProducto(t, empresaId, {
            ...(nuevo as DatosProducto),
            seguimiento: nuevo.seguimiento as 'cantidad' | 'serie',
            clase_activo: (nuevo.clase_activo as string | null) ?? null,
        })
        if (String(nuevo.sku).toUpperCase() !== String(antes.sku).toUpperCase()) {
            await exigirSkuLibre(t, empresaId, String(nuevo.sku), input.id)
        }

        await t.trx
            .from('inventario.productos')
            .where('id', input.id)
            .update({
                ...nuevo,
                tipo_id: tipoId,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const producto = await verProducto(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'producto', id: input.id },
            antes,
            Object.fromEntries(EDITABLES.map((c) => [c, producto[c]])),
        )
        return producto
    }
}
