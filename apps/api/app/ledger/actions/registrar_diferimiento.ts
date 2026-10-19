import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { aTexto, dec, type Dec } from '#ledger/dinero'
import { fechaValida, hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { periodoCerrado } from '#ledger/cierres'
import { CUENTAS, PAIS_PLAN } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { verDiferimiento, type DiferimientoVista } from '#ledger/diferidos'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * `libro.registrar_diferimiento` (`POST /diferimientos`, permiso `libro.registrar_asiento`):
 * difiere una línea ya registrada (contrato de localización fiscal §10.10).
 *
 * - **Factura** de varios meses (plan anual o semestral cobrado de una vez): la base de la línea
 *   (sin IVA, que se causa con la factura) pasa de su ingreso a `2.1.12 Ingresos cobrados por
 *   anticipado` y vuelve cada mes. Asiento inicial `Ingreso / 2.1.12`.
 * - **Compra** de un gasto de varios meses (seguro, licencia): el costo de la línea pasa a `1.1.13
 *   Gastos pagados por anticipado`. Asiento inicial `1.1.13 / Gasto`. (Una línea con
 *   `diferir_meses` al registrar la compra ya va a 1.1.13 sin este asiento.)
 * - Asiento origen `diferido`, con la fecha del documento (o hoy si su mes está cerrado). Empieza
 *   en `inicio` (por defecto el mes del documento). Una línea se difiere una vez (409
 *   `linea_diferida`). Las cuotas las registra `libro.amortizar_diferidos`.
 */

export interface EntradaDiferimiento {
    origen: 'factura' | 'compra'
    factura_linea_id?: number | null
    compra_linea_id?: number | null
    meses: number
    inicio?: string | null
    descripcion?: string | null
}

interface DatosLinea {
    empresaId: number
    facturaId: number | null
    compraId: number | null
    descripcion: string
    monto: Dec
    destino: number
    fecha: string
}

/** Cuenta de ingreso de una línea de factura (la de `movimientosFactura`). */
const CUENTA_INGRESO: Record<string, string> = {
    servicio: CUENTAS.INGRESOS_INTERNET,
    mora: CUENTAS.RECARGOS_MORA,
}

export default class RegistrarDiferimiento extends DomainAction<EntradaDiferimiento, DiferimientoVista> {
    readonly nombre = 'libro.registrar_diferimiento'

    protected async handle(input: EntradaDiferimiento, t: Transaccion): Promise<DiferimientoVista> {
        if (!Number.isInteger(input.meses) || input.meses < 2 || input.meses > 120) {
            throw new ValidacionFallida([{ field: 'meses', message: 'De 2 a 120 meses', rule: 'meses' }])
        }
        const datos =
            input.origen === 'factura' ? await this.deFactura(t, input) : await this.deCompra(t, input)
        exigirAccesoEmpresa(t.ctx, datos.empresaId)
        t.fijarEmpresa(datos.empresaId)
        const cuentaDiferida = (await t.trx
            .from('ledger.cuentas')
            .where({
                pais: PAIS_PLAN,
                codigo:
                    input.origen === 'factura'
                        ? CUENTAS_GT.INGRESOS_COBRADOS_ANTICIPADO
                        : CUENTAS_GT.GASTOS_PAGADOS_ANTICIPADO,
            })
            .select('id')
            .firstOrFail()) as { id: number }
        const inicio = inicioDeMes(input.inicio ? fechaValida(input.inicio, 'inicio') : datos.fecha)
        const fecha = (await periodoCerrado(t.trx, datos.fecha, datos.empresaId))
            ? hoyGuatemala()
            : datos.fecha

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.diferimientos')
            .insert({
                empresa_id: datos.empresaId,
                origen: input.origen,
                factura_id: datos.facturaId,
                factura_linea_id: input.origen === 'factura' ? input.factura_linea_id : null,
                compra_id: datos.compraId,
                compra_linea_id: input.origen === 'compra' ? input.compra_linea_id : null,
                descripcion: input.descripcion?.trim() || datos.descripcion,
                cuenta_diferida_id: Number(cuentaDiferida.id),
                cuenta_destino_id: datos.destino,
                total: aTexto(datos.monto),
                inicio,
                meses: input.meses,
                asiento_inicial: true,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('diferimiento', id)
        const monto = aTexto(datos.monto)
        await new RegistrarAsiento().execute(
            {
                empresa_id: datos.empresaId,
                fecha,
                descripcion: `Diferimiento ${id} en ${input.meses} meses · ${datos.descripcion}`,
                origen_tipo: 'diferido',
                origen_id: id,
                movimientos:
                    input.origen === 'factura'
                        ? [
                              { cuenta: datos.destino, debe: monto },
                              { cuenta: Number(cuentaDiferida.id), haber: monto },
                          ]
                        : [
                              { cuenta: Number(cuentaDiferida.id), debe: monto },
                              { cuenta: datos.destino, haber: monto },
                          ],
            },
            t.ctx,
            { trx: t.trx },
        )
        return verDiferimiento(id, t.trx)
    }

    private async exigirLibre(
        t: Transaccion,
        columna: 'factura_linea_id' | 'compra_linea_id',
        lineaId: number,
    ) {
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, hashtext(?))', [3018, `${columna}:${lineaId}`])
        const previo = await t.trx
            .from('ledger.diferimientos as d')
            .where(`d.${columna}`, lineaId)
            .whereNotExists((q) =>
                q.from('ledger.diferimientos_cancelaciones as x').whereRaw('x.diferimiento_id = d.id'),
            )
            .select('d.id')
            .first()
        if (previo) {
            throw new Conflicto(
                `La línea ${lineaId} ya está diferida (diferimiento ${previo.id})`,
                'linea_diferida',
                'Línea diferida',
            )
        }
    }

    private async deFactura(t: Transaccion, input: EntradaDiferimiento): Promise<DatosLinea> {
        if (!input.factura_linea_id) {
            throw new ValidacionFallida([
                { field: 'factura_linea_id', message: 'Indica la línea de la factura', rule: 'required' },
            ])
        }
        const linea = (await t.trx
            .from('billing.facturas_lineas as l')
            .join('billing.facturas as f', 'f.id', 'l.factura_id')
            .where('l.id', input.factura_linea_id)
            .select(
                'l.id',
                'l.concepto',
                'l.tipo',
                'l.total',
                'l.iva',
                'f.id as factura_id',
                'f.empresa_id',
                'f.estado',
                t.trx.raw(
                    `(SELECT to_char(a.fecha, 'YYYY-MM-DD') FROM ledger.asientos a WHERE a.origen_tipo IN ('factura', 'mora')
                        AND a.origen_id = f.id AND a.reversa_de IS NULL ORDER BY a.id LIMIT 1) as fecha`,
                ),
            )
            .first()) as {
            id: number
            concepto: string
            tipo: string
            total: string
            iva: string
            factura_id: number
            empresa_id: number
            estado: string
            fecha: string | null
        } | null
        if (!linea) throw new NoEncontrado(`La línea de factura ${input.factura_linea_id} no existe`)
        if (linea.estado === 'anulada' || linea.estado === 'por_certificar' || !linea.fecha) {
            throw new Conflicto(
                `La factura ${linea.factura_id} no está emitida en el libro (${linea.estado})`,
                'factura_no_emitida',
                'Factura no emitida',
            )
        }
        await this.exigirLibre(t, 'factura_linea_id', Number(linea.id))
        const base = dec(linea.total).minus(linea.iva)
        if (base.lte(0)) {
            throw new ValidacionFallida([
                { field: 'factura_linea_id', message: 'La línea no tiene base que diferir', rule: 'monto' },
            ])
        }
        const destino = (await t.trx
            .from('ledger.cuentas')
            .where({ pais: PAIS_PLAN, codigo: CUENTA_INGRESO[linea.tipo] ?? CUENTAS.OTROS_INGRESOS })
            .select('id')
            .firstOrFail()) as { id: number }
        return {
            empresaId: Number(linea.empresa_id),
            facturaId: Number(linea.factura_id),
            compraId: null,
            descripcion: `Factura ${linea.factura_id} · ${linea.concepto}`,
            monto: base,
            destino: Number(destino.id),
            fecha: linea.fecha,
        }
    }

    private async deCompra(t: Transaccion, input: EntradaDiferimiento): Promise<DatosLinea> {
        if (!input.compra_linea_id) {
            throw new ValidacionFallida([
                { field: 'compra_linea_id', message: 'Indica la línea de la compra', rule: 'required' },
            ])
        }
        const linea = (await t.trx
            .from('ledger.compras_lineas as l')
            .join('ledger.compras as c', 'c.id', 'l.compra_id')
            .join('ledger.cuentas as cu', 'cu.id', 'l.cuenta_id')
            .where('l.id', input.compra_linea_id)
            .select(
                'l.id',
                'l.descripcion',
                'l.tipo',
                'l.base',
                'l.iva',
                'l.cuenta_id',
                'l.diferir_meses',
                'cu.tipo as cuenta_tipo',
                'c.id as compra_id',
                'c.empresa_id',
                'c.tipo_documento',
                'c.credito_fiscal',
                t.trx.raw(`to_char(c.fecha, 'YYYY-MM-DD') as fecha`),
                t.trx.raw(
                    'EXISTS (SELECT 1 FROM ledger.compras_anulaciones x WHERE x.compra_id = c.id) as anulada',
                ),
            )
            .first()) as {
            id: number
            descripcion: string
            tipo: string
            base: string
            iva: string
            cuenta_id: number
            diferir_meses: number | null
            cuenta_tipo: string
            compra_id: number
            empresa_id: number
            tipo_documento: string
            credito_fiscal: boolean
            fecha: string
            anulada: boolean
        } | null
        if (!linea) throw new NoEncontrado(`La línea de compra ${input.compra_linea_id} no existe`)
        if (linea.anulada) {
            throw new Conflicto(
                `La compra ${linea.compra_id} está anulada`,
                'compra_anulada',
                'Compra anulada',
            )
        }
        if (
            linea.cuenta_tipo !== 'gasto' ||
            linea.tipo === 'activo_fijo' ||
            linea.tipo_documento === 'NCRE'
        ) {
            throw new ValidacionFallida([
                {
                    field: 'compra_linea_id',
                    message: 'Solo se difiere un gasto (no activos fijos ni NCRE)',
                    rule: 'no_aplica',
                },
            ])
        }
        if (linea.diferir_meses) {
            throw new Conflicto(
                `La línea ${linea.id} ya se difirió al registrar la compra`,
                'linea_diferida',
                'Línea diferida',
            )
        }
        await this.exigirLibre(t, 'compra_linea_id', Number(linea.id))
        const monto = linea.credito_fiscal ? dec(linea.base) : dec(linea.base).plus(linea.iva)
        return {
            empresaId: Number(linea.empresa_id),
            facturaId: null,
            compraId: Number(linea.compra_id),
            descripcion: `Compra ${linea.compra_id} · ${linea.descripcion}`,
            monto,
            destino: Number(linea.cuenta_id),
            fecha: linea.fecha,
        }
    }
}
