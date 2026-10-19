import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, Problema, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { aTexto, dec } from '#ledger/dinero'
import { inicioDeMes } from '#ledger/fechas'
import { movimientosCompra, verCompra, type CompraVista } from '#ledger/compras'
import {
    documentoCompra,
    insertarCompra,
    prepararCompra,
    type DatosDocumentoCompra,
} from '#ledger/preparar_compra'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { altasDeLaCompra } from '#ledger/altas_compra'

/**
 * `compras.registrar_desde_egreso` (`POST /compras/desde-egreso/:egreso_id`, permiso
 * `compras.registrar`): pasa al libro de compras un egreso ya registrado que tenía factura
 * (contrato de localización fiscal §3.4, punto 3, y §12.6), **sin duplicar** su asiento.
 *
 * - El egreso sigue vigente y su asiento no se toca (regla 4). La compra (`egreso_id`, al contado)
 *   lleva un asiento de **reclasificación** (origen `compra`): `Gasto/Activo de cada línea (+ IVA
 *   si no hay crédito) + 1.1.04 IVA crédito / cuenta de la categoría del egreso (lo que salió) +
 *   retenciones`. En el caso común (una línea a la misma cuenta) el efecto neto es `1.1.04 / Gasto`
 *   por el IVA; las partidas de la cuenta del egreso quedan por separado para conservar sus
 *   etiquetas de base.
 * - El neto de la compra (total − retenciones) debe ser lo que pagó el egreso (422
 *   `compra_distinta_del_egreso`).
 * - Dentro de la ventana del crédito fiscal; si no, la compra entra con `credito_fiscal = false`
 *   (sin 422), salvo que se pida el crédito expresamente.
 * - Un egreso pasa a compra una vez (409 `egreso_con_compra`; anulada la compra, se puede volver a
 *   registrar). El egreso de una compra al contado ya es una compra (409 `egreso_de_compra`). Un
 *   egreso anulado: 409 `egreso_anulado`.
 * - Emite `compra.registrada`.
 */

export interface EntradaCompraDesdeEgreso extends DatosDocumentoCompra {
    egreso_id: number
}

export default class RegistrarCompraDesdeEgreso extends DomainAction<EntradaCompraDesdeEgreso, CompraVista> {
    readonly nombre = 'compras.registrar_desde_egreso'

    protected async handle(input: EntradaCompraDesdeEgreso, t: Transaccion): Promise<CompraVista> {
        t.fijarEntidad('egreso', input.egreso_id)
        const egreso = (await t.trx
            .from('ledger.egresos as e')
            .join('ledger.egresos_categorias as ec', 'ec.id', 'e.categoria_id')
            .where('e.id', input.egreso_id)
            .select(
                'e.id',
                'e.empresa_id',
                t.trx.raw(`to_char(e.fecha, 'YYYY-MM-DD') as fecha`),
                'e.monto',
                'e.compra_id',
                'ec.cuenta_id',
            )
            .first()) as {
            id: number
            empresa_id: number
            fecha: string
            monto: string
            compra_id: number | null
            cuenta_id: number
        } | null
        if (!egreso) throw new NoEncontrado(`El egreso ${input.egreso_id} no existe`)
        exigirAccesoEmpresa(t.ctx, Number(egreso.empresa_id))
        // un egreso, una compra vigente: dos altas simultáneas esperan aquí
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [3011, egreso.id])
        if (egreso.compra_id) {
            throw new Conflicto(
                `El egreso ${egreso.id} es el pago de la compra ${egreso.compra_id}`,
                'egreso_de_compra',
                'Egreso de una compra',
            )
        }
        const anulado = await t.trx.from('ledger.egresos_anulaciones').where('egreso_id', egreso.id).first()
        if (anulado) {
            throw new Conflicto(`El egreso ${egreso.id} está anulado`, 'egreso_anulado', 'Egreso anulado')
        }
        const previa = await t.trx
            .from('ledger.compras as c')
            .where('c.egreso_id', egreso.id)
            .whereNotExists((q) => q.from('ledger.compras_anulaciones as x').whereRaw('x.compra_id = c.id'))
            .select('c.id')
            .first()
        if (previa) {
            throw new Conflicto(
                `El egreso ${egreso.id} ya está registrado como la compra ${previa.id}`,
                'egreso_con_compra',
                'Egreso con compra',
            )
        }
        if (input.tipo_documento === 'NCRE') {
            throw new ValidacionFallida([
                {
                    field: 'tipo_documento',
                    message: 'Un egreso no es una nota de crédito',
                    rule: 'no_aplica',
                },
            ])
        }

        const compra = await prepararCompra(t, input, {
            periodoMinimo: inicioDeMes(egreso.fecha),
            sinCreditoFueraDeVentana: true,
        })
        if (compra.empresaId !== Number(egreso.empresa_id)) {
            throw new ValidacionFallida([
                {
                    field: 'proveedor_id',
                    message: `El egreso es de la empresa ${egreso.empresa_id} y el proveedor de la ${compra.empresaId}`,
                    rule: 'proveedor_de_otra_empresa',
                },
            ])
        }
        if (!compra.neto.equals(dec(egreso.monto))) {
            throw new Problema(
                422,
                'compra_distinta_del_egreso',
                'La compra no es el egreso',
                `El egreso ${egreso.id} pagó Q${aTexto(egreso.monto)} y la compra deja Q${aTexto(compra.neto)} para el proveedor (total − retenciones)`,
                [
                    {
                        field: 'lineas',
                        message: `Debe sumar Q${aTexto(egreso.monto)} neto de retenciones`,
                        rule: 'compra_distinta_del_egreso',
                    },
                ],
            )
        }

        const compraId = await insertarCompra(
            t,
            compra,
            { condicion: 'contado', vence_en: null, egreso_id: egreso.id },
            usuarioDelActor(t.ctx.actor),
        )
        t.fijarEntidad('compra', compraId)
        const altas = await altasDeLaCompra(t, compraId, compra, input.lineas)
        await new RegistrarAsiento().execute(
            {
                empresa_id: compra.empresaId,
                fecha: compra.fecha,
                descripcion: `Compra ${compraId} desde el egreso ${egreso.id} · ${documentoCompra(compra)} · ${compra.proveedor.nombre} (reclasificación)`,
                origen_tipo: 'compra',
                origen_id: compraId,
                movimientos: movimientosCompra({
                    tipo_documento: compra.tipo,
                    lineas: compra.lineas,
                    credito_fiscal: compra.credito,
                    iva: compra.totales.iva,
                    retenciones: compra.retenciones,
                    contrapartida: { cuenta: Number(egreso.cuenta_id), proveedor_id: null },
                    neto: compra.neto,
                    cuentaDe: altas.cuentaDe,
                }),
            },
            t.ctx,
            { trx: t.trx },
        )
        await altas.despuesDelAsiento()
        await t.emit('compra.registrada', {
            compra_id: compraId,
            empresa_id: compra.empresaId,
            proveedor_id: compra.proveedor.id,
            total: aTexto(compra.totales.total),
            iva: aTexto(compra.totales.iva),
            periodo_iva: compra.periodoIva.slice(0, 7),
        })
        return verCompra(compraId, t.trx)
    }
}
