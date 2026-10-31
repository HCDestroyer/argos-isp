import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Conflicto, ConflictoVersion, NoEncontrado, Prohibido, ValidacionFallida } from '#shared/errores'
import { aTexto, dec, redondear } from '#ledger/dinero'
import { aCantidad, bloquearProducto, bodegaMovible, productoMovible } from '#inventario/kardex'
import { moverDeOrden } from '#inventario/actions/crear_traslado'
import {
    configuracionInventario,
    verOrdenTraslado,
    type MetodoRecepcion,
    type OrdenTrasladoDetalle,
} from '#inventario/ordenes_traslado'
import {
    ArchivoAdjunto,
    borrarArchivoInventario,
    guardarArchivoInventario,
    validarFirma,
} from '#inventario/archivos'
import { resolverTecnico, type TecnicoExterno } from '#inventario/tecnicos'

/**
 * `inventario.recibir_traslado` (`POST /inventario/traslados/:id/recibir`, fase D,
 * `contratos/inventario.md` D.1). Decisión del PM: recibe quien recibe.
 *
 * - **Quién.** Si el destino es la bodega de un técnico: el técnico (el actor es su usuario) o un
 *   usuario con alcance global (`registro_global`, lo pone la ruta: encargado o el usuario técnico
 *   «Iris») que registra en nombre del técnico. Si es una bodega: quien la puede operar (la ruta).
 *   `recibido_por` = el técnico (o, en una bodega, el actor o el indicado); `registrado_por` = el actor.
 * - **Método.** `firma_digital` (PNG del trazo; obligatorio), `firma_papel` (solo un registro global
 *   en nombre del técnico, sin firma; el escaneo se adjunta después) o `aceptacion_sistema` (sin firma,
 *   solo si `traslado_firma_obligatoria` es false para la empresa). La firma se guarda en el almacén
 *   con SHA-256, quién firmó, la fecha y la IP; en la auditoría va solo su huella.
 * - **Faltantes.** Por línea (`cantidad_recibida`) o por serie (`unidad_ids_faltantes`): lo recibido
 *   pasa de tránsito al destino y lo faltante vuelve al origen al costo de la línea (sin asiento; la
 *   pérdida, si se confirma, la registra contabilidad con una baja). La orden queda `recibida` o
 *   `recibida_con_diferencias`. Emite `inventario.traslado_recibido`.
 */

export interface LineaRecepcion {
    linea_id: number
    cantidad_recibida?: string | null
    unidad_ids_faltantes?: number[] | null
}

export interface EntradaRecibirTraslado {
    id: number
    version?: number | null
    metodo_recepcion?: MetodoRecepcion | null
    recibido_por?: TecnicoExterno | null
    observaciones?: string | null
    lineas?: LineaRecepcion[] | null
    /** PNG del trazo (la ruta lo arma desde base64 o el archivo) */
    firma?: ArchivoAdjunto | null
    /** IP de la petición (la pone la ruta) */
    firma_ip?: string | null
    /** el actor tiene el permiso con alcance global (la pone la ruta) */
    registro_global?: boolean
}

interface OrdenFila {
    id: number
    empresa_id: number
    numero: number
    estado: string
    bodega_origen_id: number
    bodega_destino_id: number
    bodega_transito_id: number
    version: number
}

export default class RecibirTraslado extends DomainAction<EntradaRecibirTraslado, OrdenTrasladoDetalle> {
    readonly nombre = 'inventario.recibir_traslado'

    protected async handle(input: EntradaRecibirTraslado, t: Transaccion): Promise<OrdenTrasladoDetalle> {
        t.fijarEntidad('orden_traslado', input.id)
        const orden = (await t.trx
            .from('inventario.ordenes_traslado')
            .where('id', input.id)
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'numero',
                'estado',
                'bodega_origen_id',
                'bodega_destino_id',
                'bodega_transito_id',
                'version',
            )
            .first()) as OrdenFila | null
        if (!orden) throw new NoEncontrado(`La orden de traslado ${input.id} no existe`)
        const empresaId = Number(orden.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (
            input.version !== undefined &&
            input.version !== null &&
            Number(orden.version) !== input.version
        ) {
            throw new ConflictoVersion('orden_traslado', input.id)
        }
        if (orden.estado !== 'en_transito') {
            throw new Conflicto(
                `La orden de traslado ${orden.numero} está ${orden.estado.replaceAll('_', ' ')}`,
                'orden_no_en_transito',
                'Orden no en tránsito',
            )
        }
        const destino = await bodegaMovible(t, Number(orden.bodega_destino_id), empresaId, {
            campo: 'bodega_destino_id',
            entrada: true,
        })
        const actor = usuarioDelActor(t.ctx.actor)
        const global = input.registro_global === true

        // quién recibe
        let recibidoPor: number | null
        if (destino.tipo === 'tecnico') {
            recibidoPor = destino.usuario_id
            if (input.recibido_por) {
                const indicado = await resolverTecnico(t, input.recibido_por, 'recibido_por')
                if (indicado !== destino.usuario_id) {
                    throw new ValidacionFallida([
                        {
                            field: 'recibido_por',
                            message: 'Quien recibe es el técnico de la bodega destino',
                            rule: 'no_es_el_tecnico',
                        },
                    ])
                }
            }
            if (actor !== destino.usuario_id && !global) {
                throw new Prohibido(
                    `La orden ${orden.numero} va a la bodega de otro técnico: la recibe él o un usuario con alcance global`,
                )
            }
        } else {
            recibidoPor = input.recibido_por
                ? await resolverTecnico(t, input.recibido_por, 'recibido_por')
                : actor
        }

        // método y firma
        const metodo: MetodoRecepcion =
            input.metodo_recepcion ?? (input.firma ? 'firma_digital' : 'aceptacion_sistema')
        if (metodo === 'firma_digital') {
            if (!input.firma) {
                throw new ValidacionFallida([
                    {
                        field: 'firma',
                        message: 'La firma digital lleva la imagen del trazo',
                        rule: 'required',
                    },
                ])
            }
            validarFirma(input.firma)
        } else if (input.firma) {
            throw new ValidacionFallida([
                { field: 'firma', message: `Con ${metodo} no va firma digital`, rule: 'no_aplica' },
            ])
        }
        if (
            metodo === 'firma_papel' &&
            destino.tipo === 'tecnico' &&
            (actor === destino.usuario_id || !global)
        ) {
            throw new Prohibido(
                'La firma en papel la registra un encargado con alcance global en nombre del técnico',
            )
        }
        if (metodo === 'aceptacion_sistema') {
            const config = await configuracionInventario(empresaId, t.trx)
            if (config.traslado_firma_obligatoria) {
                throw new ValidacionFallida([
                    {
                        field: 'firma',
                        message: 'La empresa exige la firma de quien recibe (firma_digital o firma_papel)',
                        rule: 'required',
                    },
                ])
            }
        }

        // líneas
        const lineas = (await t.trx
            .from('inventario.ordenes_traslado_lineas')
            .where('orden_id', orden.id)
            .orderBy('id')
            .select('id', 'producto_id', 'cantidad', 'costo_total')) as Array<{
            id: number
            producto_id: number
            cantidad: string
            costo_total: string
        }>
        const unidades = (await t.trx
            .from('inventario.ordenes_traslado_unidades as x')
            .join('inventario.ordenes_traslado_lineas as l', 'l.id', 'x.linea_id')
            .where('l.orden_id', orden.id)
            .orderBy('x.id')
            .select('x.id', 'x.linea_id', 'x.unidad_id', 'x.costo')) as Array<{
            id: number
            linea_id: number
            unidad_id: number
            costo: string
        }>
        const pedidas = input.lineas ?? []
        const errores: Array<{ field: string; message: string; rule: string }> = []
        for (const [i, p] of pedidas.entries()) {
            const linea = lineas.find((l) => Number(l.id) === p.linea_id)
            if (!linea) {
                errores.push({
                    field: `lineas.${i}.linea_id`,
                    message: `La línea ${p.linea_id} no es de la orden`,
                    rule: 'linea',
                })
                continue
            }
            if (pedidas.findIndex((x) => x.linea_id === p.linea_id) !== i) {
                errores.push({ field: `lineas.${i}.linea_id`, message: 'Línea repetida', rule: 'repetido' })
            }
            const deLinea = unidades.filter((u) => Number(u.linea_id) === Number(linea.id))
            if (deLinea.length > 0) {
                if (p.cantidad_recibida !== undefined && p.cantidad_recibida !== null) {
                    errores.push({
                        field: `lineas.${i}.cantidad_recibida`,
                        message: 'Una línea de serie marca sus faltantes con unidad_ids_faltantes',
                        rule: 'no_aplica',
                    })
                }
                for (const id of p.unidad_ids_faltantes ?? []) {
                    if (!deLinea.some((u) => Number(u.unidad_id) === id)) {
                        errores.push({
                            field: `lineas.${i}.unidad_ids_faltantes`,
                            message: `La unidad ${id} no viaja en esta línea`,
                            rule: 'unidad_ids_faltantes',
                        })
                    }
                }
            } else {
                if ((p.unidad_ids_faltantes ?? []).length > 0) {
                    errores.push({
                        field: `lineas.${i}.unidad_ids_faltantes`,
                        message: 'Una línea por cantidad marca su faltante con cantidad_recibida',
                        rule: 'no_aplica',
                    })
                }
                if (p.cantidad_recibida !== undefined && p.cantidad_recibida !== null) {
                    const recibida = dec(p.cantidad_recibida)
                    if (recibida.lt(0) || recibida.gt(dec(linea.cantidad)) || recibida.decimalPlaces() > 3) {
                        errores.push({
                            field: `lineas.${i}.cantidad_recibida`,
                            message: `Lo recibido va de 0 a ${aCantidad(dec(linea.cantidad))}`,
                            rule: 'cantidad',
                        })
                    }
                }
            }
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const productos = [...new Set(lineas.map((l) => Number(l.producto_id)))].sort((a, b) => a - b)
        for (const id of productos) await bloquearProducto(t, id)
        const origenId = Number(orden.bodega_origen_id)
        const transitoId = Number(orden.bodega_transito_id)
        const faltantes: Array<{ producto_id: number; cantidad: string; unidad_ids: number[] }> = []
        for (const linea of lineas) {
            const producto = await productoMovible(t, Number(linea.producto_id), { empresaId })
            const pedido = pedidas.find((p) => p.linea_id === Number(linea.id))
            const deLinea = unidades.filter((u) => Number(u.linea_id) === Number(linea.id))
            if (deLinea.length > 0) {
                const faltan = new Set(pedido?.unidad_ids_faltantes ?? [])
                const llegan = deLinea.filter((u) => !faltan.has(Number(u.unidad_id)))
                const vuelven = deLinea.filter((u) => faltan.has(Number(u.unidad_id)))
                const mover = async (grupo: typeof deLinea, hacia: number) => {
                    if (grupo.length === 0) return
                    await moverDeOrden(t, {
                        empresaId,
                        ordenId: orden.id,
                        producto,
                        desde: transitoId,
                        hacia,
                        unidades: grupo.map((u) => ({ id: Number(u.unidad_id), costo: dec(u.costo) })),
                        motivo:
                            hacia === origenId ? `Faltante de la orden de traslado ${orden.numero}` : null,
                    })
                }
                await mover(llegan, destino.id)
                await mover(vuelven, origenId)
                for (const u of deLinea) {
                    await t.trx
                        .from('inventario.ordenes_traslado_unidades')
                        .where('id', u.id)
                        .update({ recibida: !faltan.has(Number(u.unidad_id)) })
                }
                const costoRecibido = llegan.reduce((s, u) => s.plus(dec(u.costo)), dec('0'))
                await t.trx
                    .from('inventario.ordenes_traslado_lineas')
                    .where('id', linea.id)
                    .update({
                        cantidad_recibida: aCantidad(dec(String(llegan.length))),
                        costo_recibido: aTexto(costoRecibido),
                    })
                if (vuelven.length > 0) {
                    faltantes.push({
                        producto_id: producto.id,
                        cantidad: aCantidad(dec(String(vuelven.length))),
                        unidad_ids: vuelven.map((u) => Number(u.unidad_id)),
                    })
                }
            } else {
                const cantidad = dec(linea.cantidad)
                const costo = dec(linea.costo_total)
                const recibida =
                    pedido?.cantidad_recibida !== undefined && pedido?.cantidad_recibida !== null
                        ? dec(pedido.cantidad_recibida)
                        : cantidad
                // lo recibido a su parte del costo de la línea; el faltante lleva el resto (exacto)
                const costoRecibido = recibida.eq(cantidad)
                    ? costo
                    : redondear(recibida.times(costo).div(cantidad))
                const falta = cantidad.minus(recibida)
                if (recibida.gt(0)) {
                    await moverDeOrden(t, {
                        empresaId,
                        ordenId: orden.id,
                        producto,
                        desde: transitoId,
                        hacia: destino.id,
                        cantidad: recibida,
                        costo: costoRecibido,
                    })
                }
                if (falta.gt(0)) {
                    await moverDeOrden(t, {
                        empresaId,
                        ordenId: orden.id,
                        producto,
                        desde: transitoId,
                        hacia: origenId,
                        cantidad: falta,
                        costo: costo.minus(costoRecibido),
                        motivo: `Faltante de la orden de traslado ${orden.numero}`,
                    })
                    faltantes.push({ producto_id: producto.id, cantidad: aCantidad(falta), unidad_ids: [] })
                }
                await t.trx
                    .from('inventario.ordenes_traslado_lineas')
                    .where('id', linea.id)
                    .update({ cantidad_recibida: aCantidad(recibida), costo_recibido: aTexto(costoRecibido) })
            }
        }

        const estado = faltantes.length > 0 ? 'recibida_con_diferencias' : 'recibida'
        const antes = {
            estado: 'en_transito',
            metodo_recepcion: null,
            recibido_por: null,
            registrado_por: null,
        }
        let firmaRuta: string | null = null
        if (input.firma) {
            firmaRuta = await guardarArchivoInventario('firmas', 'image/png', input.firma.contenido)
        }
        try {
            const cambios = {
                estado,
                metodo_recepcion: metodo,
                recibido_por: recibidoPor,
                registrado_por: actor,
                recibido_en: t.trx.knexRawQuery('now()'),
                observaciones: input.observaciones?.trim() || null,
                firma_ruta: firmaRuta,
                firma_sha256: input.firma?.sha256 ?? null,
                firma_tamano: input.firma?.contenido.length ?? null,
                firma_ip: input.firma ? (input.firma_ip ?? null) : null,
                firma_en: input.firma ? t.trx.knexRawQuery('now()') : null,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            }
            await t.trx.from('inventario.ordenes_traslado').where('id', orden.id).update(cambios)
            await t.registrarCambios({ tipo: 'orden_traslado', id: orden.id }, antes, {
                estado,
                metodo_recepcion: metodo,
                recibido_por: recibidoPor,
                registrado_por: actor,
            })
            t.anotarAuditoria({
                metodo_recepcion: metodo,
                recibido_por: recibidoPor,
                registrado_por: actor,
                firma_sha256: input.firma?.sha256 ?? null,
                faltantes,
            })
            await t.emit('inventario.traslado_recibido', {
                orden_id: orden.id,
                empresa_id: empresaId,
                numero: Number(orden.numero),
                estado,
                metodo_recepcion: metodo,
                recibido_por: recibidoPor,
                registrado_por: actor,
                faltantes,
            })
            return await verOrdenTraslado(orden.id, t.trx)
        } catch (error) {
            if (firmaRuta) await borrarArchivoInventario(firmaRuta)
            throw error
        }
    }
}
