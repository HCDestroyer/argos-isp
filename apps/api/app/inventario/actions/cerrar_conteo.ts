import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'
import { usuarioDelActor } from '#shared/contexto'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    aCantidad,
    bloquearProducto,
    bodegaMovible,
    costoDeSobrante,
    costoSalida,
    productoMovible,
    registrarMovimientoConAsiento,
    saldoDe,
    type ProductoMovible,
} from '#inventario/kardex'
import {
    EN_BODEGA,
    actualizarUnidad,
    crearUnidades,
    validarUnidadesNuevas,
    type UnidadFila,
} from '#inventario/unidades'
import { coincide, lineasDelConteo, unidadContada, verConteo, type ConteoVista } from '#inventario/conteos'
import { conteoAbierto } from '#inventario/actions/contar_inventario'

/**
 * `inventario.cerrar_conteo` (`POST /inventario/conteos/:id/cerrar`): compara lo contado con la
 * existencia de la bodega en ese momento y ajusta la diferencia con movimientos `ajuste_conteo`
 * (origen `conteo`), cada uno con su asiento (§5, caso 5):
 *
 * - **Faltante**: sale al promedio de la bodega (por serie, cada unidad no contada a su costo, y queda
 *   `dada_de_baja`). `5.6.02 Mermas y faltantes / 1.1.14`.
 * - **Sobrante**: entra al promedio de la bodega; sin existencia, al `costo_unitario` de la línea o al
 *   último costo del producto (la regla del ajuste, H41). Por serie, cada serie o MAC contada que no es
 *   de la bodega entra como unidad nueva (usada); si es una unidad viva en otra parte, 422
 *   `serie_duplicada` (se traslada o se corrige antes). `1.1.14 / 4.2.04 Sobrantes`.
 *
 * Solo se ajustan los productos contados (sin línea, no se tocan). Guarda en cada línea lo esperado,
 * la diferencia y su valor, y en el conteo el total del faltante y del sobrante. Emite
 * `inventario.conteo_cerrado`. Un conteo cerrado no se vuelve a cerrar (409 `conteo_no_abierto`).
 * Fecha de hoy; respeta los bloqueos del libro.
 */

export interface EntradaCerrarConteo {
    id: number
    version?: number | null
}

interface Ajuste {
    cantidad: Dec
    costo: Dec
    unidadId: number | null
}

export default class CerrarConteo extends DomainAction<EntradaCerrarConteo, ConteoVista> {
    readonly nombre = 'inventario.cerrar_conteo'

    protected async handle(input: EntradaCerrarConteo, t: Transaccion): Promise<ConteoVista> {
        const conteo = await conteoAbierto(t, input.id)
        if (input.version !== undefined && input.version !== null && input.version !== conteo.version) {
            throw new ConflictoVersion('conteo', input.id)
        }
        const bodega = await bodegaMovible(t, conteo.bodega_id, conteo.empresa_id)
        const lineas = await lineasDelConteo(t.trx, conteo.id)
        // locks de producto en orden de id (las líneas vienen ordenadas por producto)
        for (const l of lineas) await bloquearProducto(t, Number(l.producto_id))
        const fecha = hoyGuatemala()
        let faltante = CERO
        let sobrante = CERO
        for (const l of lineas) {
            const producto = await productoMovible(t, Number(l.producto_id), { empresaId: conteo.empresa_id })
            const saldo = await saldoDe(t, producto.id, bodega.id)
            let esperado: Dec
            let ajustes: Ajuste[]
            if (producto.seguimiento === 'serie') {
                const r = await this.porSerie(t, conteo, producto, l.series, l.costo_unitario)
                esperado = r.esperado
                ajustes = r.ajustes
            } else {
                esperado = saldo.cantidad
                const diferencia = dec(l.contado).minus(saldo.cantidad)
                ajustes = []
                if (diferencia.lt(0)) {
                    ajustes.push({
                        cantidad: diferencia,
                        costo: costoSalida(saldo, diferencia.abs(), producto, bodega.id).neg(),
                        unidadId: null,
                    })
                } else if (diferencia.gt(0)) {
                    const unitario = await costoDeSobrante(t, producto, bodega.id, l.costo_unitario)
                    ajustes.push({
                        cantidad: diferencia,
                        costo: redondear(diferencia.times(unitario)),
                        unidadId: null,
                    })
                }
            }
            let valor = CERO
            for (const a of ajustes) {
                const entra = a.cantidad.gt(0)
                await registrarMovimientoConAsiento(
                    t,
                    {
                        empresaId: conteo.empresa_id,
                        tipo: 'ajuste_conteo',
                        fecha,
                        producto,
                        bodegaId: bodega.id,
                        cantidad: a.cantidad,
                        costoTotal: a.costo,
                        unidadId: a.unidadId,
                        origen: { tipo: 'conteo', id: conteo.id },
                        motivo: `Conteo ${conteo.id}`,
                    },
                    {
                        contrapartida: entra ? CUENTAS_GT.SOBRANTES_INVENTARIO : CUENTAS_GT.MERMAS_INVENTARIO,
                        descripcion: `Conteo ${conteo.id} (${entra ? 'sobrante' : 'faltante'}) de ${producto.sku} en ${bodega.nombre}`,
                    },
                )
                valor = valor.plus(a.costo)
                if (entra) sobrante = sobrante.plus(a.costo)
                else faltante = faltante.plus(a.costo.abs())
            }
            const contado = dec(l.contado)
            await t.trx
                .from('inventario.conteo_lineas')
                .where('id', l.id)
                .update({
                    esperado: aCantidad(esperado),
                    diferencia: aCantidad(contado.minus(esperado)),
                    valor_diferencia: aTexto(valor),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
        }
        await t.trx
            .from('inventario.conteos')
            .where('id', conteo.id)
            .update({
                estado: 'cerrado',
                cerrado_por: usuarioDelActor(t.ctx.actor),
                cerrado_en: t.trx.knexRawQuery('now()'),
                faltante: aTexto(faltante),
                sobrante: aTexto(sobrante),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.emit('inventario.conteo_cerrado', {
            conteo_id: conteo.id,
            empresa_id: conteo.empresa_id,
            bodega_id: bodega.id,
            faltante: aTexto(faltante),
            sobrante: aTexto(sobrante),
            lineas: lineas.length,
        })
        return verConteo(conteo.id, t.trx)
    }

    /** Unidades de la bodega no contadas (salen a su costo) y series contadas que no son de ella (entran). */
    private async porSerie(
        t: Transaccion,
        conteo: { empresa_id: number; bodega_id: number },
        producto: ProductoMovible,
        series: string[],
        costoUnitario: string | null,
    ): Promise<{ esperado: Dec; ajustes: Ajuste[] }> {
        const unidades = (await t.trx
            .from('inventario.unidades')
            .where({ producto_id: producto.id, bodega_id: conteo.bodega_id })
            .whereIn('estado', EN_BODEGA as string[])
            .orderBy('id')
            .forUpdate()
            .select('*')) as UnidadFila[]
        const ajustes: Ajuste[] = []
        const nuevas = series.filter((v) => !unidades.some((u) => coincide(v, u)))
        // el costo del sobrante se toma antes de sacar los faltantes (promedio de lo que había)
        const unitario =
            nuevas.length > 0 ? await costoDeSobrante(t, producto, conteo.bodega_id, costoUnitario) : CERO
        for (const u of unidades) {
            if (series.some((v) => coincide(v, u))) continue
            await actualizarUnidad(t, Number(u.id), { estado: 'dada_de_baja', bodega_id: null })
            ajustes.push({ cantidad: dec('-1'), costo: dec(u.costo).neg(), unidadId: Number(u.id) })
        }
        if (nuevas.length > 0) {
            const normalizadas = await validarUnidadesNuevas(
                t,
                conteo.empresa_id,
                nuevas.map(unidadContada),
                'series',
            )
            const costo = redondear(unitario)
            const creadas = await crearUnidades(t, {
                empresaId: conteo.empresa_id,
                productoId: producto.id,
                bodegaId: conteo.bodega_id,
                unidades: normalizadas,
                costos: normalizadas.map(() => costo),
                condicion: 'usado',
            })
            for (const u of creadas) ajustes.push({ cantidad: dec('1'), costo, unidadId: u.id })
        }
        return { esperado: dec(String(unidades.length)), ajustes }
    }
}
