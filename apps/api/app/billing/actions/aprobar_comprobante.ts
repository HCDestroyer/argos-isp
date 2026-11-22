import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, Problema } from '#shared/errores'
import { CERO, aTexto, dec } from '#ledger/dinero'
import { bloquearCliente } from '#billing/cobros'
import {
    payloadComprobante,
    verComprobante,
    type CanalComprobante,
    type ComprobanteVista,
    type EstadoComprobante,
} from '#billing/comprobantes'
import RegistrarPago, { type ResultadoRegistrarPago } from '#billing/actions/registrar_pago'
import CumplirPromesa from '#billing/actions/cumplir_promesa'
import { actorIrisDeLaDecision, exigirComprobanteParaIris } from '#billing/iris'

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
 * - Reconexión temporal ligada (contrato Iris 0.6.0 §7.3): se revisa en la misma transacción
 *   (`CumplirPromesa` anidada). Si el pago saldó lo vencido → `promesa.cumplida`; si no, sigue
 *   activa hasta su `hasta` y entonces se incumple como cualquier promesa.
 * - Desde Iris (contrato 0.7.0 §7.7, A23): un operador de Iris aprueba como su usuario de Argos
 *   vinculado (`t.ctx.via`): actor, `registrado_por` del pago y `verificado_por` del comprobante
 *   son ese usuario. Solo comprobantes con `canal = iris` (409 `comprobante_no_es_de_iris`) de
 *   una empresa suya (403 `actor_sin_empresa`), revisado en `bloquearComprobante` con la fila
 *   bloqueada y antes de `comprobante_revisado`. Todo (pago, asiento, reactivación, promesa y
 *   reconexión) sigue en esta única transacción.
 * - Con `canal = iris`, el pago lleva `origen: 'iris'` en `pago.registrado` y el evento del
 *   comprobante `origen: 'iris'`: Iris confirma al cliente y notify no avisa por su cuenta.
 * - `verificado_iris_actor` (contrato Iris 0.7.1): el `X-Iris-Actor` de quien aprobó desde Iris;
 *   null desde el panel. `iris_actor` sigue siendo el de quien lo registró.
 * - **Menos dinero** (decisión del PM 14): el pago se aplica como abono a las facturas más viejas y
 *   la respuesta trae `cobertura` (`deuda` de esas facturas antes del pago, `aplicado` y `falta`).
 *   Después, como siempre, `RegistrarPago` llama `evaluarEstadoServicio`. Si la plantilla de algún
 *   servicio de esas facturas tiene `rechazar_monto_distinto`, un monto distinto de la deuda responde
 *   422 `monto_distinto` (con lo que falta o sobra) y no registra nada: caja lo rechaza con la causa
 *   `monto_distinto`.
 */

export interface EntradaAprobarComprobante {
    comprobante_id: number
    facturas?: number[]
    nota?: string | null
}

export interface CoberturaComprobante {
    /** saldo de las facturas a las que se aplica, antes del pago */
    deuda: string
    /** lo que el pago cubrió de esas facturas */
    aplicado: string
    /** lo que esas facturas siguen debiendo (0.00 si el comprobante las cubrió) */
    falta: string
}

export interface ResultadoAprobarComprobante extends ComprobanteVista {
    pago: ResultadoRegistrarPago
    /** decisión del PM 14: cuánto cubrió y cuánto falta */
    cobertura: CoberturaComprobante
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
    canal: CanalComprobante
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
            'canal',
        )
        .firstOrFail()) as FilaComprobante
    fila.empresa_id = Number(fila.empresa_id)
    // Iris 0.7.0 (A23): con la actuación vinculada, 403 actor_sin_empresa y 409
    // comprobante_no_es_de_iris antes del estado; el panel no cambia
    exigirComprobanteParaIris(t.ctx, fila)
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
        const verificadoIrisActor = actorIrisDeLaDecision(t.ctx)

        const facturas =
            input.facturas && input.facturas.length > 0
                ? input.facturas
                : comprobante.servicio_id
                  ? await this.pendientesDelServicio(t, comprobante.servicio_id, comprobante.empresa_id)
                  : undefined
        const deuda = await this.saldoDe(t, facturas ?? [])
        await this.exigirMontoSiLaPlantillaLoPide(t, comprobante, facturas ?? [], deuda)
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
                ...(comprobante.canal === 'iris' ? { origen: 'iris' as const } : {}),
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
                verificado_iris_actor: verificadoIrisActor,
                verificado_en: t.trx.knexRawQuery('now()'),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'comprobante', id: comprobante.id },
            { estado: comprobante.estado, pago_id: null, verificado_por: null, verificado_iris_actor: null },
            {
                estado: 'aprobado',
                pago_id: pago.id,
                verificado_por: usuarioDelActor(t.ctx.actor),
                verificado_iris_actor: verificadoIrisActor,
            },
        )
        const reconexion = (await t.trx
            .from('billing.promesas')
            .where('comprobante_id', comprobante.id)
            .where('estado', 'activa')
            .select('id')
            .first()) as { id: number } | null
        if (reconexion) {
            await new CumplirPromesa().execute({ promesa_id: reconexion.id }, t.ctx, { trx: t.trx })
            t.fijarEntidad('comprobante', comprobante.id)
            t.fijarEmpresa(comprobante.empresa_id)
        }
        await t.emit('comprobante.aprobado', await payloadComprobante(t.trx, comprobante.id))
        const falta = await this.saldoDe(t, facturas ?? [])
        const cobertura = { deuda: aTexto(deuda), aplicado: aTexto(deuda.minus(falta)), falta: aTexto(falta) }
        if (falta.gt(0)) t.anotarAuditoria({ cobertura })
        return { ...(await verComprobante(comprobante.id, t.trx)), pago, cobertura }
    }

    /** Saldo (total − pagado) de las facturas pendientes de la lista. */
    private async saldoDe(t: Transaccion, ids: number[]) {
        if (ids.length === 0) return CERO
        const fila = (await t.trx
            .from('billing.facturas')
            .whereIn('id', ids)
            .whereIn('estado', ['emitida', 'parcial', 'vencida'])
            .select(t.trx.raw('coalesce(sum(total - pagado), 0)::text as saldo'))
            .first()) as { saldo: string }
        return dec(fila.saldo)
    }

    /**
     * Decisión del PM 14: con `rechazar_monto_distinto` en la plantilla de algún servicio de las
     * facturas (o del comprobante), el monto debe ser exactamente lo que se debe.
     */
    private async exigirMontoSiLaPlantillaLoPide(
        t: Transaccion,
        comprobante: FilaComprobante,
        facturas: number[],
        deuda: ReturnType<typeof dec>,
    ) {
        const servicios = new Set<number>()
        if (comprobante.servicio_id) servicios.add(Number(comprobante.servicio_id))
        if (facturas.length > 0) {
            const filas = (await t.trx
                .from('billing.facturas')
                .whereIn('id', facturas)
                .whereNotNull('servicio_id')
                .distinct('servicio_id')) as Array<{ servicio_id: number }>
            for (const f of filas) servicios.add(Number(f.servicio_id))
        }
        if (servicios.size === 0) return
        const estricta = await t.trx
            .from('core.servicios as s')
            .join('billing.plantillas_facturacion as p', 'p.id', 's.plantilla_facturacion_id')
            .whereIn('s.id', [...servicios])
            .where('p.rechazar_monto_distinto', true)
            .select('s.id')
            .first()
        if (!estricta) return
        const monto = dec(comprobante.monto)
        if (monto.equals(deuda)) return
        const diferencia = monto.lt(deuda)
            ? `faltan Q${aTexto(deuda.minus(monto))}`
            : `sobran Q${aTexto(monto.minus(deuda))}`
        throw new Problema(
            422,
            'monto_distinto',
            'Monto distinto',
            `El comprobante es de Q${aTexto(monto)} y las facturas suman Q${aTexto(deuda)} (${diferencia}); la plantilla pide rechazarlo`,
            [{ field: 'monto', message: diferencia, rule: 'monto_distinto' }],
        )
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
