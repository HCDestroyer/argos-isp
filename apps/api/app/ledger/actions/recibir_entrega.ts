import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, Problema, ValidacionFallida } from '#shared/errores'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { ajustesCajas, saldoCustodia, verEntrega, type EntregaVista } from '#ledger/custodia'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'

/**
 * `cajas.recibir_entrega` (`POST /cajas/entregas/:id/recibir`): «Recibí». Quien recibe cuenta y
 * confirma con **su** usuario (403 `entrega_de_otra_persona`); desde ese momento el efectivo está a su
 * nombre, en custodia. B1 del plan de contabilidad, §5.7.
 *
 * - Asiento `entrega_caja` (origen = la entrega): `1.1.15 Efectivo en custodia` por lo contado / la
 *   caja por lo entregado. La diferencia queda a cargo de **quien entregó** (decisión N8 del PM):
 *   faltante `Faltantes de caja`, sobrante `Sobrantes de caja`; con diferencia el motivo es
 *   obligatorio (422). Argos no descuenta nada de planilla.
 * - `contado` opcional (por defecto, lo entregado). Una sola respuesta por entrega (409
 *   `entrega_resuelta`).
 * - Evento `caja.entrega_recibida` con `sobre_tope` si la persona pasa el tope de custodia (avisa,
 *   no bloquea).
 */

export interface EntradaRecibirEntrega {
    entrega_id: number
    contado?: string | null
    motivo?: string | null
}

export default class RecibirEntrega extends DomainAction<EntradaRecibirEntrega, EntregaVista> {
    readonly nombre = 'cajas.recibir_entrega'

    protected async handle(input: EntradaRecibirEntrega, t: Transaccion): Promise<EntregaVista> {
        t.fijarEntidad('entrega', input.entrega_id)
        const entrega = await entregaParaResponder(t, input.entrega_id)
        const empresaId = entrega.empresa_id

        const monto = dec(entrega.monto)
        const contado =
            input.contado === undefined || input.contado === null || input.contado === ''
                ? monto
                : dec(input.contado)
        if (contado.isNegative() || !tieneCentavosExactos(contado)) {
            throw new ValidacionFallida([
                { field: 'contado', message: 'Monto inválido (≥ 0, 2 decimales)', rule: 'monto' },
            ])
        }
        const diferencia = contado.minus(monto)
        const motivo = input.motivo?.trim() || null
        if (!diferencia.isZero() && (!motivo || motivo.length < 3)) {
            throw new ValidacionFallida([
                {
                    field: 'motivo',
                    message: `Contaste Q${aTexto(contado)} y te entregan Q${aTexto(monto)}: el motivo de la diferencia es obligatorio`,
                    rule: 'required',
                },
            ])
        }
        const usuario = usuarioDelActor(t.ctx.actor)!
        const fecha = hoyGuatemala()
        await t.trx
            .insertQuery()
            .table('ledger.entregas_recepciones')
            .insert({
                entrega_id: entrega.id,
                empresa_id: empresaId,
                resultado: 'recibida',
                recibido_por: usuario,
                contado: aTexto(contado),
                diferencia: aTexto(diferencia),
                motivo,
                fecha,
            })

        const caja = (await t.trx
            .from('ledger.cajas')
            .where('id', entrega.caja_id)
            .select('cuenta_id')
            .firstOrFail()) as { cuenta_id: number }
        const quien = entrega.entregado_por_nombre ?? `usuario ${entrega.entregado_por ?? '—'}`
        const movimientos: LineaAsiento[] = []
        if (contado.gt(0)) {
            movimientos.push({ cuenta: CUENTAS_GT.EFECTIVO_EN_CUSTODIA, debe: aTexto(contado) })
        }
        if (diferencia.isNegative()) {
            movimientos.push({ cuenta: CUENTAS.FALTANTES_CAJA, debe: aTexto(diferencia.abs()) })
        }
        movimientos.push({ cuenta: Number(caja.cuenta_id), haber: aTexto(monto) })
        if (diferencia.gt(0)) movimientos.push({ cuenta: CUENTAS.SOBRANTES_CAJA, haber: aTexto(diferencia) })
        const detalleDiferencia = diferencia.isZero()
            ? ''
            : ` · ${diferencia.isNegative() ? 'faltante' : 'sobrante'} Q${aTexto(diferencia.abs())} a cargo de ${quien}: ${motivo}`
        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha,
                descripcion: `Entrega ${entrega.id} de ${entrega.caja_nombre} (turno ${entrega.turno_id}) recibida por ${entrega.recibe_nombre ?? `usuario ${usuario}`}${detalleDiferencia}`,
                origen_tipo: 'entrega_caja',
                origen_id: entrega.id,
                movimientos,
            },
            t.ctx,
            { trx: t.trx },
        )

        const ajustes = await ajustesCajas(empresaId, t.trx)
        const saldo = await saldoCustodia(t.trx, empresaId, usuario)
        await t.emit('caja.entrega_recibida', {
            entrega_id: entrega.id,
            empresa_id: empresaId,
            caja_id: entrega.caja_id,
            entregado_por: entrega.entregado_por,
            recibido_por: usuario,
            monto: aTexto(monto),
            contado: aTexto(contado),
            diferencia: aTexto(diferencia),
            custodia: aTexto(saldo),
            sobre_tope: saldo.gt(ajustes.custodia_tope),
        })
        return verEntrega(entrega.id, t.trx)
    }
}

/** La entrega por recibir, bloqueada, de la empresa del actor y dirigida a él. */
export async function entregaParaResponder(t: Transaccion, entregaId: number): Promise<EntregaVista> {
    const fila = await t.trx.from('ledger.entregas').where('id', entregaId).forUpdate().select('id').first()
    if (!fila) throw new NoEncontrado(`La entrega ${entregaId} no existe`)
    const entrega = await verEntrega(entregaId, t.trx)
    exigirAccesoEmpresa(t.ctx, entrega.empresa_id)
    t.fijarEmpresa(entrega.empresa_id)
    if (entrega.estado !== 'por_recibir') {
        throw new Conflicto(
            `La entrega ${entrega.id} ya está ${entrega.estado}`,
            'entrega_resuelta',
            'Entrega ya respondida',
        )
    }
    const usuario = usuarioDelActor(t.ctx.actor)
    if (usuario === null || usuario !== entrega.recibe_id) {
        throw new Problema(
            403,
            'entrega_de_otra_persona',
            'La entrega es para otra persona',
            `La entrega ${entrega.id} es para ${entrega.recibe_nombre ?? `el usuario ${entrega.recibe_id}`}: solo esa persona dice «Recibí»`,
        )
    }
    return entrega
}
