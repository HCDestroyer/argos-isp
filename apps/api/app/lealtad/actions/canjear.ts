import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Prohibido, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { usuarioDelActor } from '#shared/contexto'
import { dec, redondear, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { valorParametro } from '#fiscal/parametros'
import { dentroDeVentana } from '#fiscal/fel/dte'
import { NotaFueraDePlazo } from '#fiscal/fel/errores'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import { bloquearCliente } from '#billing/cobros'
import ProgramarPlanTemporal from '#core/actions/programar_plan_temporal'
import {
    ParametroSinConfirmar,
    ProgramaInactivo,
    SaldoInsuficiente,
    ServicioNoValido,
    SinExistencias,
    CanjePendiente,
    CanjePortalInactivo,
} from '#lealtad/errores'
import { programaActivo } from '#lealtad/programas'
import { verPremio, type PremioVista } from '#lealtad/premios'
import {
    camposAuditables,
    descuentoReservado,
    verCanje,
    type CanalCanje,
    type CanjeVista,
} from '#lealtad/canjes'
import { bloquearClienteLealtad, saldoPuntos, salidaCanje } from '#lealtad/puntos'

/**
 * `lealtad.canjear` (`POST /lealtad/canjes`, permiso `lealtad.canjear`, `Idempotency-Key`):
 * cambia puntos por un premio del catálogo (`contratos/lealtad.md` §5). La empresa es la del premio.
 *
 * Validaciones (§5): programa activo y premio activo de ese programa (422 `programa_inactivo`,
 * `premio_inactivo`); servicio del cliente en esa empresa y no retirado (422 `servicio_no_valido`);
 * saldo ≥ `costo_puntos` y ≥ `minimo_canje` (422 `saldo_insuficiente`; un saldo negativo bloquea);
 * existencias (409 `sin_existencias`); un descuento reservado por servicio (409 `canje_pendiente`).
 *
 * Los puntos salen al crear el canje: movimiento `canje` que consume los lotes (el que vence antes
 * primero) y, con diferimiento, el asiento `2.1.10 / 4.1.06` por el valor consumido (§6). Según el tipo:
 *
 * - `mejora_plan`: `servicios.programar_plan_temporal` (A1) anidada con `origen: lealtad`,
 *   `origen_id` = el canje; si no se puede (incompatible, ya hay otro…) falla todo el canje. Queda
 *   `aplicado` con `plan_temporal_id`.
 * - `descuento_factura` / `mes_gratis` con `factura_id`: nota de crédito por línea sobre la línea del
 *   plan (`facturas.nota_credito`, NCRE si la factura tiene DTE), solo dentro de `nota_ventana_meses`
 *   (422 `nota_fuera_de_plazo`). Sobre una factura pagada (o por más de su saldo) la nota se emite igual
 *   y el excedente queda como crédito del cliente en Anticipos. Queda `aplicado` con `nota_credito_id`.
 * - `descuento_factura` / `mes_gratis` sin factura: `reservado` para la próxima factura del servicio.
 * - `bien`: 422 `parametro_sin_confirmar` (`premio_bien_iva`, decisión del contador). `boletos`: fase 3.
 *
 * Portal (A5): con actor `cliente` o canal `portal`, exige `visible_portal` y `canje_portal` del programa
 * (403 `canje_portal_inactivo`) y que el cliente sea el del canje (403); queda con canal `portal` y
 * auditado como el cliente.
 *
 * Eventos `lealtad.canje_reservado` o `lealtad.canje_aplicado`.
 */

export interface EntradaCanjear {
    cliente_id: number
    servicio_id: number
    premio_id: number
    factura_id?: number | null
    canal?: CanalCanje
}

/** Descuento sobre la línea del plan: nunca la deja bajo cero ni cubre mora ni otros conceptos (§5). */
export function descuentoDe(premio: PremioVista, lineaPlan: Dec): Dec {
    if (premio.tipo === 'mes_gratis') return lineaPlan
    const valor = dec(premio.descuento_valor)
    let descuento =
        premio.descuento_tipo === 'porcentaje' ? redondear(lineaPlan.times(valor).dividedBy(100)) : valor
    if (premio.tope !== null && descuento.greaterThan(dec(premio.tope))) descuento = dec(premio.tope)
    return descuento.greaterThan(lineaPlan) ? lineaPlan : descuento
}

export default class Canjear extends DomainAction<EntradaCanjear, CanjeVista> {
    readonly nombre = 'lealtad.canjear'

    protected async handle(input: EntradaCanjear, t: Transaccion): Promise<CanjeVista> {
        const premio = await verPremio(input.premio_id, t.trx)
        const empresaId = premio.empresa_id
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const programa = await programaActivo(empresaId, t.trx)
        if (!programa) throw new ProgramaInactivo(empresaId)
        // portal (A5): un cliente solo canjea sus propios puntos y si el programa lo permite
        const desdePortal = t.ctx.actor.tipo === 'cliente' || t.ctx.canal === 'portal'
        if (desdePortal) {
            if (!programa.visible_portal || !programa.canje_portal) throw new CanjePortalInactivo(empresaId)
            if (t.ctx.actor.tipo === 'cliente' && t.ctx.actor.id !== input.cliente_id) {
                throw new Prohibido('Un cliente solo canjea sus propios puntos')
            }
        }
        if (premio.programa_id !== programa.id || !premio.activo) {
            throw new ReglaNegocio(`El premio ${premio.id} no está activo en el programa`, 'premio_inactivo')
        }
        if (premio.tipo === 'bien') throw new ParametroSinConfirmar('premio_bien_iva')
        if (premio.tipo === 'boletos') {
            throw new ReglaNegocio(
                'Los canjes por boletos llegan con los sorteos (fase 3)',
                'recompensa_no_disponible',
            )
        }
        const descuento = premio.tipo === 'descuento_factura' || premio.tipo === 'mes_gratis'
        if (input.factura_id && !descuento) {
            throw new ValidacionFallida([
                { field: 'factura_id', message: 'Solo un descuento se aplica a una factura' },
            ])
        }

        const servicio = (await t.trx
            .from('core.servicios')
            .where('id', input.servicio_id)
            .select('cliente_id', 'empresa_id', 'estado')
            .first()) as { cliente_id: number; empresa_id: number; estado: string } | null
        if (
            !servicio ||
            Number(servicio.cliente_id) !== input.cliente_id ||
            Number(servicio.empresa_id) !== empresaId ||
            servicio.estado === 'retirado'
        ) {
            throw new ServicioNoValido(
                `El servicio ${input.servicio_id} no es un servicio vigente del cliente en la empresa ${empresaId}`,
            )
        }

        // mismo orden de locks que `facturas.emitir`: el de cobros del cliente y luego el de lealtad
        await bloquearCliente(t.trx, input.cliente_id)
        await bloquearClienteLealtad(t.trx, input.cliente_id)
        const saldo = await saldoPuntos(t.trx, empresaId, input.cliente_id)
        const necesario = Math.max(premio.costo_puntos, programa.minimo_canje)
        if (saldo < necesario) throw new SaldoInsuficiente(saldo, necesario)
        const bloqueado = await verPremio(premio.id, t.trx, true)
        if (bloqueado.existencias !== null) {
            if (bloqueado.existencias <= 0) throw new SinExistencias(premio.id)
            await t.trx
                .from('lealtad.premios')
                .where('id', premio.id)
                .update({ existencias: bloqueado.existencias - 1, updated_at: t.trx.knexRawQuery('now()') })
        }
        if (descuento && !input.factura_id) {
            const pendiente = await descuentoReservado(t.trx, input.servicio_id)
            if (pendiente) throw new CanjePendiente(pendiente.id)
        }

        const fecha = hoyGuatemala()
        const lineaFactura = input.factura_id
            ? await this.lineaDelPlan(t, input.factura_id, input.servicio_id, empresaId, fecha)
            : null

        const [fila] = (await t.trx
            .insertQuery()
            .table('lealtad.canjes')
            .insert({
                empresa_id: empresaId,
                programa_id: programa.id,
                cliente_id: input.cliente_id,
                servicio_id: input.servicio_id,
                premio_id: premio.id,
                tipo: premio.tipo,
                puntos: premio.costo_puntos,
                canal: desdePortal ? 'portal' : (input.canal ?? 'panel'),
                creado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const canjeId = Number(fila!.id)
        t.fijarEntidad('canje_lealtad', canjeId)
        const salida = await salidaCanje(t, programa, {
            canje_id: canjeId,
            cliente_id: input.cliente_id,
            servicio_id: input.servicio_id,
            puntos: premio.costo_puntos,
            fecha,
            concepto: premio.nombre,
        })

        const cambios: Record<string, unknown> = { movimiento_id: salida.id }
        if (premio.tipo === 'mejora_plan') {
            const plan = await new ProgramarPlanTemporal().execute(
                {
                    servicio_id: input.servicio_id,
                    plan_id: premio.plan_destino_id!,
                    dias: premio.dias!,
                    origen: 'lealtad',
                    origen_id: canjeId,
                    motivo: `Canje de lealtad ${canjeId}: ${premio.nombre}`,
                },
                t.ctx,
                { trx: t.trx },
            )
            Object.assign(cambios, { estado: 'aplicado', plan_temporal_id: plan.id, aplicado_en: new Date() })
        } else if (lineaFactura) {
            const monto = descuentoDe(premio, dec(lineaFactura.total))
            if (!monto.greaterThan(0)) {
                throw new ReglaNegocio(
                    'La línea del plan de la factura ya no admite descuento',
                    'descuento_sin_base',
                )
            }
            const nota = await new EmitirNotaCredito().execute(
                {
                    factura_id: input.factura_id!,
                    lineas: [{ linea_id: lineaFactura.id, monto: monto.toFixed(2) }],
                    motivo: `Canje de lealtad ${canjeId}: ${premio.nombre}`,
                    // decisión del PM: sobre una factura pagada, lo que pase el saldo queda en Anticipos
                    excedente_a_anticipos: true,
                },
                t.ctx,
                { trx: t.trx },
            )
            Object.assign(cambios, {
                estado: 'aplicado',
                descuento: monto.toFixed(2),
                factura_id: input.factura_id,
                nota_credito_id: nota.id,
                aplicado_en: new Date(),
            })
        }
        await t.trx.from('lealtad.canjes').where('id', canjeId).update(cambios)
        const canje = await verCanje(canjeId, t.trx)
        await t.registrarCambios({ tipo: 'canje_lealtad', id: canjeId }, null, {
            premio_id: canje.premio_id,
            puntos: canje.puntos,
            ...camposAuditables(canje),
        })
        await t.emit(canje.estado === 'aplicado' ? 'lealtad.canje_aplicado' : 'lealtad.canje_reservado', {
            canje_id: canje.id,
            empresa_id: canje.empresa_id,
            cliente_id: canje.cliente_id,
            servicio_id: canje.servicio_id,
            premio_id: canje.premio_id,
            tipo: canje.tipo,
            puntos: canje.puntos,
            factura_id: canje.factura_id,
        })
        return canje
    }

    /** Línea del plan (tipo `servicio`) de una factura del servicio, dentro de la ventana de notas. */
    private async lineaDelPlan(
        t: Transaccion,
        facturaId: number,
        servicioId: number,
        empresaId: number,
        fecha: string,
    ): Promise<{ id: number; total: string }> {
        const factura = (await t.trx
            .from('billing.facturas')
            .where('id', facturaId)
            .select('servicio_id', 'empresa_id', 'estado', 'emitida_en')
            .first()) as {
            servicio_id: number | null
            empresa_id: number
            estado: string
            emitida_en: Date
        } | null
        if (
            !factura ||
            Number(factura.servicio_id) !== servicioId ||
            Number(factura.empresa_id) !== empresaId
        ) {
            throw new ValidacionFallida([
                {
                    field: 'factura_id',
                    message: 'La factura no es del servicio en la empresa',
                    rule: 'exists',
                },
            ])
        }
        let meses = 2
        try {
            meses = Number(await valorParametro<number>(empresaId, 'nota_ventana_meses', fecha, t.trx)) || 2
        } catch {
            // sin localización fiscal instalada: la ventana del contrato (2 meses)
        }
        if (!dentroDeVentana(factura.emitida_en, fecha, meses)) throw new NotaFueraDePlazo(meses)
        const linea = (await t.trx
            .from('billing.facturas_lineas')
            .where('factura_id', facturaId)
            .where('tipo', 'servicio')
            .orderBy('id', 'asc')
            .select('id', 'total')
            .first()) as { id: number; total: string } | null
        if (!linea) {
            throw new ValidacionFallida([
                { field: 'factura_id', message: 'La factura no tiene línea del plan' },
            ])
        }
        return { id: Number(linea.id), total: linea.total }
    }
}
