import type { Transaccion } from '#shared/domain_action'
import { aTexto, dec, type Dec } from '#ledger/dinero'
import { planTemporalActivo } from '#core/planes_temporales'
import { empresaConPrograma } from '#lealtad/programas'
import { verPremio } from '#lealtad/premios'
import { camposAuditables, verCanje } from '#lealtad/canjes'
import { bloquearClienteLealtad } from '#lealtad/puntos'
import { descuentoDe } from '#lealtad/actions/canjear'

/**
 * Lo que `facturas.emitir` pide a lealtad (`contratos/lealtad.md` §5): las líneas `descuento` de la
 * factura del periodo de un servicio. La emisión las agrega sobre la línea del plan (IVA del neto) y,
 * ya creada la factura, marca los canjes como `aplicados` (`aplicarCanjesEmitidos`) en la misma
 * transacción. Toma el mismo lock por cliente que el canje.
 *
 * - **Mejora de plan** (decisión del PM: `mejora_facturacion = descuento_linea`): con un plan temporal
 *   `activo` de origen `lealtad`, la factura cobra el plan superior y una línea de descuento hasta el
 *   precio del plan original (prorrateado igual). Con `costo_override` el precio no cambia: sin descuento.
 * - **Descuentos reservados** (`descuento_factura`, `mes_gratis`): cada canje reservado del servicio, sobre
 *   lo que le queda a la línea del plan. Uno que ya no tenga base queda reservado para la siguiente.
 * - Sin programa en la empresa no consulta canjes (con el programa apagado, nada cambia).
 */

/** Decisión del PM (2026-10-19) sobre el parámetro `mejora_facturacion` del contrato (§5, §17 n.º 3). */
export const MEJORA_FACTURACION = 'descuento_linea' as const

export interface DescuentosEmision {
    descuentos: Array<{ concepto: string; monto: string }>
    canjes: Array<{ id: number; monto: string }>
}

export async function descuentosParaFactura(
    t: Transaccion,
    servicio: { id: number; cliente_id: number; empresa_id: number },
    lineaPlan: Dec,
    factor: Dec,
): Promise<DescuentosEmision> {
    const salida: DescuentosEmision = { descuentos: [], canjes: [] }
    let base = lineaPlan

    const temporal = await planTemporalActivo(servicio.id, t.trx)
    if (temporal && temporal.origen === 'lealtad') {
        const servicioFila = (await t.trx
            .from('core.servicios')
            .where('id', servicio.id)
            .select('costo_override')
            .firstOrFail()) as { costo_override: string | null }
        const plan = (await t.trx
            .from('network.planes')
            .where('id', temporal.plan_original_id)
            .select('precio', 'nombre')
            .firstOrFail()) as { precio: string; nombre: string }
        const fila = { costo_override: servicioFila.costo_override, precio: plan.precio, nombre: plan.nombre }
        if (fila.costo_override === null) {
            const original = dec(fila.precio).times(factor).toDecimalPlaces(2)
            const descuento = base.minus(original)
            if (descuento.gt(0)) {
                salida.descuentos.push({
                    concepto: `Mejora de plan por puntos (canje ${temporal.origen_id}): se cobra el plan ${fila.nombre}`,
                    monto: aTexto(descuento),
                })
                base = base.minus(descuento)
            }
        }
    }

    if (!(await empresaConPrograma(servicio.empresa_id, t.trx))) return salida
    await bloquearClienteLealtad(t.trx, servicio.cliente_id)
    const reservados = (await t.trx
        .from('lealtad.canjes')
        .where('servicio_id', servicio.id)
        .where('estado', 'reservado')
        .whereIn('tipo', ['descuento_factura', 'mes_gratis'])
        .orderBy('id', 'asc')
        .forUpdate()
        .select('id', 'premio_id')) as Array<{ id: number; premio_id: number }>
    for (const canje of reservados) {
        if (base.lte(0)) break
        const premio = await verPremio(Number(canje.premio_id), t.trx)
        const monto = descuentoDe(premio, base)
        if (monto.lte(0)) continue
        salida.descuentos.push({
            concepto: `Descuento por puntos (canje ${canje.id}): ${premio.nombre}`,
            monto: aTexto(monto),
        })
        salida.canjes.push({ id: Number(canje.id), monto: aTexto(monto) })
        base = base.minus(monto)
    }
    return salida
}

/** Marca como `aplicados` a la factura los canjes cuyo descuento llevó (y emite `lealtad.canje_aplicado`). */
export async function aplicarCanjesEmitidos(
    t: Transaccion,
    facturaId: number,
    canjes: DescuentosEmision['canjes'],
): Promise<void> {
    for (const c of canjes) {
        const antes = await verCanje(c.id, t.trx)
        await t.trx
            .from('lealtad.canjes')
            .where('id', c.id)
            .update({
                estado: 'aplicado',
                descuento: c.monto,
                factura_id: facturaId,
                aplicado_en: t.trx.knexRawQuery('now()'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const despues = await verCanje(c.id, t.trx)
        await t.registrarCambios(
            { tipo: 'canje_lealtad', id: c.id },
            camposAuditables(antes),
            camposAuditables(despues),
        )
        await t.emit('lealtad.canje_aplicado', {
            canje_id: despues.id,
            empresa_id: despues.empresa_id,
            cliente_id: despues.cliente_id,
            servicio_id: despues.servicio_id,
            premio_id: despues.premio_id,
            tipo: despues.tipo,
            puntos: despues.puntos,
            factura_id: facturaId,
        })
    }
}
