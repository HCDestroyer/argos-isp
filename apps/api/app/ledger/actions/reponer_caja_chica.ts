import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Problema, ValidacionFallida } from '#shared/errores'
import { CERO, aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { PAIS_PLAN } from '#ledger/plan_cuentas'
import { bloquearCustodia, saldoCustodia } from '#ledger/custodia'
import { resolverOrigenEgreso } from '#ledger/egresos'
import {
    diferenciasSinReponer,
    efectivoEnLibro,
    fondoFijoCajaChica,
    gastosSinReponer,
    leerCajaChica,
    verReposicion,
    type ReposicionVista,
} from '#ledger/caja_chica'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * `caja_chica.reponer` (`POST /cajas/:id/reponer`): repone la caja chica **solo por lo gastado** (B9 del
 * plan de contabilidad, §5.7; decisiones N5 y N9 del PM del 26 nov 2026).
 *
 * - Monto = fondo fijo − efectivo en el libro (lo gastado sin reponer más los faltantes de conteo,
 *   menos los sobrantes). La primera reposición pone el fondo completo. `monto` opcional como
 *   confirmación: si no es ese, 422 `monto_distinto` (algo cambió mientras se llenaba el formulario).
 *   Sin nada que reponer, 422 `nada_que_reponer`.
 * - Desde la **custodia** de quien repone (`1.1.15`, hasta lo que tiene: 422 `custodia_insuficiente`)
 *   o desde un **banco** del libro (`banco_id`, `cuenta_bancaria_id` o el banco principal). Nunca
 *   desde una caja de cobros.
 * - Todos los gastos pendientes deben tener su comprobante (422 `gastos_sin_comprobante` con sus id):
 *   la reposición los **sella** como «repuestos» (`ledger.reposiciones_documentos`); un gasto sellado
 *   ya no se anula. Sella también las diferencias de conteo pendientes.
 * - Asiento `reposicion_caja` (origen = la reposición): Caja chica / 1.1.15 o Banco.
 * - Evento `caja_chica.repuesta`.
 */

export interface EntradaReponerCajaChica {
    caja_id: number
    desde: 'custodia' | 'banco'
    banco_id?: number | null
    cuenta_bancaria_id?: number | null
    referencia?: string | null
    monto?: string | null
    fecha?: string
}

export default class ReponerCajaChica extends DomainAction<EntradaReponerCajaChica, ReposicionVista> {
    readonly nombre = 'caja_chica.reponer'

    protected async handle(input: EntradaReponerCajaChica, t: Transaccion): Promise<ReposicionVista> {
        t.fijarEntidad('caja', input.caja_id)
        const caja = await leerCajaChica(t.trx, input.caja_id, true)
        exigirAccesoEmpresa(t.ctx, caja.empresa_id)
        t.fijarEmpresa(caja.empresa_id)
        const hoy = hoyGuatemala()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy
        if (fecha > hoy) {
            throw new ValidacionFallida([
                { field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' },
            ])
        }
        if (input.desde === 'custodia' && (input.banco_id || input.cuenta_bancaria_id)) {
            throw new ValidacionFallida([
                {
                    field: input.banco_id ? 'banco_id' : 'cuenta_bancaria_id',
                    message: 'Desde la custodia no se indica banco',
                    rule: 'no_aplica',
                },
            ])
        }

        const gastos = await gastosSinReponer(t.trx, caja.id)
        const sinArchivo = gastos.filter((g) => g.comprobante_id === null).map((g) => Number(g.id))
        if (sinArchivo.length > 0) {
            throw new Problema(
                422,
                'gastos_sin_comprobante',
                'Hay gastos sin comprobante',
                `Sin comprobante no hay gasto: adjunta el de ${sinArchivo.length === 1 ? 'el egreso' : 'los egresos'} ${sinArchivo.join(', ')} (POST /egresos/:id/comprobante) antes de reponer`,
                sinArchivo.map((id) => ({
                    field: 'egresos',
                    message: `El egreso ${id} no tiene comprobante`,
                    rule: 'gastos_sin_comprobante',
                })),
            )
        }
        const diferencias = await diferenciasSinReponer(t.trx, caja.id)
        const fondo = await fondoFijoCajaChica(t.trx, caja)
        const efectivo = await efectivoEnLibro(t.trx, caja.cuenta_id)
        const monto = fondo.minus(efectivo)
        if (monto.lte(0)) {
            throw new Problema(
                422,
                'nada_que_reponer',
                'Nada que reponer',
                `La caja chica ${caja.nombre} tiene Q${aTexto(efectivo)} de un fondo de Q${aTexto(fondo)}: no hay nada que reponer`,
            )
        }
        if (input.monto !== undefined && input.monto !== null && input.monto !== '') {
            const pedido = dec(input.monto)
            if (!tieneCentavosExactos(pedido) || !pedido.eq(monto)) {
                throw new Problema(
                    422,
                    'monto_distinto',
                    'El monto a reponer cambió',
                    `Se repone lo gastado: Q${aTexto(monto)} (pediste Q${aTexto(pedido)})`,
                    [{ field: 'monto', message: `Se repone Q${aTexto(monto)}`, rule: 'monto_distinto' }],
                )
            }
        }

        const usuario = usuarioDelActor(t.ctx.actor)
        let origen: {
            cuenta_id: number | string
            custodio_id: number | null
            banco_id: number | null
            cuenta_bancaria_id: number | null
            nombre: string
        }
        if (input.desde === 'custodia') {
            if (usuario === null) {
                throw new Problema(
                    422,
                    'custodia_sin_persona',
                    'Sin persona',
                    'La custodia es de una persona',
                )
            }
            await bloquearCustodia(t.trx, caja.empresa_id, usuario)
            const tiene = await saldoCustodia(t.trx, caja.empresa_id, usuario)
            if (monto.gt(tiene)) {
                throw new Problema(
                    422,
                    'custodia_insuficiente',
                    'No alcanza tu custodia',
                    `Tienes Q${aTexto(tiene)} en custodia: no alcanza para reponer Q${aTexto(monto)}. Repón desde el banco`,
                    [
                        {
                            field: 'desde',
                            message: `Custodia: Q${aTexto(tiene)}`,
                            rule: 'custodia_insuficiente',
                        },
                    ],
                )
            }
            origen = {
                cuenta_id: CUENTAS_GT.EFECTIVO_EN_CUSTODIA,
                custodio_id: usuario,
                banco_id: null,
                cuenta_bancaria_id: null,
                nombre: 'custodia',
            }
        } else {
            const banco = await resolverOrigenEgreso(
                t.trx,
                { ...t.ctx, empresaId: caja.empresa_id },
                {
                    metodo: input.cuenta_bancaria_id ? 'cuenta_bancaria' : 'banco',
                    banco_id: input.banco_id,
                    cuenta_bancaria_id: input.cuenta_bancaria_id,
                },
            )
            if (banco.empresa_id !== caja.empresa_id) {
                throw new ValidacionFallida([
                    {
                        field: input.cuenta_bancaria_id ? 'cuenta_bancaria_id' : 'banco_id',
                        message: `El banco es de la empresa ${banco.empresa_id} y la caja chica de la empresa ${caja.empresa_id}`,
                        rule: 'cuenta_de_otra_empresa',
                    },
                ])
            }
            origen = {
                cuenta_id: banco.cuenta_id,
                custodio_id: null,
                banco_id: banco.banco_id,
                cuenta_bancaria_id: banco.cuenta_bancaria_id,
                nombre: banco.nombre,
            }
        }
        const cuentaOrigen =
            typeof origen.cuenta_id === 'number'
                ? origen.cuenta_id
                : Number(
                      (
                          (await t.trx
                              .from('ledger.cuentas')
                              .where('pais', PAIS_PLAN)
                              .where('codigo', origen.cuenta_id)
                              .select('id')
                              .firstOrFail()) as { id: number }
                      ).id,
                  )

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.reposiciones')
            .insert({
                empresa_id: caja.empresa_id,
                caja_id: caja.id,
                origen: input.desde,
                custodio_id: origen.custodio_id,
                banco_id: origen.banco_id,
                cuenta_bancaria_id: origen.cuenta_bancaria_id,
                cuenta_id: cuentaOrigen,
                referencia: input.referencia?.trim() || null,
                monto: aTexto(monto),
                fondo: aTexto(fondo),
                efectivo_antes: aTexto(efectivo),
                fecha,
                registrado_por: usuario,
            })
            .returning('id')) as Array<{ id: number }>
        const reposicionId = Number(fila!.id)
        const documentos = [
            ...gastos.map((g) => ({ documento_tipo: 'egreso', documento_id: g.id, monto: aTexto(g.monto) })),
            ...diferencias.map((d) => ({
                documento_tipo: 'conteo',
                documento_id: d.id,
                monto: aTexto(d.diferencia),
            })),
        ]
        if (documentos.length > 0) {
            await t.trx
                .insertQuery()
                .table('ledger.reposiciones_documentos')
                .multiInsert(
                    documentos.map((d) => ({
                        ...d,
                        reposicion_id: reposicionId,
                        empresa_id: caja.empresa_id,
                    })),
                )
        }

        await new RegistrarAsiento().execute(
            {
                empresa_id: caja.empresa_id,
                fecha,
                descripcion:
                    `Reposición ${reposicionId} de la caja chica ${caja.nombre} desde ${origen.nombre}` +
                    ` · ${gastos.length} gasto(s)` +
                    (input.referencia?.trim() ? ` · ${input.referencia.trim()}` : ''),
                origen_tipo: 'reposicion_caja',
                origen_id: reposicionId,
                movimientos: [
                    { cuenta: caja.cuenta_id, debe: aTexto(monto) },
                    { cuenta: cuentaOrigen, haber: aTexto(monto) },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
        const totalGastos = gastos.reduce((s, g) => s.plus(g.monto), CERO)
        await t.emit('caja_chica.repuesta', {
            reposicion_id: reposicionId,
            empresa_id: caja.empresa_id,
            caja_id: caja.id,
            origen: input.desde,
            custodio_id: origen.custodio_id,
            cuenta_id: cuentaOrigen,
            monto: aTexto(monto),
            fondo: aTexto(fondo),
            gastos: gastos.length,
            gastos_monto: aTexto(totalGastos),
            conteos: diferencias.length,
        })
        return verReposicion(reposicionId, t.trx)
    }
}
