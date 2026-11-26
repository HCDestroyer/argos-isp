import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { D, aTexto, dec, tieneCentavosExactos, type Dec } from '#ledger/dinero'
import { fondoFijoDe } from '#ledger/custodia'
import EntregarCaja from '#ledger/actions/entregar_caja'
import { CUENTAS } from '#ledger/plan_cuentas'
import { verTurno, type TurnoVista } from '#ledger/cajas'
import {
    DENOMINACIONES,
    esperadoDelTurno,
    totalDenominaciones,
    type LineaDenominacion,
} from '#ledger/resumen_turno'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'

/**
 * `cajas.cerrar` (`POST /cajas/:id/cerrar`): cierra el turno abierto de la caja.
 *
 * - `esperado = fondo_inicial + Σ efectivo de los pagos vigentes (no anulados) del turno − Σ egresos
 *   en efectivo vigentes del turno − Σ depósitos al banco del turno` (`cajas.depositar`, fase 4);
 *   el efectivo de un pago es `monto − retenido` (constancias de retención, fase 5) y también se
 *   restan los pagos a proveedores en efectivo del turno (`compras.pagar`, fase 5);
 *   `diferencia = contado − esperado`.
 * - Diferencia ≠ 0 exige `motivo` (422) y deja asiento `cierre_caja` (origen = turno):
 *   faltante `Faltantes de caja / Caja`; sobrante `Caja / Sobrantes de caja`.
 * - Evento `caja.cerrada` con `cajero_id` = el cajero asignado a la caja o quien abrió el turno.
 * - 409 `sin_turno_abierto` si la caja no tiene turno abierto. El turno se bloquea: un cobro en
 *   curso termina antes del cierre y los siguientes ya no entran a este turno.
 * - Rediseño (`a4.md`, 21 nov): `denominaciones` (Q200 … 1¢, cantidades enteras; sin `contado`, el
 *   contado es su suma; con los dos, deben coincidir: 422 `denominaciones`), `fondo_siguiente` (lo que
 *   queda para abrir el próximo turno, ≤ contado) y `entregado_a` (quién recibe el resto; obligatorio si
 *   el resto es > 0). El esperado sale de `#ledger/resumen_turno` (la misma regla del resumen del turno).
 * - B1 del plan de contabilidad (§5.7, corrige E1): con `entregado_a`, el resto se **entrega** a esa
 *   persona (`cajas.entregar` anidada, documento `ledger.entregas`). Sin `fondo_siguiente`, queda el
 *   fondo fijo de la caja (o todo, si se contó menos). La entrega tiene asiento cuando quien recibe
 *   dice «Recibí» (`1.1.15 Efectivo en custodia / Caja`); con «lo deposito yo» (`entregado_a` = quien
 *   cierra) se recibe en el acto. Sin `entregado_a` ni `fondo_siguiente`, todo queda en la caja
 *   (como antes) y el turno siguiente abre con lo contado.
 */

export interface EntradaCerrarCaja {
    caja_id: number
    contado?: string | null
    motivo?: string | null
    denominaciones?: LineaDenominacion[] | null
    fondo_siguiente?: string | null
    entregado_a?: number | null
}

export default class CerrarCaja extends DomainAction<EntradaCerrarCaja, TurnoVista> {
    readonly nombre = 'cajas.cerrar'

    protected async handle(input: EntradaCerrarCaja, t: Transaccion): Promise<TurnoVista> {
        t.fijarEntidad('caja', input.caja_id)
        const contado = await this.contado(input, t)
        const caja = (await t.trx
            .from('ledger.cajas')
            .where('id', input.caja_id)
            .select('id', 'empresa_id', 'nombre', 'cuenta_id', 'cajero_id', 'fondo_fijo')
            .first()) as {
            id: number
            empresa_id: number
            nombre: string
            cuenta_id: number
            cajero_id: number | null
            fondo_fijo: string | null
        } | null
        if (!caja) throw new NoEncontrado(`La caja ${input.caja_id} no existe`)
        // el cierre es por empresa: el asiento de la diferencia va al libro de la caja
        const empresaId = Number(caja.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const turno = (await t.trx
            .from('ledger.cajas_turnos')
            .where('caja_id', caja.id)
            .whereNull('cerrado_en')
            .forUpdate()
            .select('id', 'fondo_inicial', 'abierto_por')
            .first()) as { id: number; fondo_inicial: string; abierto_por: number | null } | null
        if (!turno) {
            throw new Conflicto(
                `La caja ${caja.id} no tiene turno abierto`,
                'sin_turno_abierto',
                'Sin turno abierto',
            )
        }
        t.fijarEntidad('caja_turno', turno.id)

        const esperado = await esperadoDelTurno(t.trx, turno.id)
        const diferencia = contado.minus(esperado)
        const motivo = input.motivo?.trim() || null
        if (!diferencia.isZero() && !motivo) {
            throw new ValidacionFallida([
                {
                    field: 'motivo',
                    message: `Hay una diferencia de Q${aTexto(diferencia)} (esperado Q${aTexto(esperado)}, contado Q${aTexto(contado)}): el motivo es obligatorio`,
                    rule: 'required',
                },
            ])
        }

        const fondoFijo = await fondoFijoDe(t.trx, { empresa_id: empresaId, fondo_fijo: caja.fondo_fijo })
        const entrega = await this.entrega(input, contado, fondoFijo, t)
        await t.trx
            .from('ledger.cajas_turnos')
            .where('id', turno.id)
            .update({
                cerrado_en: t.trx.knexRawQuery('greatest(now(), abierto_en)'),
                esperado: aTexto(esperado),
                contado: aTexto(contado),
                diferencia: aTexto(diferencia),
                motivo,
                cerrado_por: usuarioDelActor(t.ctx.actor),
                denominaciones: input.denominaciones?.length
                    ? JSON.stringify(ordenarDenominaciones(input.denominaciones))
                    : null,
                fondo_siguiente: entrega ? aTexto(entrega.fondo) : null,
                entregado_monto: entrega ? aTexto(contado.minus(entrega.fondo)) : null,
                entregado_a: entrega?.a ?? null,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)

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
                    empresa_id: empresaId,
                    descripcion: `Cierre del turno ${turno.id} de ${caja.nombre}: ${diferencia.isNegative() ? 'faltante' : 'sobrante'} Q${monto} · ${motivo}`,
                    origen_tipo: 'cierre_caja',
                    origen_id: turno.id,
                    movimientos,
                },
                t.ctx,
                { trx: t.trx },
            )
        }

        if (entrega?.a && contado.minus(entrega.fondo).gt(0)) {
            await new EntregarCaja().execute(
                { turno_id: Number(turno.id), entregado_a: entrega.a, origen: 'cierre' },
                t.ctx,
                { trx: t.trx },
            )
        }

        await t.emit('caja.cerrada', {
            caja_id: caja.id,
            empresa_id: empresaId,
            cajero_id: caja.cajero_id ?? turno.abierto_por,
            esperado: aTexto(esperado),
            contado: aTexto(contado),
            diferencia: aTexto(diferencia),
        })
        return verTurno(turno.id, t.trx)
    }

    /** Contado del cierre: el total escrito, la suma de las denominaciones, o los dos si coinciden. */
    private async contado(input: EntradaCerrarCaja, _t: Transaccion) {
        const lineas = input.denominaciones ?? []
        const vistas = new Set<string>()
        for (const [i, l] of lineas.entries()) {
            if (!(DENOMINACIONES as readonly string[]).includes(l.valor)) {
                throw new ValidacionFallida([
                    {
                        field: `denominaciones.${i}.valor`,
                        message: `Denominación inválida (${DENOMINACIONES.join(', ')})`,
                        rule: 'enum',
                    },
                ])
            }
            if (vistas.has(l.valor)) {
                throw new ValidacionFallida([
                    {
                        field: `denominaciones.${i}.valor`,
                        message: 'Denominación repetida',
                        rule: 'distinct',
                    },
                ])
            }
            vistas.add(l.valor)
        }
        const suma = lineas.length > 0 ? totalDenominaciones(lineas) : null
        if (input.contado === undefined || input.contado === null || input.contado === '') {
            if (!suma) {
                throw new ValidacionFallida([
                    { field: 'contado', message: 'Indica el contado o las denominaciones', rule: 'required' },
                ])
            }
            return suma
        }
        const contado = dec(input.contado)
        if (contado.isNegative() || !tieneCentavosExactos(contado)) {
            throw new ValidacionFallida([
                { field: 'contado', message: 'Monto inválido (≥ 0, 2 decimales)', rule: 'monto' },
            ])
        }
        if (suma && !suma.eq(contado)) {
            throw new ValidacionFallida([
                {
                    field: 'contado',
                    message: `El contado (Q${aTexto(contado)}) no es la suma de las denominaciones (Q${aTexto(suma)})`,
                    rule: 'denominaciones',
                },
            ])
        }
        return contado
    }

    /** Fondo para el turno siguiente y a quién se entrega el resto (null si no se indicó). */
    private async entrega(input: EntradaCerrarCaja, contado: Dec, fondoFijo: Dec, t: Transaccion) {
        if (input.fondo_siguiente === undefined || input.fondo_siguiente === null) {
            // sin entrega, todo queda en la caja (como antes de B1)
            if (!input.entregado_a) return null
        }
        // B1: sin fondo escrito, queda el fondo fijo (o todo lo contado si no alcanza)
        const fondo =
            input.fondo_siguiente === undefined || input.fondo_siguiente === null
                ? D.min(fondoFijo, contado)
                : dec(input.fondo_siguiente)
        if (fondo.isNegative() || !tieneCentavosExactos(fondo) || fondo.gt(contado)) {
            throw new ValidacionFallida([
                {
                    field: 'fondo_siguiente',
                    message: `El fondo para el turno siguiente va de Q0.00 al contado (Q${aTexto(contado)})`,
                    rule: 'monto',
                },
            ])
        }
        const resto = contado.minus(fondo)
        if (resto.gt(0) && !input.entregado_a) {
            throw new ValidacionFallida([
                {
                    field: 'entregado_a',
                    message: `Indica a quién se entregan los Q${aTexto(resto)} que no quedan de fondo`,
                    rule: 'required',
                },
            ])
        }
        if (input.entregado_a) {
            const usuario = await t.trx
                .from('core.usuarios')
                .where({ id: input.entregado_a, activo: true })
                .select('id')
                .first()
            if (!usuario) {
                throw new ValidacionFallida([
                    { field: 'entregado_a', message: 'Usuario inexistente o inactivo', rule: 'exists' },
                ])
            }
        }
        return { fondo, a: input.entregado_a ?? null }
    }
}

function ordenarDenominaciones(lineas: LineaDenominacion[]): LineaDenominacion[] {
    return [...lineas]
        .filter((l) => l.cantidad > 0)
        .sort((a, b) => DENOMINACIONES.indexOf(a.valor) - DENOMINACIONES.indexOf(b.valor))
        .map((l) => ({ valor: l.valor, cantidad: l.cantidad }))
}
