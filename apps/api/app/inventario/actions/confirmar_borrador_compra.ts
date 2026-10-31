import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import {
    Conflicto,
    ConflictoVersion,
    NoEncontrado,
    ValidacionFallida,
    type ErrorCampo,
} from '#shared/errores'
import { dec } from '#ledger/dinero'
import type { LineaCompraEntrada, TipoDocumentoCompra } from '#ledger/compras'
import type { MetodoEgreso } from '#ledger/egresos'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import CrearProveedor, { type EntradaCrearProveedor } from '#ledger/actions/crear_proveedor'
import CrearProducto, { type EntradaCrearProducto } from '#inventario/actions/crear_producto'
import { extraccionValidator, type ExtraccionCompra } from '#inventario/facturas_compra/extraccion'
import {
    exigirFacturaNueva,
    nitLimpio,
    verBorrador,
    type BorradorVista,
} from '#inventario/facturas_compra/borradores'
import type { UnidadNueva } from '#inventario/unidades'

/**
 * `compras.confirmar_borrador` (`POST /compras/borradores/:id/confirmar`, fase D, `contratos/inventario.md`
 * D.5): con lo que el usuario revisó, crea la compra con `compras.registrar` (la de siempre: su asiento,
 * su IVA, su cuenta por pagar o su egreso y, en las líneas con producto, la entrada al kardex a 1.1.14),
 * en la misma transacción. Nunca sin esta confirmación explícita.
 *
 * - Proveedor: `{ id }` de la empresa o `{ crear }` (`proveedores.crear`; la ruta exige el permiso).
 * - Por línea de los datos (`indice`): `producto: { id } | { crear } | null`, `bodega_id`, `unidades`
 *   (serie), o `cuenta`/`categoria` para gasto. Una línea que no se indica va a gasto (servicio o bien sin
 *   producto, a la cuenta por defecto). Una línea con producto exige `bodega_id` y cantidad entera (422
 *   `cantidad_entera`, desvío A.3).
 * - La factura de otra empresa (NIT del receptor distinto del de la empresa): 422 `receptor_distinto`
 *   salvo `forzar_receptor`. La misma factura ya registrada: 409 `compra_duplicada`.
 * - Aprende el código del proveedor de cada producto (`inventario.productos_codigos_proveedor`).
 */

export interface LineaConfirmacion {
    indice: number
    producto?: { id?: number | null; crear?: Omit<EntradaCrearProducto, 'empresa_id'> | null } | null
    bodega_id?: number | null
    unidades?: UnidadNueva[] | null
    cuenta?: string | null
    categoria?: string | null
}

export interface EntradaConfirmarBorrador {
    id: number
    version: number
    proveedor: {
        id?: number | null
        crear?: (Omit<EntradaCrearProveedor, 'empresa_id' | 'nit'> & { nit?: string | null }) | null
    }
    condicion: 'contado' | 'credito'
    vence_en?: string | null
    metodo?: MetodoEgreso | null
    caja_id?: number | null
    banco_id?: number | null
    cuenta_bancaria_id?: number | null
    periodo_iva?: string | null
    credito_fiscal?: boolean | null
    forzar_receptor?: boolean | null
    lineas?: LineaConfirmacion[] | null
}

export default class ConfirmarBorradorCompra extends DomainAction<EntradaConfirmarBorrador, BorradorVista> {
    readonly nombre = 'compras.confirmar_borrador'

    protected async handle(input: EntradaConfirmarBorrador, t: Transaccion): Promise<BorradorVista> {
        t.fijarEntidad('borrador_compra', input.id)
        const fila = await t.trx
            .from('inventario.compras_borradores')
            .where('id', input.id)
            .forUpdate()
            .first()
        if (!fila) throw new NoEncontrado(`El borrador de compra ${input.id} no existe`)
        const empresaId = Number(fila.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (Number(fila.version) !== input.version) throw new ConflictoVersion('borrador_compra', input.id)
        if (fila.estado !== 'borrador') {
            throw new Conflicto(
                `El borrador ${input.id} está ${fila.estado}`,
                'borrador_cerrado',
                'Borrador cerrado',
            )
        }
        // los datos revisados tienen que estar completos
        let datos: ExtraccionCompra
        try {
            datos = (await extraccionValidator.validate(fila.datos ?? {})) as ExtraccionCompra
        } catch (error) {
            const mensajes =
                (error as { messages?: Array<{ field: string; message: string; rule: string }> }).messages ??
                []
            throw new ValidacionFallida(
                mensajes.map((m) => ({ field: `datos.${m.field}`, message: m.message, rule: m.rule })),
            )
        }
        const empresa = await t.trx.from('core.empresas').where('id', empresaId).select('nit').first()
        const receptor = nitLimpio(datos.receptor.nit)
        if (receptor && empresa?.nit && receptor !== nitLimpio(empresa.nit) && !input.forzar_receptor) {
            throw new ValidacionFallida([
                {
                    field: 'forzar_receptor',
                    message: `La factura es para el NIT ${receptor}, no para el de la empresa (${nitLimpio(empresa.nit)})`,
                    rule: 'receptor_distinto',
                },
            ])
        }
        await exigirFacturaNueva(
            t.trx,
            empresaId,
            { nit: datos.emisor.nit, serie: datos.serie, numero: datos.numero },
            input.id,
        )

        // proveedor
        let proveedorId: number
        if (input.proveedor.id) {
            const proveedor = await t.trx
                .from('ledger.proveedores')
                .where({ id: input.proveedor.id, empresa_id: empresaId })
                .select('id')
                .first()
            if (!proveedor) {
                throw new NoEncontrado(`El proveedor ${input.proveedor.id} no existe en esta empresa`)
            }
            proveedorId = Number(proveedor.id)
        } else if (input.proveedor.crear) {
            const creado = await new CrearProveedor().execute(
                {
                    ...input.proveedor.crear,
                    nit: input.proveedor.crear.nit ?? datos.emisor.nit,
                    empresa_id: empresaId,
                },
                t.ctx,
                { trx: t.trx },
            )
            proveedorId = Number(creado.id)
        } else {
            throw new ValidacionFallida([
                { field: 'proveedor', message: 'Indica el proveedor (id o crear)', rule: 'required' },
            ])
        }

        // líneas
        const errores: ErrorCampo[] = []
        const pedidas = new Map<number, LineaConfirmacion>()
        for (const [k, l] of (input.lineas ?? []).entries()) {
            if (l.indice < 0 || l.indice >= datos.lineas.length) {
                errores.push({
                    field: `lineas.${k}.indice`,
                    message: `La factura no tiene la línea ${l.indice}`,
                    rule: 'indice',
                })
            } else if (pedidas.has(l.indice)) {
                errores.push({
                    field: `lineas.${k}.indice`,
                    message: `La línea ${l.indice} está repetida`,
                    rule: 'repetido',
                })
            }
            pedidas.set(l.indice, l)
            if (l.producto && (l.producto.id ? 1 : 0) + (l.producto.crear ? 1 : 0) !== 1) {
                errores.push({
                    field: `lineas.${k}.producto`,
                    message: 'producto: id o crear (uno)',
                    rule: 'producto',
                })
            }
            if (l.producto && !l.bodega_id) {
                errores.push({
                    field: `lineas.${k}.bodega_id`,
                    message: 'Una línea con producto entra a una bodega',
                    rule: 'required',
                })
            }
            const cantidad = datos.lineas[l.indice]?.cantidad
            if (l.producto && cantidad && !dec(cantidad).isInteger()) {
                errores.push({
                    field: `lineas.${k}.producto`,
                    message: `La línea ${l.indice} tiene cantidad ${cantidad}: una compra a inventario va en unidades enteras (corrige la unidad o déjala a gasto)`,
                    rule: 'cantidad_entera',
                })
            }
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const lineas: LineaCompraEntrada[] = []
        const aprendidos: Array<{ codigo: string; producto_id: number }> = []
        for (const [indice, extraida] of datos.lineas.entries()) {
            const pedida = pedidas.get(indice)
            let productoId: number | null = null
            if (pedida?.producto?.id) {
                productoId = pedida.producto.id
            } else if (pedida?.producto?.crear) {
                const creado = await new CrearProducto().execute(
                    { ...pedida.producto.crear, empresa_id: empresaId },
                    t.ctx,
                    { trx: t.trx },
                )
                productoId = creado.id
            }
            if (productoId && extraida.codigo) {
                aprendidos.push({ codigo: extraida.codigo, producto_id: productoId })
            }
            const total = dec(extraida.total)
            lineas.push({
                descripcion: extraida.descripcion,
                tipo: extraida.bien_o_servicio === 'S' ? 'servicio' : 'bien',
                total: total.toFixed(2),
                cantidad: dec(extraida.cantidad).isInteger() ? Number(dec(extraida.cantidad).toFixed(0)) : 1,
                iva: extraida.iva,
                ...(productoId
                    ? {
                          producto_id: productoId,
                          bodega_id: pedida!.bodega_id!,
                          ...(pedida?.unidades ? { unidades: pedida.unidades } : {}),
                      }
                    : {
                          ...(pedida?.cuenta ? { cuenta: pedida.cuenta } : {}),
                          ...(pedida?.categoria ? { categoria: pedida.categoria } : {}),
                      }),
            })
        }
        const compra = await new RegistrarCompra().execute(
            {
                empresa_id: empresaId,
                proveedor_id: proveedorId,
                tipo_documento: datos.tipo_documento as TipoDocumentoCompra,
                serie: datos.serie,
                numero: datos.numero,
                autorizacion: datos.autorizacion,
                fecha_documento: datos.fecha,
                periodo_iva: input.periodo_iva ?? null,
                credito_fiscal: input.credito_fiscal ?? null,
                descripcion: `Factura cargada en el borrador ${input.id}`,
                condicion: input.condicion,
                vence_en: input.vence_en ?? null,
                metodo: input.metodo ?? null,
                caja_id: input.caja_id ?? null,
                banco_id: input.banco_id ?? null,
                cuenta_bancaria_id: input.cuenta_bancaria_id ?? null,
                lineas,
            },
            t.ctx,
            { trx: t.trx },
        )
        for (const a of aprendidos) {
            await t.trx.rawQuery(
                `INSERT INTO inventario.productos_codigos_proveedor (empresa_id, proveedor_id, codigo, producto_id)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT (proveedor_id, upper(codigo)) DO UPDATE SET producto_id = EXCLUDED.producto_id, updated_at = now()`,
                [empresaId, proveedorId, a.codigo.trim(), a.producto_id],
            )
        }
        await t.trx
            .from('inventario.compras_borradores')
            .where('id', input.id)
            .update({
                estado: 'confirmado',
                compra_id: compra.id,
                confirmado_por: usuarioDelActor(t.ctx.actor),
                confirmado_en: t.trx.knexRawQuery('now()'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        await t.registrarCambios(
            { tipo: 'borrador_compra', id: input.id },
            { estado: 'borrador', compra_id: null },
            { estado: 'confirmado', compra_id: compra.id },
        )
        return verBorrador(input.id, t.trx)
    }
}
