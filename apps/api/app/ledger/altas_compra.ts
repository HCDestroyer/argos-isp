import type { Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { aTexto, dec } from '#ledger/dinero'
import { fechaValida, hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { PAIS_PLAN } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { cuentasDeClase, inicioDepreciacion, tasaDeClase } from '#ledger/activos'
import type { LineaCompraCalculada, LineaCompraEntrada } from '#ledger/compras'
import type { CompraPreparada } from '#ledger/preparar_compra'
import RevertirAsiento from '#ledger/actions/revertir_asiento'

/**
 * Lo que una compra da de alta además de su asiento (contrato §10.10), en su misma transacción:
 *
 * - Cada línea `activo_fijo` da de alta su activo (`ledger.activos`, con `compra_linea_id`): costo =
 *   base (+ IVA si la compra no tiene crédito fiscal); tasa = la pedida (≤ tope) o el tope legal de
 *   su clase; empieza a depreciarse según `depreciacion_inicio`.
 * - Cada línea con `diferir_meses` (un gasto) va en el asiento a `1.1.13 Gastos pagados por
 *   anticipado` en lugar de a su cuenta, y deja su diferimiento hacia esa cuenta (sin asiento
 *   inicial: ya está en 1.1.13).
 *
 * `cuentaDe` dice a qué cuenta va cada línea en el asiento de la compra y `despuesDelAsiento`
 * escribe las altas.
 */
export interface AltasCompra {
    cuentaDe: (linea: LineaCompraCalculada) => number
    despuesDelAsiento: () => Promise<void>
}

export async function altasDeLaCompra(
    t: Transaccion,
    compraId: number,
    compra: CompraPreparada,
    entradas: LineaCompraEntrada[],
): Promise<AltasCompra> {
    const errores: ErrorCampo[] = []
    compra.lineas.forEach((linea, i) => {
        if (linea.diferir_meses && (linea.tipo === 'activo_fijo' || linea.cuenta.tipo !== 'gasto')) {
            errores.push({
                field: `lineas.${i}.diferir_meses`,
                message: 'Solo se difiere un gasto (un activo fijo se deprecia)',
                rule: 'no_aplica',
            })
        }
    })
    if (errores.length > 0) throw new ValidacionFallida(errores)
    const diferida = compra.lineas.some((l) => l.diferir_meses)
        ? Number(
              (
                  (await t.trx
                      .from('ledger.cuentas')
                      .where({ pais: PAIS_PLAN, codigo: CUENTAS_GT.GASTOS_PAGADOS_ANTICIPADO })
                      .select('id')
                      .firstOrFail()) as { id: number }
              ).id,
          )
        : null
    // tasas validadas antes del asiento (422 tasa_sobre_tope sin escribir nada)
    const tasas = new Map<number, string>()
    for (const [i, linea] of compra.lineas.entries()) {
        if (linea.tipo !== 'activo_fijo') continue
        tasas.set(
            i,
            await tasaDeClase(
                t.trx,
                compra.empresaId,
                linea.clase_activo!,
                compra.fecha,
                entradas[i]?.activo_tasa_anual,
                `lineas.${i}.activo_tasa_anual`,
            ),
        )
    }
    const costo = (linea: LineaCompraCalculada) => (compra.credito ? linea.base : linea.total)
    return {
        cuentaDe: (linea) => (linea.diferir_meses && diferida ? diferida : linea.cuenta.id),
        despuesDelAsiento: async () => {
            const ids = (await t.trx
                .from('ledger.compras_lineas')
                .where('compra_id', compraId)
                .orderBy('id')
                .select('id')) as Array<{ id: number }>
            const registradoPor = usuarioDelActor(t.ctx.actor)
            for (const [i, linea] of compra.lineas.entries()) {
                const entrada = entradas[i]
                const lineaId = Number(ids[i]!.id)
                if (linea.tipo === 'activo_fijo') {
                    const cuentas = await cuentasDeClase(t.trx, linea.clase_activo!)
                    const residual = dec(entrada?.activo_valor_residual ?? '0')
                    if (residual.gte(costo(linea))) {
                        throw new ValidacionFallida([
                            {
                                field: `lineas.${i}.activo_valor_residual`,
                                message: 'El valor residual es menor que el costo',
                                rule: 'monto',
                            },
                        ])
                    }
                    await t.trx.insertQuery().table('ledger.activos').insert({
                        empresa_id: compra.empresaId,
                        clase: linea.clase_activo,
                        descripcion: entrada?.activo_descripcion?.trim() || linea.descripcion,
                        serie: entrada?.activo_serie?.trim() || null,
                        ubicacion: entrada?.activo_ubicacion?.trim() || null,
                        compra_id: compraId,
                        compra_linea_id: lineaId,
                        fecha_alta: compra.fecha,
                        inicio_depreciacion: await inicioDepreciacion(t.trx, compra.empresaId, compra.fecha),
                        costo: aTexto(costo(linea)),
                        valor_residual: aTexto(residual),
                        tasa_anual: tasas.get(i)!,
                        cuenta_activo_id: cuentas.activo,
                        cuenta_depreciacion_id: cuentas.depreciacion,
                        cuenta_gasto_id: cuentas.gasto,
                        registrado_por: registradoPor,
                    })
                }
                if (linea.diferir_meses && diferida) {
                    const desde = entrada?.diferir_desde ? fechaValida(entrada.diferir_desde, `lineas.${i}.diferir_desde`) : compra.fecha
                    await t.trx.insertQuery().table('ledger.diferimientos').insert({
                        empresa_id: compra.empresaId,
                        origen: 'compra',
                        compra_id: compraId,
                        compra_linea_id: lineaId,
                        descripcion: `Compra ${compraId} · ${linea.descripcion}`,
                        cuenta_diferida_id: diferida,
                        cuenta_destino_id: linea.cuenta.id,
                        total: aTexto(costo(linea)),
                        inicio: inicioDeMes(desde),
                        meses: linea.diferir_meses,
                        asiento_inicial: false,
                        registrado_por: registradoPor,
                    })
                }
            }
        },
    }
}

/**
 * Antes de anular una compra: sus activos y diferidos no pueden tener cuotas ni bajas (409
 * `activo_con_cuotas`, `activo_dado_de_baja`, `diferido_con_cuotas`). Si no las tienen se cierran:
 * el activo con una baja `anulacion` sin asiento y el diferimiento con su cancelación (el reverso
 * de la compra ya cancela su costo; un diferimiento con asiento inicial lo revierte aquí).
 */
export async function anularAltasDeLaCompra(t: Transaccion, compraId: number, motivo: string): Promise<void> {
    const activos = (await t.trx
        .from('ledger.activos as ac')
        .where('ac.compra_id', compraId)
        .select(
            'ac.id',
            'ac.costo',
            t.trx.raw('(SELECT count(*)::int FROM ledger.activos_cuotas q WHERE q.activo_id = ac.id) as cuotas'),
            t.trx.raw('EXISTS (SELECT 1 FROM ledger.activos_bajas b WHERE b.activo_id = ac.id) as baja'),
        )) as Array<{ id: number; costo: string; cuotas: number; baja: boolean }>
    for (const activo of activos) {
        if (activo.cuotas > 0) {
            throw new Conflicto(
                `El activo ${activo.id} de la compra ya tiene ${activo.cuotas} cuotas de depreciación: dalo de baja y corrige la compra con una NCRE`,
                'activo_con_cuotas',
                'Activo depreciado',
            )
        }
        if (activo.baja) {
            throw new Conflicto(`El activo ${activo.id} de la compra ya está dado de baja`, 'activo_dado_de_baja', 'Activo dado de baja')
        }
    }
    const diferimientos = (await t.trx
        .from('ledger.diferimientos as d')
        .where('d.compra_id', compraId)
        .whereNotExists((q) => q.from('ledger.diferimientos_cancelaciones as x').whereRaw('x.diferimiento_id = d.id'))
        .select(
            'd.id',
            'd.asiento_inicial',
            t.trx.raw('(SELECT count(*)::int FROM ledger.diferimientos_cuotas q WHERE q.diferimiento_id = d.id) as cuotas'),
        )) as Array<{ id: number; asiento_inicial: boolean; cuotas: number }>
    for (const d of diferimientos) {
        if (d.cuotas > 0) {
            throw new Conflicto(
                `El diferimiento ${d.id} de la compra ya tiene ${d.cuotas} cuotas amortizadas`,
                'diferido_con_cuotas',
                'Diferido con cuotas',
            )
        }
    }
    const registradoPor = usuarioDelActor(t.ctx.actor)
    for (const activo of activos) {
        await t.trx.insertQuery().table('ledger.activos_bajas').insert({
            activo_id: activo.id,
            fecha: hoyGuatemala(),
            tipo: 'anulacion',
            motivo: `anulación de la compra ${compraId}: ${motivo}`,
            costo: activo.costo,
            depreciacion_acumulada: '0.00',
            valor_libros: activo.costo,
            registrado_por: registradoPor,
        })
    }
    for (const d of diferimientos) {
        let reverso: number | null = null
        if (d.asiento_inicial) {
            const inicial = await t.trx
                .from('ledger.asientos')
                .where({ origen_tipo: 'diferido', origen_id: d.id })
                .whereNull('reversa_de')
                .orderBy('id')
                .select('id')
                .first()
            if (inicial) {
                const r = await new RevertirAsiento().execute(
                    { asiento_id: Number(inicial.id), motivo: `anulación de la compra ${compraId}: ${motivo}`, por_anulacion: true },
                    t.ctx,
                    { trx: t.trx },
                )
                reverso = r.id
            }
        }
        await t.trx.insertQuery().table('ledger.diferimientos_cancelaciones').insert({
            diferimiento_id: d.id,
            motivo: `anulación de la compra ${compraId}: ${motivo}`,
            asiento_id: reverso,
            cancelado_por: registradoPor,
        })
    }
}
