import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { aTexto, dec, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import { listarReglas, reglaCoincide, sinParAnulado } from '#ledger/conciliacion'
import {
    evaluarMotivo,
    leerTopes,
    motivosEfectivos,
    porIdentificarDe,
    usadoDelTopeHoy,
    type PorIdentificar,
} from '#ledger/diferencias_conciliacion'

/**
 * Sugerencias de conciliación por línea (plan de contabilidad §5.8 y tablero `PlanContaConciliar`,
 * B3). Solo lectura: nada entra al libro hasta que alguien acepta.
 *
 * Candidatos de una línea: movimientos del libro sin conciliar en la cuenta del extracto (sin los
 * pares anulados por un reverso), depósitos y traslados en tránsito que llegan a esa cuenta. Niveles:
 *
 * - `segura`: un solo candidato con el mismo monto y la misma referencia (o la referencia del
 *   candidato aparece en el texto del banco), y ese candidato no es la pareja segura de otra línea.
 *   Se aceptan juntas con `POST /bancos/extractos/:id/aceptar-seguras`.
 * - `para_decidir`: mismo monto, pero sin referencia que lo confirme o con varios candidatos
 *   (ordenados por cercanía de fecha).
 * - `con_diferencia`: monto distinto pero cercano (misma referencia hasta 20 %, o fecha a 10 días o
 *   menos y hasta 5 %); trae los motivos con su cuenta y si aplican (y por qué no).
 * - `regla`: sin pareja, pero una regla de contrapartida la reconoce (se registra y concilia).
 * - `sin_pareja`, o `por_identificar` si alguien la marcó con una nota.
 * - `esperando_aprobacion`: tiene una diferencia pedida para aprobación.
 */

export const NIVELES_SUGERENCIA = [
    'segura',
    'para_decidir',
    'con_diferencia',
    'regla',
    'sin_pareja',
    'por_identificar',
    'esperando_aprobacion',
] as const
export type NivelSugerencia = (typeof NIVELES_SUGERENCIA)[number]

export interface CandidatoConciliacion {
    tipo: 'movimiento' | 'deposito' | 'traslado'
    /** id del movimiento, del depósito o del traslado (lo que va en `POST /bancos/conciliaciones`) */
    id: number
    origen_tipo: string
    origen_id: number | null
    fecha: string
    descripcion: string
    referencia: string | null
    monto: string
    /** línea − candidato (0 = mismo monto) */
    diferencia: string
    referencia_coincide: boolean
}

export interface MotivoSugerido {
    motivo_id: number
    nombre: string
    cuenta_codigo: string | null
    aplica: boolean
    razon: string | null
    maximo: string | null
    cuenta_contra_tope: boolean
    siempre_aprobacion: boolean
}

export interface SugerenciaLinea {
    linea_id: number
    fecha: string
    descripcion: string
    referencia: string | null
    monto: string
    nivel: NivelSugerencia
    candidatos: CandidatoConciliacion[]
    regla_id: number | null
    motivos: MotivoSugerido[]
    por_identificar: PorIdentificar | null
    diferencia_pendiente_id: number | null
}

export interface SugerenciasExtracto {
    extracto_id: number
    empresa_id: number
    cuenta_id: number
    lineas: SugerenciaLinea[]
    resumen: Record<NivelSugerencia, number> & { conciliadas: number; en_extracto: number }
    /** tope de quien pregunta: por línea, por día, lo usado hoy y lo que le queda */
    tope: { tope_linea: string; tope_dia: string; usado_hoy: string; disponible_hoy: string }
}

const normal = (texto: string | null | undefined) => (texto ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

function dias(a: string, b: string): number {
    return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

interface Linea {
    id: number
    fecha: string
    descripcion: string
    referencia: string | null
    monto: string
    cuenta_id: number
}

type Candidato = Omit<CandidatoConciliacion, 'diferencia' | 'referencia_coincide'>

async function candidatosDeCuenta(
    cliente: QueryClientContract,
    empresaId: number,
    cuentaId: number,
): Promise<Candidato[]> {
    const movimientos = (
        (await cliente.rawQuery(
            `SELECT m.id, a.origen_tipo, a.origen_id, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, a.descripcion,
                    (m.debe - m.haber)::text AS monto,
                    CASE a.origen_tipo
                        WHEN 'pago' THEN (SELECT p.referencia FROM billing.pagos p WHERE p.id = a.origen_id)
                        WHEN 'deposito' THEN (SELECT d.boleta FROM ledger.depositos d WHERE d.id = a.origen_id)
                        WHEN 'traslado' THEN (SELECT tr.referencia FROM ledger.traslados tr WHERE tr.id = a.origen_id)
                        WHEN 'liquidacion_cobro' THEN (SELECT lq.referencia FROM ledger.liquidaciones_cobro lq WHERE lq.id = a.origen_id)
                    END AS referencia
               FROM ledger.movimientos m JOIN ledger.asientos a ON a.id = m.asiento_id
              WHERE m.cuenta_id = ? AND a.empresa_id = ?
                AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones k WHERE k.movimiento_id = m.id
                      AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = k.id))
                AND ${sinParAnulado(null)}
              ORDER BY a.fecha, m.id`,
            [cuentaId, empresaId],
        )) as { rows: Array<Record<string, unknown>> }
    ).rows
    const transito = (tipo: 'deposito' | 'traslado') =>
        tipo === 'deposito'
            ? `SELECT d.id, to_char(d.fecha, 'YYYY-MM-DD') AS fecha, 'Depósito de caja ' || d.id AS descripcion,
                      d.boleta AS referencia, d.monto::text AS monto
                 FROM ledger.depositos d WHERE d.empresa_id = ? AND d.cuenta_id = ?`
            : `SELECT d.id, to_char(d.fecha, 'YYYY-MM-DD') AS fecha, 'Traslado ' || d.id AS descripcion,
                      d.referencia, d.monto::text AS monto
                 FROM ledger.traslados d WHERE d.empresa_id = ? AND d.cuenta_destino_id = ?`
    const enTransito = async (tipo: 'deposito' | 'traslado') =>
        (
            (await cliente.rawQuery(
                `${transito(tipo)}
                   AND NOT EXISTS (SELECT 1 FROM ledger.transitos_acreditados x WHERE x.tipo = ? AND x.documento_id = d.id
                         AND NOT EXISTS (SELECT 1 FROM ledger.transitos_reatribuciones rr WHERE rr.acreditado_id = x.id))
                 ORDER BY d.fecha, d.id`,
                [empresaId, cuentaId, tipo],
            )) as { rows: Array<Record<string, unknown>> }
        ).rows.map((f) => ({
            tipo,
            id: Number(f.id),
            origen_tipo: tipo,
            origen_id: Number(f.id),
            fecha: String(f.fecha),
            descripcion: String(f.descripcion),
            referencia: (f.referencia as string | null) ?? null,
            monto: aTexto(String(f.monto)),
        }))
    return [
        ...movimientos.map((f) => ({
            tipo: 'movimiento' as const,
            id: Number(f.id),
            origen_tipo: String(f.origen_tipo),
            origen_id: f.origen_id === null ? null : Number(f.origen_id),
            fecha: String(f.fecha),
            descripcion: String(f.descripcion),
            referencia: (f.referencia as string | null) ?? null,
            monto: aTexto(String(f.monto)),
        })),
        ...(await enTransito('deposito')),
        ...(await enTransito('traslado')),
    ]
}

function referenciaCoincide(linea: Linea, candidato: Candidato): boolean {
    const ref = normal(candidato.referencia)
    if (!ref) return false
    if (normal(linea.referencia) === ref) return true
    return ref.length >= 4 && normal(linea.descripcion).includes(ref)
}

function conDiferencia(linea: Linea, c: Candidato): CandidatoConciliacion {
    return {
        ...c,
        diferencia: aTexto(dec(linea.monto).minus(c.monto)),
        referencia_coincide: referenciaCoincide(linea, c),
    }
}

/** Clave de un candidato (para detectar dos líneas que reclaman la misma pareja segura). */
const clave = (c: Candidato) => `${c.tipo}:${c.id}`

export async function sugerenciasDeExtracto(
    extractoId: number,
    usuarioId: number | null,
    cliente: QueryClientContract = db.connection(),
): Promise<SugerenciasExtracto> {
    const extracto = (await cliente
        .from('ledger.extractos')
        .where('id', extractoId)
        .select('id', 'empresa_id', 'cuenta_id')
        .first()) as { id: number; empresa_id: number; cuenta_id: number } | null
    if (!extracto) throw new NoEncontrado(`El extracto ${extractoId} no existe`)
    const empresaId = Number(extracto.empresa_id)
    const cuentaId = Number(extracto.cuenta_id)

    const todas = (await cliente
        .from('ledger.extractos_lineas as l')
        .where('l.extracto_id', extractoId)
        .orderBy('l.orden')
        .select(
            'l.id',
            'l.cuenta_id',
            cliente.raw(`to_char(l.fecha, 'YYYY-MM-DD') as fecha`),
            'l.descripcion',
            'l.referencia',
            'l.monto',
            cliente.raw(
                `EXISTS (SELECT 1 FROM ledger.conciliaciones k WHERE k.linea_id = l.id
                   AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = k.id)) as conciliada`,
            ),
            cliente.raw(
                `(SELECT d.id FROM billing.diferencias_conciliacion d WHERE d.linea_id = l.id AND d.requiere_aprobacion
                   AND NOT EXISTS (SELECT 1 FROM billing.diferencias_conciliacion_decisiones dd WHERE dd.diferencia_id = d.id)
                   ORDER BY d.id DESC LIMIT 1) as abierta_id`,
            ),
        )) as Array<Linea & { conciliada: boolean; abierta_id: number | null }>
    const lineas = todas.filter((l) => !l.conciliada)
    const candidatos = await candidatosDeCuenta(cliente, empresaId, cuentaId)
    const todasLasReglas = await listarReglas([empresaId], cliente)
    const reglas = todasLasReglas.filter((r) => r.activa && r.accion === 'contrapartida')
    const todosLosMotivos = await motivosEfectivos(empresaId, cliente)
    const motivos = todosLosMotivos.filter((m) => m.clase === 'diferencia')
    const notas = await porIdentificarDe(
        lineas.map((l) => Number(l.id)),
        cliente,
    )

    const salida: SugerenciaLinea[] = []
    const seguras = new Map<string, number>()
    for (const l of lineas) {
        const linea: Linea = {
            ...l,
            id: Number(l.id),
            monto: aTexto(l.monto),
            cuenta_id: Number(l.cuenta_id),
        }
        const monto = dec(linea.monto)
        const porCercania = (a: Candidato, b: Candidato) =>
            dias(a.fecha, linea.fecha) - dias(b.fecha, linea.fecha)
        const iguales = candidatos.filter((c) => dec(c.monto).equals(monto))
        const confirmados = iguales.filter((c) => referenciaCoincide(linea, c))
        let nivel: NivelSugerencia
        let elegidos: Candidato[] = []
        let reglaId: number | null = null
        let sugeridos: MotivoSugerido[] = []
        if (confirmados.length === 1) {
            nivel = 'segura'
            elegidos = confirmados
            const k = clave(confirmados[0]!)
            seguras.set(k, (seguras.get(k) ?? 0) + 1)
        } else if (iguales.length > 0) {
            nivel = 'para_decidir'
            elegidos = [...iguales].sort(porCercania).slice(0, 5)
        } else {
            const cercanos = candidatos
                .filter((c) => {
                    const cm = dec(c.monto)
                    if (cm.isZero() || cm.isNegative() !== monto.isNegative()) return false
                    const gap = monto.minus(cm).abs()
                    const proporcion = gap.dividedBy(cm.abs())
                    if (referenciaCoincide(linea, c)) return proporcion.lte('0.20')
                    return dias(c.fecha, linea.fecha) <= 10 && proporcion.lte('0.05')
                })
                .sort((a, b) => {
                    const ra = referenciaCoincide(linea, a) ? 0 : 1
                    const rb = referenciaCoincide(linea, b) ? 0 : 1
                    if (ra !== rb) return ra - rb
                    return monto.minus(a.monto).abs().comparedTo(monto.minus(b.monto).abs())
                })
            if (cercanos.length > 0) {
                nivel = 'con_diferencia'
                elegidos = cercanos.slice(0, 3)
                const mejor = elegidos[0]!
                const gap: Dec = monto.minus(mejor.monto)
                const situacion = {
                    sentido: gap.isNegative() ? ('menos' as const) : ('mas' as const),
                    base: dec(mejor.monto).abs(),
                    hay_deposito: mejor.origen_tipo === 'deposito',
                    hay_cobro: mejor.origen_tipo === 'pago' || mejor.origen_tipo === 'liquidacion_cobro',
                    cuenta_id: cuentaId,
                    texto: `${linea.descripcion} ${linea.referencia ?? ''}`,
                }
                sugeridos = motivos.map((m) => {
                    const ev = evaluarMotivo(m, situacion, gap.abs())
                    return {
                        motivo_id: m.id,
                        nombre: m.nombre,
                        cuenta_codigo: m.cuenta_codigo,
                        aplica: ev.aplica,
                        razon: ev.razon,
                        maximo: ev.maximo,
                        cuenta_contra_tope: m.cuenta_contra_tope,
                        siempre_aprobacion: m.siempre_aprobacion,
                    }
                })
            } else {
                const regla = reglas.find((r) => reglaCoincide(r, linea))
                if (regla) {
                    nivel = 'regla'
                    reglaId = Number(regla.id)
                } else {
                    nivel = 'sin_pareja'
                }
            }
        }
        const nota = notas.get(linea.id) ?? null
        if (nivel === 'sin_pareja' && nota) nivel = 'por_identificar'
        if (l.abierta_id !== null) nivel = 'esperando_aprobacion'
        salida.push({
            linea_id: linea.id,
            fecha: linea.fecha,
            descripcion: linea.descripcion,
            referencia: linea.referencia,
            monto: linea.monto,
            nivel,
            candidatos: elegidos.map((c) => conDiferencia(linea, c)),
            regla_id: reglaId,
            motivos: sugeridos,
            por_identificar: nota,
            diferencia_pendiente_id: l.abierta_id === null ? null : Number(l.abierta_id),
        })
    }
    // una misma pareja reclamada como segura por dos líneas: las dos pasan a «para decidir»
    for (const s of salida) {
        if (
            s.nivel === 'segura' &&
            (seguras.get(`${s.candidatos[0]!.tipo}:${s.candidatos[0]!.id}`) ?? 0) > 1
        ) {
            s.nivel = 'para_decidir'
        }
    }

    const resumen = Object.fromEntries(NIVELES_SUGERENCIA.map((n) => [n, 0])) as Record<
        NivelSugerencia,
        number
    >
    for (const s of salida) resumen[s.nivel] += 1
    const topes = await leerTopes(empresaId, cliente)
    const usado = await usadoDelTopeHoy(empresaId, usuarioId, hoyGuatemala(), cliente)
    const disponible = dec(topes.tope_dia).minus(usado)
    return {
        extracto_id: Number(extracto.id),
        empresa_id: empresaId,
        cuenta_id: cuentaId,
        lineas: salida,
        resumen: { ...resumen, conciliadas: todas.length - lineas.length, en_extracto: todas.length },
        tope: {
            tope_linea: topes.tope_linea,
            tope_dia: topes.tope_dia,
            usado_hoy: aTexto(usado),
            disponible_hoy: aTexto(disponible.isNegative() ? '0' : disponible),
        },
    }
}
