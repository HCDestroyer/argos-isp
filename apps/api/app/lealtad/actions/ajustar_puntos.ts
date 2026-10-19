import { randomUUID } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { hoyGuatemala } from '#ledger/fechas'
import { empresaLealtad } from '#lealtad/comun'
import { ProgramaInactivo, SaldoInsuficiente, ServicioNoValido } from '#lealtad/errores'
import { programaActivo } from '#lealtad/programas'
import { serviciosDelCliente } from '#lealtad/condiciones'
import {
    acumular,
    bloquearClienteLealtad,
    descontar,
    saldoPuntos,
    type MovimientoPuntos,
} from '#lealtad/puntos'

/**
 * `lealtad.ajustar` (`POST /lealtad/ajustes`, permiso `lealtad.ajustar`, `Idempotency-Key`):
 * ajuste manual con motivo obligatorio (§4), en la empresa activa (o `empresa_id`).
 *
 * - Positivo: un lote nuevo con el vencimiento del programa; con diferimiento lleva su asiento
 *   `4.1.05 / 2.1.10` (sin diferimiento no tiene valor contable).
 * - Negativo: consume lotes, el que vence antes primero, y revierte su diferimiento
 *   (`2.1.10 / 4.1.05`); nunca deja el saldo negativo (422 `saldo_insuficiente`).
 * - 422 `programa_inactivo` sin programa activo; 422 `servicio_no_valido` si el cliente no tiene
 *   servicio (no retirado) en la empresa o `servicio_id` no es suyo en ella.
 */

export interface EntradaAjuste {
    empresa_id?: number | null
    cliente_id: number
    servicio_id?: number | null
    puntos: number
    motivo: string
}

export interface AjusteRealizado {
    movimiento: MovimientoPuntos
    saldo: number
}

export default class AjustarPuntos extends DomainAction<EntradaAjuste, AjusteRealizado> {
    readonly nombre = 'lealtad.ajustar'

    protected async handle(input: EntradaAjuste, t: Transaccion): Promise<AjusteRealizado> {
        if (!Number.isInteger(input.puntos) || input.puntos === 0) {
            throw new ValidacionFallida([{ field: 'puntos', message: 'puntos es un entero distinto de 0' }])
        }
        const motivo = input.motivo?.trim()
        if (!motivo) throw new ValidacionFallida([{ field: 'motivo', message: 'El motivo es obligatorio' }])
        const empresaId = await empresaLealtad(t, input.empresa_id)
        t.fijarEntidad('cliente', input.cliente_id)
        const programa = await programaActivo(empresaId, t.trx)
        if (!programa) throw new ProgramaInactivo(empresaId)

        const servicios = await serviciosDelCliente(t.trx, empresaId, input.cliente_id)
        if (servicios.length === 0) {
            throw new ServicioNoValido(
                `El cliente ${input.cliente_id} no tiene servicios en la empresa ${empresaId}`,
            )
        }
        const servicioId = input.servicio_id ?? servicios[0]!.id
        if (!servicios.some((s) => s.id === servicioId)) {
            throw new ServicioNoValido(
                `El servicio ${servicioId} no es del cliente en la empresa ${empresaId}`,
            )
        }

        await bloquearClienteLealtad(t.trx, input.cliente_id)
        const fecha = hoyGuatemala()
        // la repetición de la petición la resuelve `Idempotency-Key`; cada ajuste es un movimiento propio
        const clave = `ajuste:${randomUUID()}`
        let movimiento: MovimientoPuntos
        if (input.puntos > 0) {
            movimiento = await acumular(t, programa, {
                cliente_id: input.cliente_id,
                servicio_id: servicioId,
                puntos: input.puntos,
                regla_id: null,
                origen_tipo: 'ajuste',
                origen_id: null,
                clave,
                tipo: 'ajuste',
                motivo,
                fecha,
                concepto: `ajuste manual: ${motivo}`,
            })
        } else {
            const saldo = await saldoPuntos(t.trx, empresaId, input.cliente_id)
            if (saldo < -input.puntos) throw new SaldoInsuficiente(saldo, -input.puntos)
            movimiento = await descontar(t, programa, {
                cliente_id: input.cliente_id,
                servicio_id: servicioId,
                puntos: -input.puntos,
                clave,
                motivo,
                fecha,
            })
        }
        return { movimiento, saldo: await saldoPuntos(t.trx, empresaId, input.cliente_id) }
    }
}
