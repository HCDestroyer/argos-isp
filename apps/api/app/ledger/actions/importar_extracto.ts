import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { CERO, aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida } from '#ledger/fechas'
import { resolverCuentaBanco, type PedidoCuentaBanco } from '#ledger/cuentas_banco'
import { LOCK_CONCILIACION, huellasDeLineas, verExtracto, type ExtractoVista } from '#ledger/conciliacion'

/**
 * `bancos.importar_extracto` (`POST /bancos/extractos`): el extracto de una cuenta bancaria del
 * libro, **neutral al origen** (contrato de localización fiscal §10.3): los adaptadores por banco
 * (CSV, XLSX; A6) lo convierten a esta forma y llaman a esta acción.
 *
 * - Líneas con signo (+ entra, − sale), cada una con fecha dentro de `desde..hasta`.
 * - Σ líneas = `saldo_final − saldo_inicial` (422 `extracto_descuadrado`).
 * - El saldo inicial encadena con el final del extracto anterior de la cuenta (422
 *   `extracto_no_encadena`; se fuerza con `motivo_no_encadena`).
 * - Una línea ya importada (misma huella en la cuenta) responde 409 `extracto_duplicado` con las
 *   líneas repetidas: nada se importa dos veces.
 * - Solo inserción; evento `banco.extracto_importado`.
 */

export interface LineaExtractoEntrada {
    fecha: string
    descripcion: string
    referencia?: string | null
    monto: string
    saldo?: string | null
}

export interface EntradaImportarExtracto extends PedidoCuentaBanco {
    empresa_id?: number | null
    desde: string
    hasta: string
    saldo_inicial: string
    saldo_final: string
    archivo?: string | null
    /** sha256 del archivo original (lo calcula el adaptador que lo leyó) */
    sha256?: string | null
    motivo_no_encadena?: string | null
    lineas: LineaExtractoEntrada[]
}

export default class ImportarExtracto extends DomainAction<EntradaImportarExtracto, ExtractoVista> {
    readonly nombre = 'bancos.importar_extracto'

    protected async handle(input: EntradaImportarExtracto, t: Transaccion): Promise<ExtractoVista> {
        const errores: ErrorCampo[] = []
        const desde = fechaValida(input.desde, 'desde')
        const hasta = fechaValida(input.hasta, 'hasta')
        if (desde > hasta) {
            errores.push({ field: 'hasta', message: 'hasta es anterior a desde', rule: 'rango' })
        }
        const montoValido = (valor: string | null | undefined, campo: string) => {
            if (valor === null || valor === undefined) return null
            const d = dec(valor)
            if (!tieneCentavosExactos(d)) {
                errores.push({ field: campo, message: 'Hasta 2 decimales', rule: 'monto' })
            }
            return d
        }
        const inicial = montoValido(input.saldo_inicial, 'saldo_inicial') ?? CERO
        const final = montoValido(input.saldo_final, 'saldo_final') ?? CERO
        let suma = CERO
        const lineas = (input.lineas ?? []).map((l, i) => {
            const fecha = fechaValida(l.fecha, `lineas.${i}.fecha`)
            if (fecha < desde || fecha > hasta) {
                errores.push({
                    field: `lineas.${i}.fecha`,
                    message: `La fecha ${fecha} está fuera del extracto (${desde} a ${hasta})`,
                    rule: 'fuera_del_extracto',
                })
            }
            const monto = montoValido(l.monto, `lineas.${i}.monto`) ?? CERO
            if (monto.isZero()) {
                errores.push({
                    field: `lineas.${i}.monto`,
                    message: 'Una línea no puede ser 0',
                    rule: 'monto',
                })
            }
            suma = suma.plus(monto)
            const descripcion = l.descripcion?.trim() ?? ''
            if (!descripcion) {
                errores.push({
                    field: `lineas.${i}.descripcion`,
                    message: 'La descripción es obligatoria',
                    rule: 'required',
                })
            }
            return {
                fecha,
                descripcion,
                referencia: l.referencia?.trim() || null,
                monto: aTexto(monto),
                saldo:
                    l.saldo === undefined || l.saldo === null
                        ? null
                        : aTexto(montoValido(l.saldo, `lineas.${i}.saldo`)!),
            }
        })
        if (lineas.length === 0) {
            errores.push({ field: 'lineas', message: 'El extracto no tiene líneas', rule: 'required' })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        if (!suma.equals(final.minus(inicial))) {
            throw new Problema(
                422,
                'extracto_descuadrado',
                'Extracto descuadrado',
                `Σ líneas (Q${aTexto(suma)}) ≠ saldo final − saldo inicial (Q${aTexto(final.minus(inicial))})`,
                [
                    {
                        field: 'saldo_final',
                        message: `Σ líneas = Q${aTexto(suma)}`,
                        rule: 'extracto_descuadrado',
                    },
                ],
            )
        }

        const previa = await resolverCuentaBanco(t.trx, input)
        const empresaId =
            input.empresa_id ?? previa!.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const cuenta = (await resolverCuentaBanco(t.trx, input, { empresaId }))!
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?::int)', [LOCK_CONCILIACION, cuenta.cuenta_id])

        const huellas = huellasDeLineas(lineas)
        const repetidas = (await t.trx
            .from('ledger.extractos_lineas')
            .where({ empresa_id: empresaId, cuenta_id: cuenta.cuenta_id })
            .whereIn('huella', huellas)
            .select('huella', 'id', 'extracto_id')) as Array<{
            huella: string
            id: number
            extracto_id: number
        }>
        if (repetidas.length > 0) {
            const porHuella = new Map(repetidas.map((r) => [r.huella, r]))
            throw new Problema(
                409,
                'extracto_duplicado',
                'Líneas ya importadas',
                `${repetidas.length} línea(s) ya están importadas en ${cuenta.codigo}`,
                huellas.flatMap((h, i) => {
                    const r = porHuella.get(h)
                    return r
                        ? [
                              {
                                  field: `lineas.${i}`,
                                  message: `Ya importada (línea ${r.id} del extracto ${r.extracto_id})`,
                                  rule: 'extracto_duplicado',
                              },
                          ]
                        : []
                }),
            )
        }

        const anterior = (await t.trx
            .from('ledger.extractos')
            .where({ empresa_id: empresaId, cuenta_id: cuenta.cuenta_id })
            .orderBy('hasta', 'desc')
            .orderBy('id', 'desc')
            .select('id', 'saldo_final')
            .first()) as { id: number; saldo_final: string } | null
        const motivo = input.motivo_no_encadena?.trim() || null
        if (anterior && !dec(anterior.saldo_final).equals(inicial) && !motivo) {
            throw new Problema(
                422,
                'extracto_no_encadena',
                'El extracto no encadena',
                `El saldo inicial (Q${aTexto(inicial)}) no es el final del extracto ${anterior.id} (Q${aTexto(anterior.saldo_final)}); indica motivo_no_encadena para forzarlo`,
                [
                    {
                        field: 'saldo_inicial',
                        message: `Se esperaba Q${aTexto(anterior.saldo_final)}`,
                        rule: 'extracto_no_encadena',
                    },
                ],
            )
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.extractos')
            .insert({
                empresa_id: empresaId,
                cuenta_id: cuenta.cuenta_id,
                cuenta_bancaria_id: cuenta.cuenta_bancaria_id,
                desde,
                hasta,
                saldo_inicial: aTexto(inicial),
                saldo_final: aTexto(final),
                archivo: input.archivo?.trim() || null,
                sha256: input.sha256?.trim().toLowerCase() || null,
                motivo_no_encadena: anterior && !dec(anterior.saldo_final).equals(inicial) ? motivo : null,
                importado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const extractoId = Number(fila!.id)
        t.fijarEntidad('extracto', extractoId)
        for (let i = 0; i < lineas.length; i += 500) {
            await t.trx
                .insertQuery()
                .table('ledger.extractos_lineas')
                .multiInsert(
                    lineas.slice(i, i + 500).map((l, j) => ({
                        ...l,
                        extracto_id: extractoId,
                        empresa_id: empresaId,
                        cuenta_id: cuenta.cuenta_id,
                        orden: i + j + 1,
                        huella: huellas[i + j]!,
                    })),
                )
        }
        await t.emit('banco.extracto_importado', {
            extracto_id: extractoId,
            empresa_id: empresaId,
            cuenta_bancaria_id: cuenta.cuenta_bancaria_id,
            cuenta_id: cuenta.cuenta_id,
            lineas: lineas.length,
            monto: aTexto(suma),
        })
        return verExtracto(extractoId, t.trx)
    }
}
