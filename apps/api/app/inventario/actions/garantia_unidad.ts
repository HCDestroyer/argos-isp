import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { fechaValida } from '#ledger/fechas'
import { bloquearProducto } from '#inventario/kardex'
import {
    actualizarUnidad,
    normalizarMac,
    normalizarSerie,
    productoDeUnidad,
    verUnidad,
    type UnidadVista,
} from '#inventario/unidades'
import { capturarEstado, registrarEstadoEquipo } from '#inventario/equipos'

/**
 * Garantía del proveedor de una unidad (contrato Iris 0.12.0 §3.10, A48). La unidad en garantía sigue en su
 * bodega como `en_reparacion` (cuenta en existencias y en 1.1.14 a su costo): ninguna de estas acciones mueve
 * el kardex ni el libro; quedan en `inventario.garantias`, en el historial del equipo y en `audit.cambios`.
 *
 * - `inventario.enviar_garantia`: de `revision` (o una garantía abierta sin enviar, la del cambio de equipo)
 *   a `garantia`, con proveedor (`proveedor_id` de la empresa o `proveedor_nombre`), RMA y vencimiento.
 * - `inventario.resolver_garantia`: `reparada` (vuelve `disponible`, usada), `reemplazada` (el proveedor
 *   entrega otro equipo: la unidad toma su serie o MAC, queda `disponible` y nueva, al mismo costo; la serie y
 *   la MAC anteriores quedan en la garantía) o `rechazada` (vuelve a `revision`, para repararla o darla de
 *   baja con `POST /inventario/bajas`).
 */

async function unidadEnReparacion(t: Transaccion, unidadId: number) {
    t.fijarEntidad('unidad_inventario', unidadId)
    const productoId = await productoDeUnidad(t, unidadId)
    await bloquearProducto(t, productoId)
    const unidad = (await t.trx
        .from('inventario.unidades')
        .where('id', unidadId)
        .forUpdate()
        .select('id', 'empresa_id', 'estado', 'serie', 'mac', 'condicion')
        .first()) as {
        id: number
        empresa_id: number
        estado: string
        serie: string | null
        mac: string | null
        condicion: string
    }
    exigirAccesoEmpresa(t.ctx, Number(unidad.empresa_id))
    t.fijarEmpresa(Number(unidad.empresa_id))
    const garantia = (await t.trx
        .from('inventario.garantias')
        .where('unidad_id', unidadId)
        .whereNull('resultado')
        .forUpdate()
        .select('id', 'enviada_en')
        .first()) as { id: number; enviada_en: Date | null } | null
    return { unidad, garantia }
}

function noEstaEn(unidadId: number, estado: string, esperado: string): Conflicto {
    return new Conflicto(
        `La unidad ${unidadId} está ${estado.replaceAll('_', ' ')}, no ${esperado}`,
        'estado_unidad_cambiado',
        'El estado de la unidad cambió',
    )
}

export interface EntradaEnviarGarantia {
    unidad_id: number
    proveedor_id?: number | null
    proveedor_nombre?: string | null
    rma: string
    vence_en: string
    nota?: string | null
}

export class EnviarGarantia extends DomainAction<EntradaEnviarGarantia, UnidadVista> {
    readonly nombre = 'inventario.enviar_garantia'

    protected async handle(input: EntradaEnviarGarantia, t: Transaccion): Promise<UnidadVista> {
        const { unidad, garantia } = await unidadEnReparacion(t, input.unidad_id)
        if (unidad.estado !== 'en_reparacion' || garantia?.enviada_en) {
            throw noEstaEn(unidad.id, garantia?.enviada_en ? 'en garantía' : unidad.estado, 'en revisión')
        }
        const nombre = input.proveedor_nombre?.trim() || null
        if (!input.proveedor_id && !nombre) {
            throw new ValidacionFallida([
                {
                    field: 'proveedor_id',
                    message: 'Indica el proveedor (proveedor_id o proveedor_nombre)',
                    rule: 'required',
                },
            ])
        }
        if (input.proveedor_id) {
            const proveedor = await t.trx
                .from('ledger.proveedores')
                .where({ id: input.proveedor_id, empresa_id: unidad.empresa_id })
                .select('id')
                .first()
            if (!proveedor) {
                throw new ValidacionFallida([
                    { field: 'proveedor_id', message: 'Proveedor inexistente en la empresa', rule: 'exists' },
                ])
            }
        }
        const venceEn = fechaValida(input.vence_en, 'vence_en')
        const datos = {
            proveedor_id: input.proveedor_id ?? null,
            proveedor_nombre: nombre,
            rma: input.rma.trim(),
            vence_en: venceEn,
            nota: input.nota?.trim() || null,
            enviada_en: t.trx.knexRawQuery('now()'),
        }
        const antes = await capturarEstado(t, unidad.id)
        if (garantia) {
            await t.trx
                .from('inventario.garantias')
                .where('id', garantia.id)
                .update({ ...datos, version: t.trx.knexRawQuery('version + 1') } as Record<string, unknown>)
        } else {
            await t.trx
                .insertQuery()
                .table('inventario.garantias')
                .insert({
                    ...datos,
                    empresa_id: unidad.empresa_id,
                    unidad_id: unidad.id,
                    origen: 'panel',
                    abierta_por: usuarioDelActor(t.ctx.actor),
                })
        }
        await registrarEstadoEquipo(t, unidad.id, antes, { motivo: 'garantia' })
        await t.registrarCambios(
            { tipo: 'unidad_inventario', id: unidad.id },
            { estado_equipo: antes.estado },
            { estado_equipo: 'garantia', rma: datos.rma, vence_en: venceEn },
        )
        return verUnidad(unidad.id, t.trx)
    }
}

export const RESULTADOS_GARANTIA = ['reparada', 'reemplazada', 'rechazada'] as const

export interface EntradaResolverGarantia {
    unidad_id: number
    resultado: (typeof RESULTADOS_GARANTIA)[number]
    /** con `reemplazada`: la serie o la MAC del equipo que entregó el proveedor */
    serie?: string | null
    mac?: string | null
    nota?: string | null
}

export class ResolverGarantia extends DomainAction<EntradaResolverGarantia, UnidadVista> {
    readonly nombre = 'inventario.resolver_garantia'

    protected async handle(input: EntradaResolverGarantia, t: Transaccion): Promise<UnidadVista> {
        const { unidad, garantia } = await unidadEnReparacion(t, input.unidad_id)
        if (unidad.estado !== 'en_reparacion' || !garantia) {
            throw noEstaEn(
                unidad.id,
                unidad.estado === 'en_reparacion' ? 'en revisión' : unidad.estado,
                'en garantía',
            )
        }
        const antes = await capturarEstado(t, unidad.id)
        let serie = unidad.serie
        let mac = unidad.mac
        if (input.resultado === 'reemplazada') {
            serie = normalizarSerie(input.serie) ?? null
            mac = input.mac ? normalizarMac(input.mac) : null
            if (!serie && !mac) {
                throw new ValidacionFallida([
                    {
                        field: 'serie',
                        message: 'Indica la serie o la MAC del equipo de reemplazo',
                        rule: 'required',
                    },
                ])
            }
            const repetida = await t.trx
                .from('inventario.unidades')
                .where('empresa_id', unidad.empresa_id)
                .whereNot('id', unidad.id)
                .whereNotIn('estado', ['anulada', 'devuelta_proveedor'])
                .where((q) => {
                    if (serie) q.orWhereRaw('upper(serie) = ?', [serie])
                    if (mac) q.orWhere('mac', mac)
                })
                .select('id')
                .first()
            if (repetida) {
                throw new ValidacionFallida([
                    {
                        field: serie ? 'serie' : 'mac',
                        message: 'Esa serie o MAC ya existe en la empresa',
                        rule: 'serie_duplicada',
                    },
                ])
            }
        }
        const cerrar = async () => {
            await t.trx
                .from('inventario.garantias')
                .where('id', garantia.id)
                .update({
                    resultado: input.resultado,
                    resuelta_en: t.trx.knexRawQuery('now()'),
                    resuelta_por: usuarioDelActor(t.ctx.actor),
                    serie_anterior: input.resultado === 'reemplazada' ? unidad.serie : null,
                    mac_anterior: input.resultado === 'reemplazada' ? unidad.mac : null,
                    nota: input.nota?.trim() || undefined,
                    version: t.trx.knexRawQuery('version + 1'),
                } as Record<string, unknown>)
        }
        if (input.resultado === 'rechazada') {
            // vuelve a revisión (sigue en_reparacion, ya sin garantía abierta)
            await cerrar()
            await registrarEstadoEquipo(t, unidad.id, antes, { motivo: 'garantia_rechazada' })
        } else {
            if (input.resultado === 'reemplazada') {
                await t.trx
                    .from('inventario.unidades')
                    .where('id', unidad.id)
                    .update({ serie, mac } as Record<string, unknown>)
            }
            const condicion = input.resultado === 'reemplazada' ? 'nuevo' : 'usado'
            // con la garantía todavía abierta: el historial queda garantia → disponible
            await actualizarUnidad(
                t,
                unidad.id,
                { estado: 'disponible', condicion },
                { motivo: `garantia_${input.resultado}` },
            )
            await cerrar()
        }
        await t.registrarCambios(
            { tipo: 'unidad_inventario', id: unidad.id },
            { estado_equipo: antes.estado, serie: unidad.serie, mac: unidad.mac },
            {
                estado_equipo: input.resultado === 'rechazada' ? 'revision' : 'disponible',
                serie,
                mac,
                resultado: input.resultado,
            },
        )
        return verUnidad(unidad.id, t.trx)
    }
}
