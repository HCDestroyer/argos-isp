import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { valorParametro } from '#fiscal/parametros'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { periodoCerrado } from '#ledger/cierres'
import {
    anioValido,
    cierreVigente,
    saldoDeudor,
    saldosDeResultados,
    verCierreAnual,
    type CierreAnualVista,
} from '#ledger/ejercicios'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import { LOCK_CIERRES } from '#ledger/cierres'
import { exigirChecks } from '#ledger/checks'
import { hashActual, ultimaVersion } from '#fiscal/declaraciones'
import { isoPorVencer } from '#fiscal/declaraciones_renta'

/**
 * `libro.cerrar_ejercicio` (`POST /libro/ejercicios/cerrar`, contrato de localización fiscal §9.1):
 * cierra el año de una empresa con la partida de cierre clásica (§10.8).
 *
 * Requisitos (422 `ejercicio_requisitos`, un `errors[]` por problema con `rule` = la clave):
 * `meses_abiertos` (enero a noviembre cerrados), `diciembre_cerrado` (diciembre abierto: ahí van los
 * asientos), `dte_pendientes` (ningún DTE `pendiente`, `enviando`, `error_temporal` o `contingencia`
 * emitido en el año), `ejercicio_anterior_abierto` (un año anterior con ingresos o gastos sin
 * cerrar). 409 `ejercicio_cerrado` si ya tiene cierre vigente.
 *
 * ISR (decisión del líder; fase 7 PR C): si el año tiene declaración ISR anual (`isr_anual`), el ISR y
 * lo acreditado salen de su última versión, que debe estar revisada o presentada (422
 * `declaracion_sin_revisar`) y al día (409 `declaracion_desactualizada`); el dato manual se rechaza (422
 * `isr_de_declaracion`). Sin declaración (régimen sin ISR anual en el calendario, o años anteriores a
 * la fase 7), el monto lo escribe el usuario: obligatorio (puede ser 0.00), con lo acreditado de
 * `1.1.07` (pagos trimestrales) y `1.1.08` (ISO). Cada parte ≤ su saldo al 31-dic y juntas ≤ el ISR.
 * Queda en el cierre y en la auditoría.
 *
 * ISO vencido (§9.3, inv. A.4): el ISO por acreditar cuya ventana termina a más tardar el 31-dic del
 * año y sigue sin acreditar pasa a `5.3.03` (`5.3.03 / 1.1.08`) con su fila `vencido` en
 * `fiscal.iso_acreditamientos`; es gasto del año y entra en el resultado.
 *
 * En una transacción, con fecha 31-dic, diario `CIE` y origen `cierre_anual` (origen_id = el cierre):
 *  0. ISO vencido: `5.3.03 / 1.1.08` (si hay).
 *  1. ISR: `5.5.01 / 1.1.07 + 1.1.08 + 2.1.07` (si el ISR es mayor que cero).
 *  2. Cancelación de cada cuenta de ingreso y gasto del año contra `3.3.03`.
 *  3. Traslado `3.3.03 → 3.3.02` y 4. `3.3.02 → 3.3.01` (si el resultado no es cero).
 *  5. Reserva legal si hubo utilidad: `reserva_legal_pct` × la base (`reserva_legal_base`: el
 *     resultado antes o después del ISR), `3.3.01 / 3.2.01`.
 *  6. Cierra diciembre (`cerrar_periodo` anidada, que exige los checks mensuales de diciembre).
 *  7. Verifica y exige los checks anuales (§10.5: `incobrables`, `resultados_cero`,
 *     `comprobacion_cuadra`; 422 `checks_pendientes`), ya con los asientos del cierre.
 *
 * `resultado_antes_isr` es el resultado contable del año antes de la provisión del cierre (incluye
 * el ISR que ya estuviera en `5.5.01`); `resultado` = `resultado_antes_isr − isr`.
 * Emite `ejercicio.cerrado`.
 */

export interface EntradaCerrarEjercicio {
    empresa_id?: number | null
    anio: number
    /** sin declaración ISR anual del año: obligatorio; con ella, prohibido (sale de la declaración) */
    isr?: {
        monto: string
        acreditado_trimestral?: string | null
        acreditado_iso?: string | null
        nota?: string | null
    } | null
    /** instante de referencia (pruebas); por defecto ahora */
    ahora?: Date
}

const ESTADOS_DTE_PENDIENTES = ['pendiente', 'enviando', 'error_temporal', 'contingencia']

export default class CerrarEjercicio extends DomainAction<EntradaCerrarEjercicio, CierreAnualVista> {
    readonly nombre = 'libro.cerrar_ejercicio'

    protected async handle(input: EntradaCerrarEjercicio, t: Transaccion): Promise<CierreAnualVista> {
        const anio = anioValido(input.anio)
        const fin = `${anio}-12-31`
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_CIERRES, empresaId])

        if ((await cierreVigente(t.trx, empresaId, anio)) !== null) {
            throw new Conflicto(
                `El ejercicio ${anio} ya está cerrado`,
                'ejercicio_cerrado',
                'Ejercicio cerrado',
            )
        }
        const { isr, trimestral, iso, nota, declaracionId } = await isrDelEjercicio(
            t,
            empresaId,
            anio,
            input.isr,
        )
        const errores = await requisitos(t, empresaId, anio)
        if (errores.length > 0) {
            throw new Problema(
                422,
                'ejercicio_requisitos',
                'Requisitos del cierre anual',
                `No se puede cerrar el ejercicio ${anio}: ${errores.map((e) => e.message).join('; ')}`,
                errores,
            )
        }

        // ISR acreditable: cada parte ≤ su saldo al 31-dic y juntas ≤ el ISR
        const erroresIsr: ErrorCampo[] = []
        const saldoTrimestral = await saldoDeudor(t.trx, empresaId, CUENTAS_GT.ISR_PAGOS_TRIMESTRALES, fin)
        const saldoIso = await saldoDeudor(t.trx, empresaId, CUENTAS_GT.ISO_POR_ACREDITAR, fin)
        const vencidos = await isoPorVencer(t.trx, empresaId, anio)
        const isoVencido = vencidos.reduce((s, v) => s.plus(v.saldo), CERO)
        if (trimestral.gt(saldoTrimestral)) {
            erroresIsr.push({
                field: 'isr.acreditado_trimestral',
                message: `Solo hay Q${aTexto(saldoTrimestral)} de pagos trimestrales (1.1.07) al ${fin}`,
                rule: 'isr_acreditable',
            })
        }
        if (iso.plus(isoVencido).gt(saldoIso)) {
            erroresIsr.push({
                field: 'isr.acreditado_iso',
                message: `Solo hay Q${aTexto(saldoIso)} de ISO por acreditar (1.1.08) al ${fin}${
                    isoVencido.gt(0)
                        ? ` para acreditar ${aTexto(iso)} y dar de baja ${aTexto(isoVencido)} vencido`
                        : ''
                }`,
                rule: 'isr_acreditable',
            })
        }
        if (trimestral.plus(iso).gt(isr)) {
            erroresIsr.push({
                field: 'isr.monto',
                message: 'Lo acreditado no puede pasar del ISR del ejercicio',
                rule: 'isr_acreditable',
            })
        }
        if (erroresIsr.length > 0) throw new ValidacionFallida(erroresIsr)

        // resultado del año sin el cierre; la provisión del ISR suma a 5.5.01
        const saldos = await saldosDeResultados(t.trx, empresaId, anio)
        const netoPrevio = saldos.reduce((s, c) => s.plus(c.neto), CERO)
        // el ISO vencido es gasto del año (5.3.03): entra antes del ISR
        const resultadoAntes = netoPrevio.negated().minus(isoVencido)
        const resultado = resultadoAntes.minus(isr)

        const pct = dec(String(await valorParametro<string>(empresaId, 'reserva_legal_pct', fin, t.trx)))
        const base = String(await valorParametro<string>(empresaId, 'reserva_legal_base', fin, t.trx))
        const baseReserva = base === 'antes_isr' ? resultadoAntes : resultado
        const reserva =
            resultado.gt(0) && baseReserva.gt(0) ? redondear(baseReserva.times(pct).div(100)) : CERO

        const resumen = {
            desde: `${anio}-01-01`,
            hasta: fin,
            cuentas: saldos
                .filter((c) => !c.neto.isZero())
                .map((c) => ({ codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, neto: aTexto(c.neto) })),
            isr_por_pagar: aTexto(isr.minus(trimestral).minus(iso)),
            isr_declaracion_id: declaracionId,
            iso_vencido: aTexto(isoVencido),
            iso_vencido_detalle: vencidos.map((v) => ({
                iso_periodo: v.iso_periodo,
                vence_en: v.vence_en,
                monto: aTexto(v.saldo),
            })),
            reserva_legal_pct: pct.toString(),
            reserva_legal_base: base,
            base_reserva: aTexto(baseReserva),
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.cierres_anuales')
            .insert({
                empresa_id: empresaId,
                anio,
                isr: aTexto(isr),
                isr_acreditado_trimestral: aTexto(trimestral),
                isr_acreditado_iso: aTexto(iso),
                isr_nota: nota,
                resultado_antes_isr: aTexto(resultadoAntes),
                resultado: aTexto(resultado),
                reserva_legal: aTexto(reserva),
                resumen: JSON.stringify(resumen),
                cerrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const cierreId = Number(fila!.id)
        t.fijarEntidad('cierre_anual', cierreId)

        const asiento = (descripcion: string, movimientos: LineaAsiento[]) =>
            new RegistrarAsiento().execute(
                {
                    empresa_id: empresaId,
                    fecha: fin,
                    descripcion: `Cierre del ejercicio ${anio}: ${descripcion}`,
                    origen_tipo: 'cierre_anual',
                    origen_id: cierreId,
                    diario: 'CIE',
                    movimientos,
                },
                t.ctx,
                { trx: t.trx },
            )

        // 0. ISO vencido sin acreditar: 5.3.03 / 1.1.08 y su fila en fiscal.iso_acreditamientos
        if (isoVencido.gt(0)) {
            await asiento('ISO vencido sin acreditar', [
                { cuenta: CUENTAS_GT.IMPUESTOS_DEDUCIBLES, debe: aTexto(isoVencido) },
                { cuenta: CUENTAS_GT.ISO_POR_ACREDITAR, haber: aTexto(isoVencido) },
            ])
            for (const v of vencidos) {
                await t.trx
                    .insertQuery()
                    .table('fiscal.iso_acreditamientos')
                    .insert({
                        empresa_id: empresaId,
                        tipo: 'vencido',
                        iso_periodo: v.iso_periodo,
                        cierre_id: cierreId,
                        monto: aTexto(v.saldo),
                        acreditable_desde: v.acreditable_desde,
                        vence_en: v.vence_en,
                    })
            }
        }

        // 1. provisión del ISR
        if (isr.gt(0)) {
            const porPagar = isr.minus(trimestral).minus(iso)
            await asiento('provisión del ISR', [
                { cuenta: CUENTAS_GT.IMPUESTO_SOBRE_RENTA, debe: aTexto(isr) },
                ...(trimestral.gt(0)
                    ? [{ cuenta: CUENTAS_GT.ISR_PAGOS_TRIMESTRALES, haber: aTexto(trimestral) }]
                    : []),
                ...(iso.gt(0) ? [{ cuenta: CUENTAS_GT.ISO_POR_ACREDITAR, haber: aTexto(iso) }] : []),
                ...(porPagar.gt(0) ? [{ cuenta: CUENTAS_GT.ISR_POR_PAGAR, haber: aTexto(porPagar) }] : []),
            ])
        }

        // 2. cancelación de ingresos y gastos contra 3.3.03
        const netos = new Map<string, { cuenta: number | string; neto: Dec }>()
        for (const c of saldos) netos.set(c.codigo, { cuenta: c.cuenta_id, neto: c.neto })
        if (isoVencido.gt(0)) {
            const actual = netos.get(CUENTAS_GT.IMPUESTOS_DEDUCIBLES)
            netos.set(CUENTAS_GT.IMPUESTOS_DEDUCIBLES, {
                cuenta: actual?.cuenta ?? CUENTAS_GT.IMPUESTOS_DEDUCIBLES,
                neto: (actual?.neto ?? CERO).plus(isoVencido),
            })
        }
        if (isr.gt(0)) {
            const actual = netos.get(CUENTAS_GT.IMPUESTO_SOBRE_RENTA)
            netos.set(CUENTAS_GT.IMPUESTO_SOBRE_RENTA, {
                cuenta: actual?.cuenta ?? CUENTAS_GT.IMPUESTO_SOBRE_RENTA,
                neto: (actual?.neto ?? CERO).plus(isr),
            })
        }
        const cancelacion: LineaAsiento[] = []
        for (const { cuenta, neto } of netos.values()) {
            if (neto.isZero()) continue
            cancelacion.push(
                neto.gt(0) ? { cuenta, haber: aTexto(neto) } : { cuenta, debe: aTexto(neto.negated()) },
            )
        }
        if (cancelacion.length > 0) {
            // contrapartida: 3.3.03 recibe la utilidad al haber (o la pérdida al debe)
            if (!resultado.isZero()) {
                cancelacion.push(
                    resultado.gt(0)
                        ? { cuenta: CUENTAS_GT.PERDIDAS_GANANCIAS, haber: aTexto(resultado) }
                        : { cuenta: CUENTAS_GT.PERDIDAS_GANANCIAS, debe: aTexto(resultado.negated()) },
                )
            }
            await asiento('cancelación de ingresos y gastos', cancelacion)
        }

        // 3 y 4. traslado del resultado: 3.3.03 → 3.3.02 → 3.3.01
        if (!resultado.isZero()) {
            const monto = aTexto(resultado.abs())
            const utilidad = resultado.gt(0)
            await asiento(utilidad ? 'traslado de la utilidad' : 'traslado de la pérdida', [
                { cuenta: CUENTAS_GT.PERDIDAS_GANANCIAS, [utilidad ? 'debe' : 'haber']: monto },
                { cuenta: CUENTAS_GT.RESULTADO_EJERCICIO, [utilidad ? 'haber' : 'debe']: monto },
            ])
            await asiento(utilidad ? 'utilidad a utilidades acumuladas' : 'pérdida a utilidades acumuladas', [
                { cuenta: CUENTAS_GT.RESULTADO_EJERCICIO, [utilidad ? 'debe' : 'haber']: monto },
                { cuenta: CUENTAS_GT.UTILIDADES_ACUMULADAS, [utilidad ? 'haber' : 'debe']: monto },
            ])
        }

        // 5. reserva legal
        if (reserva.gt(0)) {
            await asiento(`reserva legal (${pct.toString()} %)`, [
                { cuenta: CUENTAS_GT.UTILIDADES_ACUMULADAS, debe: aTexto(reserva) },
                { cuenta: CUENTAS_GT.RESERVA_LEGAL, haber: aTexto(reserva) },
            ])
        }

        // 6. diciembre se cierra con los asientos del cierre adentro
        await new CerrarPeriodo().execute(
            { empresa_id: empresaId, anio, mes: 12, ahora: input.ahora },
            t.ctx,
            {
                trx: t.trx,
            },
        )

        // 7. lista de verificación anual (§10.5): con los asientos del cierre adentro
        await new VerificarCierre().execute(
            { empresa_id: empresaId, tipo: 'anual', periodo: String(anio) },
            t.ctx,
            {
                trx: t.trx,
            },
        )
        await exigirChecks(t.trx, empresaId, 'anual', `${anio}-01-01`)

        await t.emit('ejercicio.cerrado', {
            empresa_id: empresaId,
            cierre_id: cierreId,
            anio,
            resultado: aTexto(resultado),
            isr: aTexto(isr),
            reserva_legal: aTexto(reserva),
        })
        return verCierreAnual(cierreId, t.trx)
    }
}

function montoIsr(valor: string | null | undefined, campo: string): Dec {
    if (valor === undefined || valor === null || !/^\d{1,12}(\.\d{1,2})?$/.test(String(valor).trim())) {
        throw new ValidacionFallida([
            {
                field: campo,
                message: 'Monto obligatorio con hasta 2 decimales (0.00 si no hay ISR)',
                rule: 'isr_obligatorio',
            },
        ])
    }
    return dec(String(valor).trim())
}

/**
 * ISR del cierre: de la declaración ISR anual del año si existe (fase 7 PR C), si no el dato manual. Con
 * declaración, el dato manual se rechaza (422 `isr_de_declaracion`).
 */
async function isrDelEjercicio(
    t: Transaccion,
    empresaId: number,
    anio: number,
    manual: EntradaCerrarEjercicio['isr'],
): Promise<{ isr: Dec; trimestral: Dec; iso: Dec; nota: string | null; declaracionId: number | null }> {
    const anual = await ultimaVersion(t.trx, empresaId, 'isr_anual', `${anio}-01-01`)
    if (!anual) {
        return {
            isr: montoIsr(manual?.monto, 'isr.monto'),
            trimestral: montoIsr(manual?.acreditado_trimestral ?? '0', 'isr.acreditado_trimestral'),
            iso: montoIsr(manual?.acreditado_iso ?? '0', 'isr.acreditado_iso'),
            nota: manual?.nota?.trim() || null,
            declaracionId: null,
        }
    }
    if (manual) {
        throw new Problema(
            422,
            'isr_de_declaracion',
            'ISR de la declaración',
            `El ejercicio ${anio} tiene declaración ISR anual: el ISR del cierre sale de ella, no se escribe a mano`,
            [
                {
                    field: 'isr.monto',
                    message: 'El ISR sale de la declaración anual',
                    rule: 'isr_de_declaracion',
                },
            ],
        )
    }
    if (anual.estado !== 'revisada' && anual.estado !== 'presentada') {
        throw new Problema(
            422,
            'declaracion_sin_revisar',
            'Declaración ISR anual sin revisar',
            `La declaración ISR anual ${anio} (versión ${anual.version}) está en ${anual.estado}: revísela antes de cerrar el ejercicio`,
            [
                {
                    field: 'anio',
                    message: `Declaración ${anual.id} en ${anual.estado}`,
                    rule: 'declaracion_sin_revisar',
                },
            ],
        )
    }
    if ((await hashActual(t.trx, anual)) !== anual.datos_hash) {
        throw new Conflicto(
            `Los datos del ISR anual ${anio} cambiaron desde que se calculó la versión ${anual.version}: calcule y revise una sustitutiva antes de cerrar`,
            'declaracion_desactualizada',
            'Declaración desactualizada',
        )
    }
    const tt = anual.totales
    return {
        isr: dec(tt.isr ?? '0'),
        trimestral: dec(tt.trimestral_acreditado ?? '0'),
        iso: dec(tt.iso_acreditado ?? '0'),
        nota: `Declaración ISR anual ${anual.id} (versión ${anual.version})`,
        declaracionId: anual.id,
    }
}

async function requisitos(t: Transaccion, empresaId: number, anio: number): Promise<ErrorCampo[]> {
    const errores: ErrorCampo[] = []
    const abiertos: string[] = []
    for (let mes = 1; mes <= 11; mes++) {
        const periodo = `${anio}-${String(mes).padStart(2, '0')}-01`
        if (!(await periodoCerrado(t.trx, periodo, empresaId))) abiertos.push(periodo.slice(0, 7))
    }
    if (abiertos.length > 0) {
        errores.push({
            field: 'anio',
            message: `Meses sin cerrar: ${abiertos.join(', ')}`,
            rule: 'meses_abiertos',
        })
    }
    if (await periodoCerrado(t.trx, `${anio}-12-01`, empresaId)) {
        errores.push({
            field: 'anio',
            message: `Diciembre de ${anio} está cerrado: los asientos del cierre van en él (reábrelo)`,
            rule: 'diciembre_cerrado',
        })
    }
    const { rows: dte } = (await t.trx.rawQuery(
        `SELECT count(*)::int AS n FROM fiscal.dte d
          WHERE d.empresa_id = ? AND d.estado = ANY (?)
            AND extract(year FROM (d.fecha_emision AT TIME ZONE 'America/Guatemala'))::int = ?`,
        [empresaId, ESTADOS_DTE_PENDIENTES, anio],
    )) as { rows: Array<{ n: number }> }
    if ((dte[0]?.n ?? 0) > 0) {
        errores.push({
            field: 'anio',
            message: `${dte[0]!.n} DTE sin certificar emitidos en ${anio}`,
            rule: 'dte_pendientes',
        })
    }
    // un año anterior con ingresos o gastos sin cerrar: los traslados a 3.3.01 van en orden
    const { rows: anteriores } = (await t.trx.rawQuery(
        `SELECT DISTINCT extract(year FROM a.fecha)::int AS anio
           FROM ledger.asientos a
           JOIN ledger.movimientos m ON m.asiento_id = a.id
           JOIN ledger.cuentas c ON c.id = m.cuenta_id
          WHERE a.empresa_id = ? AND a.fecha < ?::date AND c.reinicia_anual
            AND NOT ledger.ejercicio_cerrado(a.fecha, a.empresa_id)
          ORDER BY 1`,
        [empresaId, `${anio}-01-01`],
    )) as { rows: Array<{ anio: number }> }
    if (anteriores.length > 0) {
        errores.push({
            field: 'anio',
            message: `Ejercicios anteriores sin cerrar: ${anteriores.map((a) => a.anio).join(', ')}`,
            rule: 'ejercicio_anterior_abierto',
        })
    }
    return errores
}
