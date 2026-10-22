import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { bloqueoReversoDirecto } from '#ledger/reversos'
import RegistrarAsiento, {
    type AsientoRegistrado,
    type OrigenAsiento,
} from '#ledger/actions/registrar_asiento'

/**
 * `revertirAsiento`: la única forma de corregir el libro. Crea un asiento espejo (debe ↔ haber,
 * mismas cuentas y clientes, mismo origen) que apunta al original con `reversa_de`.
 *
 * - Motivo obligatorio.
 * - Un asiento se revierte una sola vez; un reverso no se revierte.
 * - La fecha del reverso es hoy (Guatemala) salvo que se indique; nunca anterior al original y
 *   nunca en un periodo cerrado (422 `periodo_cerrado`). Un asiento de un mes cerrado se revierte,
 *   por eso, con la fecha de hoy (o de otro mes abierto).
 * - Directo (endpoint) solo se revierten asientos sin documento (cierre de caja, ajuste manual);
 *   los de factura, mora, pago, nota de crédito, egreso o saldo inicial responden 422
 *   `reverso_por_documento` con la acción que corresponde (`#ledger/reversos`). Las acciones de
 *   anulación de esos documentos llaman esta acción con `por_anulacion: true`.
 */

export interface EntradaReverso {
    asiento_id: number
    motivo: string
    fecha?: string
    /** solo desde la anulación del documento dueño del asiento (anular pago, factura, egreso…) */
    por_anulacion?: boolean
    /**
     * copia la etiqueta de impuesto de cada partida con el signo contrario (fase 5, compras). Desde
     * la fase 7 PR B es lo que hace siempre (`false` solo la omite a propósito): un reverso resta en
     * las cuadrículas lo que su original sumó (§10.2).
     */
    invertir_etiquetas?: boolean
}

export default class RevertirAsiento extends DomainAction<EntradaReverso, AsientoRegistrado> {
    readonly nombre = 'libro.revertir_asiento'

    protected async handle(input: EntradaReverso, t: Transaccion): Promise<AsientoRegistrado> {
        const original = (await t.trx
            .from('ledger.asientos')
            .where('id', input.asiento_id)
            // Sin FOR UPDATE: el rol de la app no tiene UPDATE sobre el libro. Dos reversos
            // simultáneos los resuelve el índice único `asientos_reversa_unica` (→ 409).
            .select(
                'id',
                'empresa_id',
                t.trx.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`),
                'origen_tipo',
                'origen_id',
                'reversa_de',
                'descripcion',
            )
            .first()) as {
            id: number
            empresa_id: number
            fecha: string
            origen_tipo: OrigenAsiento
            origen_id: number | null
            reversa_de: number | null
            descripcion: string
        } | null
        if (!original) throw new NoEncontrado(`El asiento ${input.asiento_id} no existe`)
        t.fijarEntidad('asiento', original.id)
        // el reverso va al libro de la empresa del original (403 si está fuera del alcance)
        exigirAccesoEmpresa(t.ctx, Number(original.empresa_id))
        t.fijarEmpresa(Number(original.empresa_id))

        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                {
                    field: 'motivo',
                    message: 'El motivo es obligatorio (mínimo 3 caracteres)',
                    rule: 'motivo',
                },
            ])
        }
        if (original.reversa_de !== null) {
            throw new ReglaNegocio(
                `El asiento ${original.id} ya es un reverso (de ${original.reversa_de}); no se revierte`,
                'asiento_es_reverso',
            )
        }
        if (!input.por_anulacion) {
            const bloqueo = bloqueoReversoDirecto(original.id, original.origen_tipo, original.origen_id)
            if (bloqueo) throw new ReglaNegocio(bloqueo.mensaje, bloqueo.codigo)
        }
        const yaRevertido = await t.trx.from('ledger.asientos').where('reversa_de', original.id).first()
        if (yaRevertido) {
            throw new ReglaNegocio(
                `El asiento ${original.id} ya fue revertido por el asiento ${yaRevertido.id}`,
                'asiento_revertido',
            )
        }

        // sin fecha: hoy, o la del original si es posterior (un asiento con fecha futura)
        const hoy = hoyGuatemala()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy < original.fecha ? original.fecha : hoy
        if (fecha < original.fecha) {
            throw new ValidacionFallida([
                {
                    field: 'fecha',
                    message: `El reverso no puede ser anterior al asiento original (${original.fecha})`,
                    rule: 'fecha',
                },
            ])
        }

        const movimientos = (await t.trx
            .from('ledger.movimientos')
            .where('asiento_id', original.id)
            .orderBy('id', 'asc')
            .select(
                'cuenta_id',
                'debe',
                'haber',
                'cliente_id',
                'proveedor_id',
                'impuesto_codigo',
                'cuadricula',
            )) as Array<{
            cuenta_id: number
            debe: string
            haber: string
            cliente_id: number | null
            proveedor_id: number | null
            impuesto_codigo: string | null
            cuadricula: string | null
        }>

        // el reverso va al mismo diario que su original (con el número que le toque hoy)
        const diario = (await t.trx
            .from('ledger.asientos_numeros as n')
            .join('ledger.diarios as d', 'd.id', 'n.diario_id')
            .where('n.asiento_id', original.id)
            .select('d.codigo')
            .first()) as { codigo: string } | null

        return new RegistrarAsiento().execute(
            {
                empresa_id: Number(original.empresa_id),
                fecha,
                descripcion: `Reverso del asiento ${original.id}: ${motivo}`,
                origen_tipo: original.origen_tipo,
                origen_id: original.origen_id,
                reversa_de: original.id,
                diario: diario?.codigo ?? null,
                movimientos: movimientos.map((m) => ({
                    cuenta: m.cuenta_id,
                    debe: m.haber,
                    haber: m.debe,
                    cliente_id: m.cliente_id,
                    proveedor_id: m.proveedor_id === null ? null : Number(m.proveedor_id),
                    // el reverso lleva la etiqueta con el signo contrario: el libro y las cuadrículas
                    // restan la anulación en su mes (§10.2; compras desde la fase 5, todo desde la 7)
                    ...(input.invertir_etiquetas !== false && m.cuadricula
                        ? {
                              impuesto_codigo: m.impuesto_codigo,
                              cuadricula: `${m.cuadricula.startsWith('+') ? '-' : '+'}${m.cuadricula.slice(1)}`,
                          }
                        : {}),
                })),
            },
            t.ctx,
            { trx: t.trx },
        )
    }
}
