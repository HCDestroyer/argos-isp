import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ValidacionFallida } from '#shared/errores'
import { CERO, aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import {
    efectivoEnLibro,
    fondoVigente,
    gastosSinReponer,
    leerCajaChica,
    verConteo,
    type ConteoCajaVista,
} from '#ledger/caja_chica'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'

/**
 * `caja_chica.contar` (`POST /cajas/:id/contar`): conteo sorpresa de la caja chica (B9 del plan de
 * contabilidad, §5.7). Lo puede pedir contabilidad sin aviso.
 *
 * - Esperado = el efectivo de la caja en el libro (fondo − gastos sin reponer ± conteos anteriores).
 *   Diferencia = contado − esperado. Con diferencia, el motivo es obligatorio (422) y queda un asiento
 *   `conteo_caja` a cargo del **encargado** de la caja: faltante `Faltantes de caja / Caja chica`,
 *   sobrante `Caja chica / Sobrantes de caja`. Argos no descuenta nada de planilla.
 * - La diferencia queda pendiente hasta la siguiente reposición, que la repone y la sella.
 * - Evento `caja.contada`.
 */

export interface EntradaContarCaja {
    caja_id: number
    contado: string
    motivo?: string | null
}

export default class ContarCaja extends DomainAction<EntradaContarCaja, ConteoCajaVista> {
    readonly nombre = 'caja_chica.contar'

    protected async handle(input: EntradaContarCaja, t: Transaccion): Promise<ConteoCajaVista> {
        t.fijarEntidad('caja', input.caja_id)
        const caja = await leerCajaChica(t.trx, input.caja_id, true)
        exigirAccesoEmpresa(t.ctx, caja.empresa_id)
        t.fijarEmpresa(caja.empresa_id)
        const contado = dec(input.contado)
        if (contado.isNegative() || !tieneCentavosExactos(contado)) {
            throw new ValidacionFallida([
                { field: 'contado', message: 'Monto inválido (≥ 0, 2 decimales)', rule: 'monto' },
            ])
        }
        const esperado = await efectivoEnLibro(t.trx, caja.cuenta_id)
        const diferencia = contado.minus(esperado)
        const motivo = input.motivo?.trim() || null
        if (!diferencia.isZero() && (!motivo || motivo.length < 3)) {
            throw new ValidacionFallida([
                {
                    field: 'motivo',
                    message: `Contaste Q${aTexto(contado)} y debía haber Q${aTexto(esperado)}: el motivo de la diferencia es obligatorio`,
                    rule: 'required',
                },
            ])
        }
        const gastos = await gastosSinReponer(t.trx, caja.id)
        const comprobantes = gastos.reduce((s, g) => s.plus(g.monto), CERO)
        const fecha = hoyGuatemala()
        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.conteos_caja')
            .insert({
                empresa_id: caja.empresa_id,
                caja_id: caja.id,
                esperado: aTexto(esperado),
                contado: aTexto(contado),
                diferencia: aTexto(diferencia),
                comprobantes: aTexto(comprobantes),
                fondo: aTexto(await fondoVigente(t.trx, caja.id)),
                motivo,
                responsable_id: caja.cajero_id,
                contado_por: usuarioDelActor(t.ctx.actor),
                fecha,
            })
            .returning('id')) as Array<{ id: number }>
        const conteoId = Number(fila!.id)

        if (!diferencia.isZero()) {
            const monto = aTexto(diferencia.abs())
            const movimientos: LineaAsiento[] = diferencia.isNegative()
                ? [
                      { cuenta: CUENTAS.FALTANTES_CAJA, debe: monto },
                      { cuenta: caja.cuenta_id, haber: monto },
                  ]
                : [
                      { cuenta: caja.cuenta_id, debe: monto },
                      { cuenta: CUENTAS.SOBRANTES_CAJA, haber: monto },
                  ]
            await new RegistrarAsiento().execute(
                {
                    empresa_id: caja.empresa_id,
                    fecha,
                    descripcion: `Conteo ${conteoId} de la caja chica ${caja.nombre}: ${diferencia.isNegative() ? 'faltante' : 'sobrante'} Q${monto} a cargo del encargado · ${motivo}`,
                    origen_tipo: 'conteo_caja',
                    origen_id: conteoId,
                    movimientos,
                },
                t.ctx,
                { trx: t.trx },
            )
        }
        await t.emit('caja.contada', {
            conteo_id: conteoId,
            empresa_id: caja.empresa_id,
            caja_id: caja.id,
            responsable_id: caja.cajero_id,
            esperado: aTexto(esperado),
            contado: aTexto(contado),
            diferencia: aTexto(diferencia),
        })
        return verConteo(conteoId, t.trx)
    }
}
