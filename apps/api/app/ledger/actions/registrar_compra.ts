import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { ValidacionFallida } from '#shared/errores'
import { aTexto } from '#ledger/dinero'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { resolverOrigenEgreso, type MetodoEgreso } from '#ledger/egresos'
import { movimientosCompra, verCompra, type CompraVista, type CondicionCompra } from '#ledger/compras'
import {
    documentoCompra,
    insertarCompra,
    prepararCompra,
    venceCompra,
    type CompraPreparada,
    type DatosDocumentoCompra,
} from '#ledger/preparar_compra'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { altasDeLaCompra } from '#ledger/altas_compra'

/**
 * `compras.registrar` (`POST /compras`): la factura (u otro documento) de un proveedor, de solo
 * inserción (contrato de localización fiscal §3.4). Validación y cálculo en
 * `#ledger/preparar_compra`.
 *
 * - **Al contado** (`metodo` + caja, banco o cuenta bancaria, como los egresos): en la misma
 *   transacción crea el egreso que la paga (`egresos.compra_id`) por el neto. Hay un solo asiento,
 *   el de la compra: `Gasto/Activo + 1.1.04 / Caja|Banco + retenciones`.
 * - **Al crédito**: `Gasto/Activo + 1.1.04 / 2.1.03 Proveedores (auxiliar) + retenciones`; vence
 *   en `vence_en` o en la fecha del documento más los días de crédito del proveedor. Se paga con
 *   `compras.pagar`.
 * - **NCRE** del proveedor: siempre contra la CxP de la compra que corrige (al revés).
 * - Líneas `activo_fijo` dan de alta su activo y las que traen `diferir_meses` su diferimiento, en
 *   la misma transacción (`#ledger/altas_compra`).
 * - Emite `compra.registrada`.
 */

export interface EntradaRegistrarCompra extends DatosDocumentoCompra {
    condicion: CondicionCompra
    vence_en?: string | null
    metodo?: MetodoEgreso | null
    caja_id?: number | null
    banco_id?: number | null
    cuenta_bancaria_id?: number | null
}

/** Categoría de egreso del pago al contado: la de la cuenta de la primera línea, si es una; si no, `otros`. */
async function categoriaDelEgreso(t: Transaccion, compra: CompraPreparada): Promise<number> {
    const cuentas = compra.lineas.map((l) => l.cuenta.id)
    const filas = (await t.trx
        .from('ledger.egresos_categorias')
        .whereIn('cuenta_id', cuentas)
        .orWhere('clave', 'otros')
        .select('id', 'clave', 'cuenta_id')) as Array<{ id: number; clave: string; cuenta_id: number }>
    const propia = filas.find((f) => Number(f.cuenta_id) === cuentas[0])
    return Number((propia ?? filas.find((f) => f.clave === 'otros'))!.id)
}

export default class RegistrarCompra extends DomainAction<EntradaRegistrarCompra, CompraVista> {
    readonly nombre = 'compras.registrar'

    protected async handle(input: EntradaRegistrarCompra, t: Transaccion): Promise<CompraVista> {
        const compra = await prepararCompra(t, input)
        const contado = input.condicion === 'contado'
        if (compra.tipo === 'NCRE' && contado) {
            throw new ValidacionFallida([
                {
                    field: 'condicion',
                    message:
                        'Una NCRE baja la cuenta por pagar de la compra que corrige: condicion = credito',
                    rule: 'condicion',
                },
            ])
        }
        for (const campo of ['metodo', 'caja_id', 'banco_id', 'cuenta_bancaria_id'] as const) {
            if (!contado && input[campo] !== undefined && input[campo] !== null) {
                throw new ValidacionFallida([
                    {
                        field: campo,
                        message: `${campo} solo aplica a una compra al contado`,
                        rule: 'no_aplica',
                    },
                ])
            }
        }
        if (contado && input.vence_en) {
            throw new ValidacionFallida([
                { field: 'vence_en', message: 'Una compra al contado no vence', rule: 'no_aplica' },
            ])
        }
        if (contado && !input.metodo) {
            throw new ValidacionFallida([
                {
                    field: 'metodo',
                    message: 'Indica de dónde sale el pago (caja, banco o cuenta_bancaria)',
                    rule: 'required',
                },
            ])
        }
        const origen = contado
            ? await resolverOrigenEgreso(t.trx, t.ctx, {
                  metodo: input.metodo!,
                  caja_id: input.caja_id,
                  banco_id: input.banco_id,
                  cuenta_bancaria_id: input.cuenta_bancaria_id,
              })
            : null
        if (origen && origen.empresa_id !== compra.empresaId) {
            throw new ValidacionFallida([
                {
                    field:
                        input.metodo === 'caja'
                            ? 'caja_id'
                            : input.metodo === 'banco'
                              ? 'banco_id'
                              : 'cuenta_bancaria_id',
                    message: `El pago sale de la empresa ${origen.empresa_id} y el proveedor es de la empresa ${compra.empresaId}`,
                    rule: 'cuenta_de_otra_empresa',
                },
            ])
        }

        const registradoPor = usuarioDelActor(t.ctx.actor)
        const compraId = await insertarCompra(
            t,
            compra,
            {
                condicion: contado ? 'contado' : 'credito',
                vence_en: contado
                    ? null
                    : compra.tipo === 'NCRE'
                      ? compra.fechaDocumento
                      : venceCompra(compra, input.vence_en),
                egreso_id: null,
            },
            registradoPor,
        )
        t.fijarEntidad('compra', compraId)
        const documento = documentoCompra(compra)

        if (origen) {
            await t.trx
                .insertQuery()
                .table('ledger.egresos')
                .insert({
                    empresa_id: compra.empresaId,
                    fecha: compra.fecha,
                    categoria_id: await categoriaDelEgreso(t, compra),
                    proveedor: compra.proveedor.nombre,
                    descripcion: `Pago de la compra ${compraId} (${documento})`,
                    comprobante: documento,
                    monto: aTexto(compra.neto),
                    metodo: input.metodo!,
                    caja_id: origen.caja_id,
                    turno_id: origen.turno_id,
                    banco_id: origen.banco_id,
                    cuenta_bancaria_id: origen.cuenta_bancaria_id,
                    registrado_por: registradoPor,
                    compra_id: compraId,
                })
        }

        const altas = await altasDeLaCompra(t, compraId, compra)
        await new RegistrarAsiento().execute(
            {
                empresa_id: compra.empresaId,
                fecha: compra.fecha,
                descripcion: `Compra ${compraId} · ${documento} · ${compra.proveedor.nombre}${origen ? ` · ${origen.nombre}` : ''}`,
                origen_tipo: 'compra',
                origen_id: compraId,
                movimientos: movimientosCompra({
                    tipo_documento: compra.tipo,
                    lineas: compra.lineas,
                    credito_fiscal: compra.credito,
                    iva: compra.totales.iva,
                    retenciones: compra.retenciones,
                    contrapartida: origen
                        ? { cuenta: origen.cuenta_id, proveedor_id: null }
                        : { cuenta: CUENTAS_GT.PROVEEDORES, proveedor_id: compra.proveedor.id },
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
