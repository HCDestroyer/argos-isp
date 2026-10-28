import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { bloqueoVigente, impedimentoConExcepcion, type TipoBloqueo } from '#ledger/bloqueos'
import { diarioDeAsiento } from '#ledger/diarios'
import { bloquearCliente } from '#billing/cobros'
import { claveMora, crearMora, morasDebidas, reglaMora, type FacturaConMora } from '#billing/mora'
import { venceEfectivoSql } from '#billing/vencimiento'

/**
 * `facturas.vencer`: vence UNA factura de servicio y le aplica la mora que corresponda a `hoy`.
 * La llama `vencerFacturas` (cron y `POST /facturas/vencer`), una transacción por factura.
 *
 * - `emitida`/`parcial` con vencimiento efectivo < hoy (`venceEfectivoSql`: `vence_en`, que ya trae
 *   la gracia, o, si se emitió con el servicio pendiente de instalación, `max(vence_en, día de
 *   instalado_en + dias_gracia)`) → `vencida`,
 *   `vencida_en = now()`, evento `factura.vencida`.
 * - Si sigue vencida, crea los recargos de mora pendientes según el `reglas_snapshot` de la
 *   factura (`mora.ts`): el primero al vencer y, con `mora_recurrente`, uno por mes.
 * - Idempotente: una factura ya vencida no vuelve a emitir el evento; los recargos tienen clave.
 * - Bloqueo del libro (fase 6): si el asiento de la mora (hoy, diario de ventas, con impuesto)
 *   cae bajo un bloqueo, la factura igual se vence y la mora queda pendiente (`mora_bloqueada`):
 *   la siguiente corrida la crea.
 * - No decide el estado del servicio: eso lo hace el cron de corte a la `hora_corte`.
 */

export interface EntradaVencerFactura {
    factura_id: number
    /** día de referencia (YYYY-MM-DD, Guatemala) */
    hoy: string
}

export interface ResultadoVencerFactura {
    factura_id: number
    empresa_id: number
    vencida: boolean
    moras: number[]
    /** la mora debida no se creó porque su asiento cae bajo un bloqueo del libro */
    mora_bloqueada: { tipo: TipoBloqueo; hasta: string | null; fecha: string } | null
}

interface FilaFactura extends FacturaConMora {
    tipo: 'servicio' | 'mora'
    estado: string
    /** `venceEfectivoSql`: decide vencer y mora; `vence_en` sigue siendo el del documento */
    vence_efectivo: string
    servicio_pendiente: boolean
}

export default class VencerFactura extends DomainAction<EntradaVencerFactura, ResultadoVencerFactura> {
    readonly nombre = 'facturas.vencer'

    protected async handle(input: EntradaVencerFactura, t: Transaccion): Promise<ResultadoVencerFactura> {
        const hoy = fechaValida(input.hoy, 'hoy')
        t.fijarEntidad('factura', input.factura_id)
        const previa = await t.trx
            .from('billing.facturas')
            .where('id', input.factura_id)
            .select('cliente_id')
            .first()
        if (!previa) throw new NoEncontrado(`La factura ${input.factura_id} no existe`)
        await bloquearCliente(t.trx, previa.cliente_id)

        const factura = (await t.trx
            .from('billing.facturas as f')
            .where('f.id', input.factura_id)
            .forUpdate()
            .select(
                'f.id',
                'f.empresa_id',
                'f.cliente_id',
                'f.servicio_id',
                'f.tipo',
                'f.estado',
                'f.total',
                'f.reglas_snapshot',
                t.trx.raw(`to_char(f.periodo, 'YYYY-MM-DD') as periodo`),
                t.trx.raw(`to_char(f.vence_en, 'YYYY-MM-DD') as vence_en`),
                t.trx.raw(`to_char(${venceEfectivoSql('f')}, 'YYYY-MM-DD') as vence_efectivo`),
                t.trx.raw(
                    `EXISTS (SELECT 1 FROM core.servicios s WHERE s.id = f.servicio_id AND s.estado = 'pendiente_instalacion') as servicio_pendiente`,
                ),
            )
            .firstOrFail()) as FilaFactura
        factura.empresa_id = Number(factura.empresa_id)
        t.fijarEmpresa(factura.empresa_id)
        const resultado: ResultadoVencerFactura = {
            factura_id: factura.id,
            empresa_id: factura.empresa_id,
            vencida: false,
            moras: [],
            mora_bloqueada: null,
        }
        if (factura.tipo !== 'servicio') return resultado
        // un pendiente de instalación no vence ni recibe mora (`contratos/instalacion.md` §3)
        if (factura.servicio_pendiente) return resultado

        if ((factura.estado === 'emitida' || factura.estado === 'parcial') && factura.vence_efectivo < hoy) {
            await t.trx
                .from('billing.facturas')
                .where('id', factura.id)
                .update({
                    estado: 'vencida',
                    vencida_en: t.trx.knexRawQuery('now()'),
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            factura.estado = 'vencida'
            resultado.vencida = true
            await t.emit('factura.vencida', {
                factura_id: factura.id,
                empresa_id: factura.empresa_id,
                servicio_id: factura.servicio_id,
                cliente_id: factura.cliente_id,
                total: factura.total,
                vence: factura.vence_en,
            })
        }
        if (factura.estado !== 'vencida') return resultado

        const debidas = morasDebidas(reglaMora(factura.reglas_snapshot), factura.vence_efectivo, hoy)
        if (debidas === 0) return resultado
        const claves = Array.from({ length: debidas }, (_, i) => claveMora(factura.id, i + 1))
        const existentes = new Set(
            (
                (await t.trx
                    .from('billing.facturas')
                    .whereIn('clave_unica', claves)
                    .select('clave_unica')) as Array<{ clave_unica: string }>
            ).map((f) => f.clave_unica),
        )
        if (existentes.size < debidas) {
            const fecha = hoyGuatemala()
            const diario = await diarioDeAsiento(t.trx, factura.empresa_id, 'mora', [])
            const { tipo } = await impedimentoConExcepcion(t.trx, {
                fecha,
                empresaId: factura.empresa_id,
                diarioId: diario.id,
                origen: 'mora',
                conImpuesto: true,
                usuarioId: null,
            })
            if (tipo !== null && tipo !== 'cerrado') {
                resultado.mora_bloqueada = {
                    tipo,
                    hasta: await bloqueoVigente(t.trx, factura.empresa_id, tipo),
                    fecha,
                }
                return resultado
            }
        }
        for (let n = 1; n <= debidas; n++) {
            if (existentes.has(claveMora(factura.id, n))) continue
            const moraId = await crearMora(t, factura, n, hoy)
            if (moraId) resultado.moras.push(moraId)
        }
        return resultado
    }
}
