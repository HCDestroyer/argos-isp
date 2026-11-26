import { randomUUID } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import {
    LOCK_CONCILIACION,
    buscarContrapartida,
    verConciliacion,
    type ConciliacionVista,
} from '#ledger/conciliacion'
import {
    LOCK_DIFERENCIAS,
    diferenciaPendienteDeLinea,
    evaluarMotivo,
    leerTopes,
    resolverMotivo,
    usadoDelTopeHoy,
    type DiferenciaConciliacionVista,
    type ParteDiferencia,
    type RazonAprobacion,
    type SituacionDiferencia,
    type SolicitudConciliacion,
} from '#ledger/diferencias_conciliacion'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'

/**
 * `bancos.conciliar` (`POST /bancos/conciliaciones`): liga una línea del extracto con lo que ya está
 * en el libro (contrato de localización fiscal §10.3). **Nunca reescribe un asiento.**
 *
 * - `movimientos[]`: movimientos del libro en la cuenta del extracto, de la misma empresa y sin
 *   conciliación vigente; cada uno cuenta por su neto (debe − haber).
 * - `depositos[]` / `traslados[]`: lo que estaba en `1.1.11 Fondos en tránsito` y llega con esta
 *   línea. Se registra su llegada (asiento **nuevo** `Banco / 1.1.11`, mismo origen que el
 *   documento, fecha de la línea) y su movimiento del banco entra a la conciliación.
 * - `diferencias[]` (plan de contabilidad §5.8, B3): lo que explica que la línea no sea igual a lo
 *   emparejado (comisión del banco, redondeo, faltante del depósito…). Cada parte nombra su motivo y
 *   su monto; Σ partes = |línea − emparejado| y todas en el sentido de la diferencia. Cada motivo
 *   tiene su cuenta y su límite (422 `motivo_no_aplica`). La diferencia entra con un asiento **nuevo**
 *   de origen `diferencia_conciliacion` (de menos: `cuenta del motivo / Banco`; de más: `Banco /
 *   cuenta`) cuyo movimiento del banco entra a la conciliación. Si pasa del tope de quien concilia
 *   (por línea o por día) o un motivo siempre pide aprobación: 422 `diferencia_requiere_aprobacion`
 *   (se pide con `POST /bancos/diferencias`).
 * - Σ = monto de la línea (422 `conciliacion_descuadrada`). La línea ya conciliada responde 409
 *   `linea_conciliada`; con una diferencia esperando aprobación, 409 `diferencia_pendiente`; un
 *   movimiento ya conciliado, 409 `movimiento_conciliado`.
 * - Filas en `ledger.conciliaciones` con un mismo `grupo`; evento `banco.conciliado`.
 */

export interface EntradaDiferencia {
    motivo_id: number
    /** monto positivo de esta parte de la diferencia */
    monto: string
    nota?: string | null
    /** código de la cuenta, solo para un motivo sin cuenta propia («otra razón») */
    cuenta?: string | null
}

export interface EntradaConciliarLinea {
    linea_id: number
    movimientos?: number[] | null
    depositos?: number[] | null
    traslados?: number[] | null
    diferencias?: EntradaDiferencia[] | null
    /** interno: regla que la concilió (`bancos.aplicar_reglas`) */
    regla_id?: number | null
    /** interno: diferencia aprobada que se concilia ahora (`bancos.aprobar_diferencia`) */
    diferencia_aprobada?: DiferenciaConciliacionVista | null
}

interface Linea {
    id: number
    empresa_id: number
    cuenta_id: number
    fecha: string
    monto: string
    descripcion: string
    referencia: string | null
}

interface Transito {
    tipo: 'deposito' | 'traslado'
    id: number
    monto: Dec
    fecha: string
}

/** Todo lo que se valida antes de tocar el libro (lo comparten conciliar y pedir aprobación). */
export interface ConciliacionPreparada {
    linea: Linea
    empresa_id: number
    solicitud: SolicitudConciliacion
    netos: Map<number, Dec>
    transitos: Transito[]
    /** línea − emparejado */
    diferencia: Dec
    sentido: 'menos' | 'mas'
    partes: ParteDiferencia[]
    contra_tope: Dec
    razones: RazonAprobacion[]
}

/**
 * Valida la línea, lo emparejado y las diferencias. Toma el lock de la cuenta (y el de diferencias de
 * la empresa si hay diferencia). Con `aprobada`, las partes son las que se aprobaron (no se vuelven a
 * evaluar contra los motivos ni el tope).
 */
export async function prepararConciliacion(
    t: Transaccion,
    input: EntradaConciliarLinea,
): Promise<ConciliacionPreparada> {
    const linea = (await t.trx
        .from('ledger.extractos_lineas')
        .where('id', input.linea_id)
        .select(
            'id',
            'empresa_id',
            'cuenta_id',
            t.trx.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`),
            'monto',
            'descripcion',
            'referencia',
        )
        .first()) as Linea | null
    if (!linea) throw new NoEncontrado(`La línea de extracto ${input.linea_id} no existe`)
    const empresaId = Number(linea.empresa_id)
    exigirAccesoEmpresa(t.ctx, empresaId)
    t.fijarEmpresa(empresaId)
    t.fijarEntidad('extracto_linea', linea.id)
    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?::int)', [LOCK_CONCILIACION, linea.cuenta_id])

    const yaConciliada = await t.trx
        .from('ledger.conciliaciones as k')
        .where('k.linea_id', linea.id)
        .whereNotExists((q) =>
            q.from('ledger.conciliaciones_anulaciones as x').whereRaw('x.conciliacion_id = k.id'),
        )
        .select('k.id')
        .first()
    if (yaConciliada) {
        throw new Conflicto(
            `La línea ${linea.id} ya está conciliada (conciliación ${yaConciliada.id}); anúlala primero`,
            'linea_conciliada',
            'Línea conciliada',
        )
    }
    const pendiente = await diferenciaPendienteDeLinea(linea.id, t.trx)
    if (pendiente !== null && pendiente !== input.diferencia_aprobada?.id) {
        throw new Conflicto(
            `La línea ${linea.id} tiene una diferencia esperando aprobación (${pendiente}); apruébala o recházala primero`,
            'diferencia_pendiente',
            'Diferencia esperando aprobación',
        )
    }

    const movimientosIds = [...new Set(input.movimientos ?? [])]
    const depositosIds = [...new Set(input.depositos ?? [])]
    const trasladosIds = [...new Set(input.traslados ?? [])]
    if (movimientosIds.length + depositosIds.length + trasladosIds.length === 0) {
        throw new ValidacionFallida([
            {
                field: 'movimientos',
                message: 'Indica los movimientos, depósitos o traslados de la línea',
                rule: 'required',
            },
        ])
    }

    const errores: ErrorCampo[] = []
    let suma = CERO
    const movimientos = (await t.trx
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .whereIn('m.id', movimientosIds.length > 0 ? movimientosIds : [0])
        .select(
            'm.id',
            'm.cuenta_id',
            'a.empresa_id',
            'a.origen_tipo',
            'a.origen_id',
            t.trx.raw('(m.debe - m.haber)::text as neto'),
            t.trx.raw(
                `EXISTS (SELECT 1 FROM ledger.conciliaciones k WHERE k.movimiento_id = m.id
                   AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = k.id)) as conciliado`,
            ),
        )) as Array<{
        id: number
        cuenta_id: number
        empresa_id: number
        origen_tipo: string
        origen_id: number | null
        neto: string
        conciliado: boolean
    }>
    const porId = new Map(movimientos.map((m) => [Number(m.id), m]))
    const conciliados: ErrorCampo[] = []
    movimientosIds.forEach((id, i) => {
        const m = porId.get(id)
        if (!m || Number(m.cuenta_id) !== Number(linea.cuenta_id) || Number(m.empresa_id) !== empresaId) {
            errores.push({
                field: `movimientos.${i}`,
                message: `El movimiento ${id} no es de la cuenta del extracto en esta empresa`,
                rule: 'otra_cuenta',
            })
        } else if (m.conciliado) {
            conciliados.push({
                field: `movimientos.${i}`,
                message: `El movimiento ${id} ya está conciliado`,
                rule: 'movimiento_conciliado',
            })
        } else {
            suma = suma.plus(m.neto)
        }
    })
    const transitos = [
        ...(await enTransito(t, 'deposito', depositosIds, linea, errores)),
        ...(await enTransito(t, 'traslado', trasladosIds, linea, errores)),
    ]
    for (const x of transitos) suma = suma.plus(x.monto)
    if (conciliados.length > 0) {
        throw new Problema(
            409,
            'movimiento_conciliado',
            'Movimiento conciliado',
            'Un movimiento se concilia una sola vez',
            conciliados,
        )
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)

    const diferencia = dec(linea.monto).minus(suma)
    const sentido: 'menos' | 'mas' = diferencia.isNegative() ? 'menos' : 'mas'
    const entradas = input.diferencias ?? []
    const aprobada = input.diferencia_aprobada ?? null
    if (!aprobada && entradas.length === 0 && !diferencia.isZero()) {
        throw new Problema(
            422,
            'conciliacion_descuadrada',
            'Conciliación descuadrada',
            `La línea es de Q${aTexto(linea.monto)} y lo elegido suma Q${aTexto(suma)}: explica la diferencia de Q${aTexto(diferencia.abs())} con un motivo (diferencias[])`,
            [{ field: 'movimientos', message: `Σ = Q${aTexto(suma)}`, rule: 'conciliacion_descuadrada' }],
        )
    }
    const preparada: ConciliacionPreparada = {
        linea,
        empresa_id: empresaId,
        solicitud: { movimientos: movimientosIds, depositos: depositosIds, traslados: trasladosIds },
        netos: new Map(movimientosIds.map((id) => [id, dec(porId.get(id)!.neto)])),
        transitos,
        diferencia,
        sentido,
        partes: [],
        contra_tope: CERO,
        razones: [],
    }
    if (aprobada) {
        const total = aprobada.partes.reduce((s, p) => s.plus(p.monto), CERO)
        if (!total.equals(diferencia.abs()) || aprobada.sentido !== sentido) {
            throw new Problema(
                422,
                'diferencias_descuadradas',
                'Diferencia distinta',
                `La diferencia aprobada (Q${aTexto(total)}) ya no explica la línea (Q${aTexto(diferencia.abs())})`,
            )
        }
        preparada.partes = aprobada.partes
        return preparada
    }
    if (entradas.length === 0) return preparada

    if (diferencia.isZero()) {
        throw new ValidacionFallida([
            {
                field: 'diferencias',
                message: 'La línea ya cuadra con lo elegido: no hay diferencia que explicar',
                rule: 'sin_diferencia',
            },
        ])
    }
    await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?::int)', [LOCK_DIFERENCIAS, empresaId])
    const total = entradas.reduce((s, d) => s.plus(dec(d.monto)), CERO)
    if (!total.equals(diferencia.abs())) {
        throw new Problema(
            422,
            'diferencias_descuadradas',
            'Diferencias descuadradas',
            `La diferencia es de Q${aTexto(diferencia.abs())} y los motivos suman Q${aTexto(total)}`,
            [{ field: 'diferencias', message: `Σ = Q${aTexto(total)}`, rule: 'diferencias_descuadradas' }],
        )
    }

    // ¿qué se emparejó? (para «cuándo se ofrece» y el faltante a cargo de quien llevó el depósito)
    const origenes = movimientosIds.map((id) => porId.get(id)!)
    const depositosDeMovs = origenes
        .filter((m) => m.origen_tipo === 'deposito' && m.origen_id !== null)
        .map((m) => Number(m.origen_id))
    const depositos = [...depositosIds, ...depositosDeMovs]
    const situacion: SituacionDiferencia = {
        sentido,
        base: suma.abs(),
        hay_deposito: depositos.length > 0,
        hay_cobro: origenes.some((m) => m.origen_tipo === 'pago' || m.origen_tipo === 'liquidacion_cobro'),
        cuenta_id: Number(linea.cuenta_id),
        texto: `${linea.descripcion} ${linea.referencia ?? ''}`,
    }
    let responsable: number | null = null
    if (depositos.length > 0) {
        const dep = (await t.trx
            .from('ledger.depositos')
            .whereIn('id', depositos)
            .orderBy('id')
            .select('registrado_por')
            .first()) as { registrado_por: number | null } | null
        responsable =
            dep?.registrado_por === null || dep?.registrado_por === undefined
                ? null
                : Number(dep.registrado_por)
    }

    const fallas: ErrorCampo[] = []
    for (const [i, entrada] of entradas.entries()) {
        const monto = dec(entrada.monto)
        if (!monto.isPositive() || monto.isZero()) {
            fallas.push({
                field: `diferencias.${i}.monto`,
                message: 'Monto mayor que cero',
                rule: 'positivo',
            })
            continue
        }
        const motivo = await resolverMotivo(empresaId, entrada.motivo_id, t.trx)
        if (!motivo) {
            fallas.push({
                field: `diferencias.${i}.motivo_id`,
                message: `El motivo ${entrada.motivo_id} no es de esta empresa`,
                rule: 'motivo',
            })
            continue
        }
        const evaluacion = evaluarMotivo(motivo, situacion, monto)
        if (!evaluacion.aplica) {
            fallas.push({
                field: `diferencias.${i}.motivo_id`,
                message: `${motivo.nombre}: ${evaluacion.razon}`,
                rule: 'motivo_no_aplica',
            })
            continue
        }
        const codigo = motivo.cuenta_codigo ?? entrada.cuenta?.trim() ?? ''
        if (!codigo) {
            fallas.push({
                field: `diferencias.${i}.cuenta`,
                message: `${motivo.nombre}: elige la cuenta a la que va`,
                rule: 'required',
            })
            continue
        }
        const cuenta = await buscarContrapartida(t.trx, codigo, empresaId)
        if (!cuenta) {
            fallas.push({
                field: `diferencias.${i}.cuenta`,
                message: `La cuenta ${codigo} no sirve (debe ser imputable, sin auxiliar y no de dinero ni puente)`,
                rule: 'contrapartida',
            })
            continue
        }
        const nota = entrada.nota?.trim() || null
        preparada.partes.push({
            motivo_id: motivo.id,
            codigo: motivo.codigo,
            nombre: motivo.nombre,
            cuenta: cuenta.codigo,
            monto: aTexto(monto),
            nota,
            contra_tope: motivo.cuenta_contra_tope,
            siempre_aprobacion: motivo.siempre_aprobacion,
            responsable_id: motivo.se_ofrece_en === 'depositos' ? responsable : null,
        })
    }
    if (fallas.length > 0) {
        const motivoNoAplica = fallas.some((f) => f.rule === 'motivo_no_aplica')
        if (motivoNoAplica) {
            throw new Problema(
                422,
                'motivo_no_aplica',
                'Motivo que no aplica',
                'Un motivo no aplica a esta diferencia o pasa de su límite',
                fallas,
            )
        }
        throw new ValidacionFallida(fallas)
    }

    // tope de quien concilia: por línea y por día (lo aceptado hoy sin aprobación, todavía vigente)
    const topes = await leerTopes(empresaId, t.trx)
    preparada.contra_tope = preparada.partes
        .filter((p) => p.contra_tope)
        .reduce((s, p) => s.plus(p.monto), CERO)
    if (preparada.partes.some((p) => p.siempre_aprobacion)) preparada.razones.push('motivo')
    if (preparada.contra_tope.gt(topes.tope_linea)) preparada.razones.push('tope_linea')
    if (preparada.contra_tope.gt(CERO)) {
        const usado = await usadoDelTopeHoy(empresaId, usuarioDelActor(t.ctx.actor), hoyGuatemala(), t.trx)
        if (usado.plus(preparada.contra_tope).gt(topes.tope_dia)) preparada.razones.push('tope_dia')
    }
    return preparada
}

/** Depósitos o traslados en tránsito que llegan a la cuenta de la línea. */
async function enTransito(
    t: Transaccion,
    tipo: 'deposito' | 'traslado',
    ids: number[],
    linea: Linea,
    errores: ErrorCampo[],
): Promise<Transito[]> {
    if (ids.length === 0) return []
    const tabla = tipo === 'deposito' ? 'ledger.depositos' : 'ledger.traslados'
    const destino = tipo === 'deposito' ? 'cuenta_id' : 'cuenta_destino_id'
    const filas = (await t.trx
        .from(`${tabla} as d`)
        .whereIn('d.id', ids)
        .select(
            'd.id',
            'd.empresa_id',
            `d.${destino} as cuenta_id`,
            'd.monto',
            t.trx.raw(`to_char(d.fecha, 'YYYY-MM-DD') as fecha`),
            t.trx.raw(
                `EXISTS (SELECT 1 FROM ledger.transitos_acreditados x WHERE x.tipo = ? AND x.documento_id = d.id AND NOT EXISTS (SELECT 1 FROM ledger.transitos_reatribuciones rr WHERE rr.acreditado_id = x.id)) as acreditado`,
                [tipo],
            ),
        )) as Array<{
        id: number
        empresa_id: number
        cuenta_id: number
        monto: string
        fecha: string
        acreditado: boolean
    }>
    const porId = new Map(filas.map((f) => [Number(f.id), f]))
    const campo = tipo === 'deposito' ? 'depositos' : 'traslados'
    const salida: Transito[] = []
    ids.forEach((id, i) => {
        const f = porId.get(id)
        if (
            !f ||
            Number(f.empresa_id) !== Number(linea.empresa_id) ||
            Number(f.cuenta_id) !== Number(linea.cuenta_id)
        ) {
            errores.push({
                field: `${campo}.${i}`,
                message: `El ${tipo} ${id} no llega a la cuenta del extracto`,
                rule: 'otra_cuenta',
            })
        } else if (f.acreditado) {
            errores.push({
                field: `${campo}.${i}`,
                message: `El ${tipo} ${id} ya llegó al banco`,
                rule: 'acreditado',
            })
        } else {
            salida.push({ tipo, id, monto: dec(f.monto), fecha: f.fecha })
        }
    })
    return salida
}

/** Texto de las razones por las que una diferencia pide aprobación. */
export function textoRazones(razones: RazonAprobacion[]): ErrorCampo[] {
    const textos: Record<RazonAprobacion, string> = {
        motivo: 'El motivo elegido siempre pide aprobación',
        tope_linea: 'Pasa del tope por línea de quien concilia',
        tope_dia: 'Pasa del tope del día de quien concilia',
    }
    return razones.map((r) => ({ field: 'diferencias', message: textos[r], rule: r }))
}

export default class ConciliarLinea extends DomainAction<EntradaConciliarLinea, ConciliacionVista> {
    readonly nombre = 'bancos.conciliar'

    protected async handle(input: EntradaConciliarLinea, t: Transaccion): Promise<ConciliacionVista> {
        const p = await prepararConciliacion(t, input)
        const { linea, empresa_id: empresaId } = p
        if (p.razones.length > 0) {
            throw new Problema(
                422,
                'diferencia_requiere_aprobacion',
                'La diferencia necesita aprobación',
                `La diferencia de Q${aTexto(p.diferencia.abs())} necesita la aprobación de quien tenga bancos.aprobar_diferencia: pídela con POST /bancos/diferencias`,
                textoRazones(p.razones),
            )
        }

        // llegada de lo que estaba en tránsito: asiento nuevo Banco / 1.1.11 con la fecha de la línea
        const nuevos: Array<{ id: number; neto: Dec }> = []
        for (const x of p.transitos) {
            const fecha = x.fecha > linea.fecha ? x.fecha : linea.fecha
            const asiento = await new RegistrarAsiento().execute(
                {
                    empresa_id: empresaId,
                    fecha,
                    descripcion: `Llegada al banco del ${x.tipo === 'deposito' ? 'depósito' : 'traslado'} ${x.id} (línea ${linea.id} del extracto)`,
                    origen_tipo: x.tipo,
                    origen_id: x.id,
                    // automático: con la fecha cerrada o bloqueada va al primer día abierto (§10.4)
                    trasladar_si_bloqueado: true,
                    movimientos: [
                        { cuenta: Number(linea.cuenta_id), debe: aTexto(x.monto) },
                        { cuenta: CUENTAS_GT.FONDOS_EN_TRANSITO, haber: aTexto(x.monto) },
                    ],
                },
                t.ctx,
                { trx: t.trx },
            )
            await t.trx
                .insertQuery()
                .table('ledger.transitos_acreditados')
                .insert({
                    empresa_id: empresaId,
                    tipo: x.tipo,
                    documento_id: x.id,
                    cuenta_id: Number(linea.cuenta_id),
                    fecha,
                    linea_id: linea.id,
                    creado_por: usuarioDelActor(t.ctx.actor),
                })
            const mov = asiento.movimientos.find((m) => Number(m.cuenta_id) === Number(linea.cuenta_id))!
            nuevos.push({ id: mov.id, neto: x.monto })
        }

        // la diferencia: asiento nuevo de origen diferencia_conciliacion (B3)
        if (p.partes.length > 0) {
            const diferenciaId = input.diferencia_aprobada?.id ?? (await this.guardarDiferencia(t, p))
            const total = aTexto(p.diferencia.abs())
            const partes: LineaAsiento[] = p.partes.map((parte) =>
                p.sentido === 'menos'
                    ? { cuenta: parte.cuenta, debe: parte.monto }
                    : { cuenta: parte.cuenta, haber: parte.monto },
            )
            const banco: LineaAsiento =
                p.sentido === 'menos'
                    ? { cuenta: Number(linea.cuenta_id), haber: total }
                    : { cuenta: Number(linea.cuenta_id), debe: total }
            const asiento = await new RegistrarAsiento().execute(
                {
                    empresa_id: empresaId,
                    fecha: linea.fecha,
                    descripcion: `Diferencia al conciliar la línea ${linea.id} del extracto: ${p.partes
                        .map(
                            (x) =>
                                `${x.nombre} Q${x.monto}${x.responsable_id ? ` (a cargo del usuario ${x.responsable_id})` : ''}`,
                        )
                        .join(', ')}`,
                    origen_tipo: 'diferencia_conciliacion',
                    origen_id: diferenciaId,
                    trasladar_si_bloqueado: true,
                    movimientos: p.sentido === 'menos' ? [...partes, banco] : [banco, ...partes],
                },
                t.ctx,
                { trx: t.trx },
            )
            const mov = asiento.movimientos.find((m) => Number(m.cuenta_id) === Number(linea.cuenta_id))!
            nuevos.push({ id: mov.id, neto: p.diferencia })
        }

        const grupo = randomUUID()
        const filas = [...p.solicitud.movimientos.map((id) => ({ id, neto: p.netos.get(id)! })), ...nuevos]
        const insertadas = (await t.trx
            .insertQuery()
            .table('ledger.conciliaciones')
            .multiInsert(
                filas.map((f) => ({
                    empresa_id: empresaId,
                    cuenta_id: Number(linea.cuenta_id),
                    grupo,
                    linea_id: linea.id,
                    movimiento_id: f.id,
                    monto: aTexto(f.neto),
                    regla_id: input.regla_id ?? null,
                    creado_por: usuarioDelActor(t.ctx.actor),
                })),
            )
            .returning('id')) as Array<{ id: number }>
        const primera = Math.min(...insertadas.map((f) => Number(f.id)))
        t.fijarEntidad('conciliacion', primera)
        const cuentaBancaria = (await t.trx
            .from('billing.cuentas_bancarias')
            .where('cuenta_id', linea.cuenta_id)
            .select('id')
            .first()) as { id: number } | null
        await t.emit('banco.conciliado', {
            conciliacion_id: primera,
            empresa_id: empresaId,
            cuenta_bancaria_id: cuentaBancaria ? Number(cuentaBancaria.id) : null,
            cuenta_id: Number(linea.cuenta_id),
            linea_id: linea.id,
            lineas: 1,
            monto: aTexto(linea.monto),
        })
        return verConciliacion(primera, t.trx)
    }

    /** Fila de la diferencia aceptada dentro del tope (sin aprobación). */
    private async guardarDiferencia(t: Transaccion, p: ConciliacionPreparada): Promise<number> {
        return insertarDiferencia(t, p, null)
    }
}

/** Inserta la fila de la diferencia (aplicada o pedida para aprobación). */
export async function insertarDiferencia(
    t: Transaccion,
    p: ConciliacionPreparada,
    explicacion: string | null,
): Promise<number> {
    const [fila] = (await t.trx
        .insertQuery()
        .table('billing.diferencias_conciliacion')
        .insert({
            empresa_id: p.empresa_id,
            cuenta_id: Number(p.linea.cuenta_id),
            linea_id: p.linea.id,
            sentido: p.sentido,
            monto: aTexto(p.diferencia.abs()),
            monto_contra_tope: aTexto(p.contra_tope),
            requiere_aprobacion: p.razones.length > 0,
            razones: p.razones,
            solicitud: JSON.stringify(p.solicitud),
            detalle: JSON.stringify(p.partes),
            explicacion,
            fecha: hoyGuatemala(),
            solicitado_por: usuarioDelActor(t.ctx.actor),
        })
        .returning('id')) as Array<{ id: number }>
    return Number(fila!.id)
}
