import { DomainAction, type Transaccion } from '#shared/domain_action'
import { hoyGuatemala } from '#ledger/fechas'
import { dec } from '#ledger/dinero'
import { programaActivo, programaVigente, type ProgramaVista } from '#lealtad/programas'
import { reglasVigentes, verRegla, type ReglaVista } from '#lealtad/reglas'
import {
    bloquearClienteLealtad,
    otorgamientoVigente,
    type CausaReverso,
    type OrigenMovimiento,
} from '#lealtad/puntos'
import {
    excedenteDelPago,
    facturaLealtad,
    facturasPagadas,
    pagoATiempo,
    rachaHasta,
    serviciosDelCliente,
} from '#lealtad/condiciones'
import { referidoDeCliente, camposAuditables, verReferido, type ReferidoVista } from '#lealtad/referidos'
import { otorgar, resultadoVacio, revertirClave, vigenciaDe, type Resultado } from '#lealtad/otorgamientos'
import {
    CONDICIONES_POR_DEFECTO,
    type CondicionesPagoAdelantado,
    type CondicionesPagoATiempo,
    type CondicionesReferido,
} from '#lealtad/reglas'

/**
 * `lealtad.evaluar_evento`: lo que el consumidor `lealtad` (grupo de Redis, `node ace
 * billing:worker`) hace con cada evento (contrato §4 y §13). Decide desde el estado de la base,
 * no desde el payload: repetir el evento no da puntos dos veces (claves únicas) y un evento viejo
 * que llega tarde ve el estado actual.
 *
 * | Evento | Qué hace |
 * | --- | --- |
 * | `pago.registrado` | pago a tiempo de cada factura aplicada; pago adelantado del pago; referido de cada dueño de factura |
 * | `factura.emitida` | pago a tiempo de una factura que nació pagada (anticipo aplicado al emitir) |
 * | `pago.anulado` | revierte lo que ya no cumple (pago a tiempo de sus facturas, adelantado del pago, referido) |
 * | `factura.anulada`, `nota_credito.emitida`, `nota_credito.anulada` | vuelve a evaluar el pago a tiempo de la factura y el referido de su dueño |
 * | `servicio.estado_cambiado` (`a = retirado`) | rechaza el referido pendiente que se quedó sin servicio en la empresa |
 *
 * Solo otorga con el programa activo y vigente hoy, y por pagos dentro de la vigencia de la regla
 * (nada retroactivo). Los reversos se aplican siempre, aunque el programa ya no esté activo. Cada
 * cliente se bloquea antes de mover sus puntos (`bloquearClienteLealtad`).
 */

export interface EntradaEvaluarEvento {
    evento: string
    /** `audit.outbox.id` del evento (trazabilidad) */
    evento_id: number | string
    payload: Record<string, unknown>
}

const ids = (valor: unknown): number[] =>
    [...new Set((Array.isArray(valor) ? valor : []).map(Number))].filter(
        (id) => Number.isSafeInteger(id) && id > 0,
    )
const id = (valor: unknown): number | null => {
    const n = Number(valor)
    return Number.isSafeInteger(n) && n > 0 ? n : null
}

export const EVENTOS_LEALTAD = [
    'pago.registrado',
    'pago.anulado',
    'factura.emitida',
    'factura.anulada',
    'nota_credito.emitida',
    'nota_credito.anulada',
    'servicio.estado_cambiado',
] as const

export default class EvaluarEventoLealtad extends DomainAction<EntradaEvaluarEvento, Resultado> {
    readonly nombre = 'lealtad.evaluar_evento'

    protected async handle(input: EntradaEvaluarEvento, t: Transaccion): Promise<Resultado> {
        const resultado = resultadoVacio()
        const empresaId = id(input.payload.empresa_id)
        if (empresaId === null) return resultado
        t.fijarEmpresa(empresaId)
        const hoy = hoyGuatemala()
        const activo = await programaActivo(empresaId, t.trx)
        const programa = activo && programaVigente(activo, hoy) ? activo : null
        const ctx: Contexto = { t, empresaId, programa, hoy, resultado }
        const p = input.payload

        switch (input.evento) {
            case 'pago.registrado': {
                const pagoId = id(p.pago_id)
                for (const facturaId of ids(p.facturas)) {
                    await this.pagoATiempo(ctx, facturaId, { origen_tipo: 'pago', origen_id: pagoId })
                }
                if (pagoId !== null) await this.pagoAdelantado(ctx, pagoId)
                for (const clienteId of ids([
                    p.cliente_id,
                    ...(Array.isArray(p.clientes) ? p.clientes : []),
                ])) {
                    await this.referido(ctx, clienteId, { origen_tipo: 'pago', origen_id: pagoId })
                }
                break
            }
            case 'pago.anulado': {
                const pagoId = id(p.pago_id)
                for (const facturaId of ids(p.facturas)) {
                    await this.pagoATiempo(ctx, facturaId, { origen_tipo: 'pago', origen_id: pagoId })
                }
                if (pagoId !== null) await this.pagoAdelantado(ctx, pagoId)
                for (const clienteId of ids([
                    p.cliente_id,
                    ...(Array.isArray(p.clientes) ? p.clientes : []),
                ])) {
                    await this.referido(ctx, clienteId, { origen_tipo: 'pago', origen_id: pagoId })
                }
                break
            }
            case 'factura.emitida':
            case 'factura.anulada': {
                const facturaId = id(p.factura_id)
                if (facturaId !== null) {
                    await this.pagoATiempo(ctx, facturaId, { origen_tipo: 'factura', origen_id: facturaId })
                }
                const clienteId = id(p.cliente_id)
                if (clienteId !== null && input.evento === 'factura.anulada') {
                    await this.referido(ctx, clienteId, { origen_tipo: 'factura', origen_id: facturaId })
                }
                break
            }
            case 'nota_credito.emitida':
            case 'nota_credito.anulada': {
                const notaId = id(p.nota_credito_id)
                const facturaId = id(p.factura_id)
                if (facturaId !== null) {
                    await this.pagoATiempo(ctx, facturaId, { origen_tipo: 'nota_credito', origen_id: notaId })
                }
                const clienteId = id(p.cliente_id)
                if (clienteId !== null) {
                    await this.referido(ctx, clienteId, { origen_tipo: 'nota_credito', origen_id: notaId })
                }
                break
            }
            case 'servicio.estado_cambiado': {
                const servicioId = id(p.servicio_id)
                if (p.a === 'retirado' && servicioId !== null) await this.servicioRetirado(ctx, servicioId)
                break
            }
            default:
                break
        }
        return resultado
    }

    /** Pago a tiempo de una factura (§4): otorga si cumple y no estaba; revierte si estaba y ya no cumple. */
    private async pagoATiempo(c: Contexto, facturaId: number, origen: Origen) {
        const factura = await facturaLealtad(c.t.trx, facturaId)
        if (!factura || factura.empresa_id !== c.empresaId) return
        await bloquearClienteLealtad(c.t.trx, factura.cliente_id)
        const base = `pago_a_tiempo:factura:${factura.id}`
        const racha = `pago_a_tiempo:racha:factura:${factura.id}`

        const { vigente } = await otorgamientoVigente(c.t.trx, c.empresaId, base)
        if (vigente) {
            const regla = await verRegla(vigente.regla_id!, c.t.trx)
            const evaluacion = await pagoATiempo(
                c.t.trx,
                factura,
                regla.condiciones as CondicionesPagoATiempo,
                {
                    desde: '0001-01-01',
                    hasta: null,
                },
            )
            if (!evaluacion.cumple) {
                const causa = this.causa(
                    c,
                    origen,
                    `La factura ${factura.id} ya no está pagada a tiempo (${evaluacion.motivo})`,
                )
                await revertirClave(c.t, c.empresaId, base, causa, c.resultado)
                await revertirClave(c.t, c.empresaId, racha, causa, c.resultado)
            }
            return
        }
        if (!c.programa) return
        const regla = await this.reglaDe(c, 'pago_a_tiempo')
        if (!regla) return
        const condiciones = regla.condiciones as CondicionesPagoATiempo
        const evaluacion = await pagoATiempo(c.t.trx, factura, condiciones, vigenciaDe(c.programa, regla))
        if (!evaluacion.cumple) {
            c.resultado.omitidos.push({ clave: base, motivo: evaluacion.motivo })
            return
        }
        const otorgado = await otorgar(
            c.t,
            c.programa,
            regla,
            base,
            {
                cliente_id: factura.cliente_id,
                servicio_id: factura.servicio_id,
                puntos: regla.puntos,
                origen_tipo: 'factura',
                origen_id: factura.id,
                concepto: `pago a tiempo de la factura ${factura.id}`,
            },
            c.resultado,
        )
        if (!otorgado || !condiciones.racha) return
        const seguidas = await rachaHasta(c.t.trx, factura)
        if (seguidas > 0 && seguidas % condiciones.racha.periodos === 0) {
            await otorgar(
                c.t,
                c.programa,
                regla,
                racha,
                {
                    cliente_id: factura.cliente_id,
                    servicio_id: factura.servicio_id,
                    puntos: condiciones.racha.puntos_extra,
                    origen_tipo: 'factura',
                    origen_id: factura.id,
                    concepto: `racha de ${seguidas} facturas a tiempo (factura ${factura.id})`,
                },
                c.resultado,
            )
        }
    }

    /** Pago adelantado (§4): el excedente del pago en Anticipos cubre ≥ N mensualidades. */
    private async pagoAdelantado(c: Contexto, pagoId: number) {
        const info = await excedenteDelPago(c.t.trx, pagoId)
        if (!info || info.pago.empresa_id !== c.empresaId) return
        await bloquearClienteLealtad(c.t.trx, info.pago.cliente_id)
        const base = `adelantado:pago:${pagoId}`
        if (info.pago.estado !== 'registrado') {
            await revertirClave(
                c.t,
                c.empresaId,
                base,
                this.causa(c, { origen_tipo: 'pago', origen_id: pagoId }, `Pago ${pagoId} anulado`),
                c.resultado,
            )
            return
        }
        if (!c.programa) return
        const regla = await this.reglaDe(c, 'pago_adelantado')
        if (!regla) return
        const vigencia = vigenciaDe(c.programa, regla)
        const fechaPago = hoyGuatemala(new Date(info.pago.created_at))
        if (fechaPago < vigencia.desde || (vigencia.hasta !== null && fechaPago > vigencia.hasta)) {
            c.resultado.omitidos.push({ clave: base, motivo: 'pago fuera de la vigencia' })
            return
        }
        const condiciones = regla.condiciones as CondicionesPagoAdelantado
        const servicios = await serviciosDelCliente(c.t.trx, c.empresaId, info.pago.cliente_id)
        const mensualidad = servicios.reduce((s, x) => s.plus(dec(x.precio)), dec('0'))
        if (servicios.length === 0 || !mensualidad.greaterThan(0)) {
            c.resultado.omitidos.push({
                clave: base,
                motivo: 'el cliente no tiene servicios con precio en la empresa',
            })
            return
        }
        const periodos = info.excedente.dividedToIntegerBy(mensualidad).toNumber()
        if (periodos < condiciones.periodos_minimos) {
            c.resultado.omitidos.push({ clave: base, motivo: `cubre ${periodos} mensualidades` })
            return
        }
        await otorgar(
            c.t,
            c.programa,
            regla,
            base,
            {
                cliente_id: info.pago.cliente_id,
                servicio_id: servicios[0]!.id,
                puntos: regla.puntos + condiciones.puntos_por_periodo * periodos,
                origen_tipo: 'pago',
                origen_id: pagoId,
                concepto: `pago adelantado ${pagoId} (${periodos} mensualidades)`,
            },
            c.resultado,
        )
    }

    /**
     * Referido (§4): califica al referido pendiente con las facturas pagadas mínimas dentro del
     * plazo (puntos al referidor y bono al referido); si un calificado ya no las tiene (pago
     * anulado), revierte lo otorgado y vuelve a pendiente.
     */
    private async referido(c: Contexto, clienteId: number, origen: Origen) {
        const encontrado = await referidoDeCliente(c.t.trx, c.empresaId, clienteId)
        if (!encontrado || encontrado.estado === 'rechazado') return
        for (const cliente of [encontrado.referidor_id, encontrado.referido_id].sort((a, b) => a - b)) {
            await bloquearClienteLealtad(c.t.trx, cliente)
        }
        const ref = await verReferido(encontrado.id, c.t.trx, true)
        const base = `referido:${ref.id}`
        const bono = `referido:bono:${ref.id}`
        const pagadas = await facturasPagadas(c.t.trx, c.empresaId, ref.referido_id)

        if (ref.estado === 'calificado') {
            const { vigente } = await otorgamientoVigente(c.t.trx, c.empresaId, base)
            const regla = vigente?.regla_id
                ? await verRegla(vigente.regla_id, c.t.trx)
                : await this.reglaDe(c, 'referido')
            const minimas =
                (regla?.condiciones as CondicionesReferido | undefined)?.facturas_pagadas_minimas ??
                CONDICIONES_POR_DEFECTO.referido.facturas_pagadas_minimas
            if (pagadas >= minimas) return
            const causa = this.causa(
                c,
                origen,
                `El referido ${ref.id} ya no tiene ${minimas} facturas pagadas`,
            )
            await revertirClave(c.t, c.empresaId, base, causa, c.resultado)
            await revertirClave(c.t, c.empresaId, bono, causa, c.resultado)
            await this.cambiarEstado(c.t, ref, {
                estado: 'pendiente',
                calificado_en: null,
                motivo: causa.motivo,
            })
            return
        }

        if (!c.programa) return
        const regla = await this.reglaDe(c, 'referido')
        if (!regla) return
        const condiciones = regla.condiciones as CondicionesReferido
        if (condiciones.dias_maximos !== null) {
            const dias = Math.floor((Date.now() - new Date(ref.created_at).getTime()) / 86_400_000)
            if (dias > condiciones.dias_maximos) {
                await this.cambiarEstado(c.t, ref, {
                    estado: 'rechazado',
                    calificado_en: null,
                    motivo: `No calificó en ${condiciones.dias_maximos} días`,
                })
                return
            }
        }
        if (pagadas < condiciones.facturas_pagadas_minimas) {
            c.resultado.omitidos.push({ clave: base, motivo: `${pagadas} facturas pagadas` })
            return
        }
        const delReferidor = await serviciosDelCliente(c.t.trx, c.empresaId, ref.referidor_id)
        if (delReferidor.length === 0) {
            c.resultado.omitidos.push({ clave: base, motivo: 'el referidor no tiene servicio en la empresa' })
            return
        }
        await this.cambiarEstado(c.t, ref, { estado: 'calificado', calificado_en: new Date(), motivo: null })
        await c.t.emit('lealtad.referido_calificado', {
            referido_id: ref.id,
            empresa_id: c.empresaId,
            referidor_id: ref.referidor_id,
            cliente_id: ref.referido_id,
        })
        const calificados = (await c.t.trx
            .from('lealtad.referidos')
            .where('empresa_id', c.empresaId)
            .where('referidor_id', ref.referidor_id)
            .where('estado', 'calificado')
            .whereNot('id', ref.id)
            .select(c.t.trx.raw('count(*)::int as n'))
            .first()) as { n: number }
        if (
            condiciones.tope_por_referidor !== null &&
            Number(calificados.n) >= condiciones.tope_por_referidor
        ) {
            c.resultado.omitidos.push({
                clave: base,
                motivo: `tope de ${condiciones.tope_por_referidor} referidos`,
            })
        } else {
            await otorgar(
                c.t,
                c.programa,
                regla,
                base,
                {
                    cliente_id: ref.referidor_id,
                    servicio_id: delReferidor[0]!.id,
                    puntos: regla.puntos,
                    origen_tipo: 'referido',
                    origen_id: ref.id,
                    concepto: `referido ${ref.id} (cliente ${ref.referido_id})`,
                },
                c.resultado,
            )
        }
        if (condiciones.puntos_referido > 0) {
            const delReferido = await serviciosDelCliente(c.t.trx, c.empresaId, ref.referido_id)
            await otorgar(
                c.t,
                c.programa,
                regla,
                bono,
                {
                    cliente_id: ref.referido_id,
                    servicio_id: delReferido[0]?.id ?? null,
                    puntos: condiciones.puntos_referido,
                    origen_tipo: 'referido',
                    origen_id: ref.id,
                    concepto: `bono por llegar referido (${ref.id})`,
                },
                c.resultado,
            )
        }
    }

    /** Un referido pendiente que se queda sin servicios en la empresa se rechaza. */
    private async servicioRetirado(c: Contexto, servicioId: number) {
        const servicio = (await c.t.trx
            .from('core.servicios')
            .where('id', servicioId)
            .select('cliente_id', 'empresa_id')
            .first()) as { cliente_id: number; empresa_id: number } | null
        if (!servicio || Number(servicio.empresa_id) !== c.empresaId) return
        const ref = await referidoDeCliente(c.t.trx, c.empresaId, Number(servicio.cliente_id))
        if (!ref || ref.estado !== 'pendiente') return
        const restantes = await serviciosDelCliente(c.t.trx, c.empresaId, ref.referido_id)
        if (restantes.length > 0) return
        await this.cambiarEstado(c.t, ref, {
            estado: 'rechazado',
            calificado_en: null,
            motivo: `El referido retiró su servicio ${servicioId}`,
        })
    }

    private async cambiarEstado(
        t: Transaccion,
        ref: ReferidoVista,
        cambio: { estado: ReferidoVista['estado']; calificado_en: Date | null; motivo: string | null },
    ) {
        await t.trx
            .from('lealtad.referidos')
            .where('id', ref.id)
            .update({
                ...cambio,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const despues = await verReferido(ref.id, t.trx)
        await t.registrarCambios(
            { tipo: 'referido_lealtad', id: ref.id },
            camposAuditables(ref),
            camposAuditables(despues),
        )
    }

    private async reglaDe(c: Contexto, tipo: ReglaVista['tipo']): Promise<ReglaVista | null> {
        if (!c.programa) return null
        const [regla] = await reglasVigentes(c.t.trx, c.programa.id, c.hoy, tipo)
        return regla ?? null
    }

    private causa(c: Contexto, origen: Origen, motivo: string): CausaReverso {
        return { origen_tipo: origen.origen_tipo, origen_id: origen.origen_id, fecha: c.hoy, motivo }
    }
}

interface Contexto {
    t: Transaccion
    empresaId: number
    /** activo y vigente hoy; null = no se otorga (los reversos sí) */
    programa: ProgramaVista | null
    hoy: string
    resultado: Resultado
}

interface Origen {
    origen_tipo: OrigenMovimiento
    origen_id: number | null
}
