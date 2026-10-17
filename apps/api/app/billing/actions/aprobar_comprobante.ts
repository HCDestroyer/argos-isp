import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { bloquearCliente } from '#billing/cobros'
import { verComprobante, type ComprobanteVista, type EstadoComprobante } from '#billing/comprobantes'
import RegistrarPago, { type ResultadoRegistrarPago } from '#billing/actions/registrar_pago'

/**
 * `comprobantes.aprobar` (`POST /comprobantes/:id/aprobar`): un cajero o contador verificó el
 * depósito en el banco. Llama a `RegistrarPago` **anidada** (misma transacción) con los datos del
 * comprobante: el pago, su asiento (`Bancos (subcuenta de la cuenta) / CxC`), `pago.registrado` y
 * la reactivación de los servicios salen juntos. El comprobante queda `aprobado` y ligado a
 * `pago_id`; evento `comprobante.aprobado`.
 *
 * - `facturas[]` opcional, igual que en `POST /pagos`. Si no viene y el comprobante es de un
 *   servicio, se aplica primero a las facturas pendientes de ese servicio (la más antigua primero).
 * - 409 `comprobante_revisado` si ya se aprobó o rechazó; 409 `referencia_duplicada` si mientras
 *   tanto alguien registró un pago con la misma referencia (rechazarlo entonces).
 * - El pago lo registra quien aprueba (`registrado_por`).
 */

export interface EntradaAprobarComprobante {
    comprobante_id: number
    facturas?: number[]
    nota?: string | null
}

export interface ResultadoAprobarComprobante extends ComprobanteVista {
    pago: ResultadoRegistrarPago
}

interface FilaComprobante {
    id: number
    empresa_id: number
    cliente_id: number
    servicio_id: number | null
    metodo: 'deposito' | 'transferencia' | 'ach' | 'remesa'
    cuenta_bancaria_id: number
    banco_origen_id: number | null
    referencia: string
    monto: string
    nota: string | null
    estado: EstadoComprobante
}

export async function bloquearComprobante(t: Transaccion, id: number): Promise<FilaComprobante> {
    t.fijarEntidad('comprobante', id)
    const previa = await t.trx.from('billing.comprobantes').where('id', id).select('cliente_id').first()
    if (!previa) throw new NoEncontrado(`El comprobante ${id} no existe`)
    await bloquearCliente(t.trx, previa.cliente_id)
    const fila = (await t.trx
        .from('billing.comprobantes')
        .where('id', id)
        .forUpdate()
        .select(
            'id',
            'empresa_id',
            'cliente_id',
            'servicio_id',
            'metodo',
            'cuenta_bancaria_id',
            'banco_origen_id',
            'referencia',
            'monto',
            'nota',
            'estado',
        )
        .firstOrFail()) as FilaComprobante
    fila.empresa_id = Number(fila.empresa_id)
    exigirAccesoEmpresa(t.ctx, fila.empresa_id)
    t.fijarEmpresa(fila.empresa_id)
    if (fila.estado !== 'pendiente') {
        throw new Conflicto(
            `El comprobante ${id} ya fue ${fila.estado}; solo se revisan los pendientes`,
            'comprobante_revisado',
            'Comprobante ya revisado',
        )
    }
    return fila
}

export default class AprobarComprobante extends DomainAction<
    EntradaAprobarComprobante,
    ResultadoAprobarComprobante
> {
    readonly nombre = 'comprobantes.aprobar'

    protected async handle(
        input: EntradaAprobarComprobante,
        t: Transaccion,
    ): Promise<ResultadoAprobarComprobante> {
        const comprobante = await bloquearComprobante(t, input.comprobante_id)

        const facturas =
            input.facturas && input.facturas.length > 0
                ? input.facturas
                : comprobante.servicio_id
                  ? await this.pendientesDelServicio(t, comprobante.servicio_id, comprobante.empresa_id)
                  : undefined
        const nota = [`Comprobante ${comprobante.id}`, input.nota?.trim() || comprobante.nota]
            .filter(Boolean)
            .join(' · ')
        const pago = await new RegistrarPago().execute(
            {
                cliente_id: comprobante.cliente_id,
                metodo: comprobante.metodo,
                monto: comprobante.monto,
                referencia: comprobante.referencia,
                cuenta_bancaria_id: comprobante.cuenta_bancaria_id,
                banco_origen_id: comprobante.banco_origen_id,
                nota: nota.slice(0, 500),
                facturas,
                empresa_id: comprobante.empresa_id,
            },
            t.ctx,
            { trx: t.trx },
        )
        t.fijarEntidad('comprobante', comprobante.id)
        t.fijarEmpresa(comprobante.empresa_id)

        await t.trx
            .from('billing.comprobantes')
            .where('id', comprobante.id)
            .update({
                estado: 'aprobado',
                pago_id: pago.id,
                verificado_por: usuarioDelActor(t.ctx.actor),
                verificado_en: t.trx.knexRawQuery('now()'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'comprobante', id: comprobante.id },
            { estado: comprobante.estado, pago_id: null, verificado_por: null },
            { estado: 'aprobado', pago_id: pago.id, verificado_por: usuarioDelActor(t.ctx.actor) },
        )
        await t.emit('comprobante.aprobado', {
            comprobante_id: comprobante.id,
            empresa_id: comprobante.empresa_id,
            cliente_id: comprobante.cliente_id,
            pago_id: pago.id,
            motivo: null,
        })
        return { ...(await verComprobante(comprobante.id, t.trx)), pago }
    }

    /** Facturas con saldo del servicio, de la más antigua a la más nueva. */
    private async pendientesDelServicio(
        t: Transaccion,
        servicioId: number,
        empresaId: number,
    ): Promise<number[] | undefined> {
        const filas = (await t.trx
            .from('billing.facturas')
            .where('servicio_id', servicioId)
            .where('empresa_id', empresaId)
            .whereIn('estado', ['emitida', 'parcial', 'vencida'])
            .whereRaw('total > pagado')
            .orderBy([
                { column: 'vence_en', order: 'asc' },
                { column: 'periodo', order: 'asc' },
                { column: 'id', order: 'asc' },
            ])
            .select('id')) as Array<{ id: number }>
        return filas.length > 0 ? filas.map((f) => f.id) : undefined
    }
}
