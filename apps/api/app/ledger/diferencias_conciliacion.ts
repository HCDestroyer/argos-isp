import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'

/**
 * Diferencias al conciliar (plan de contabilidad §5.8, lote B3): lectura y reglas puras.
 *
 * - **Ajustes por empresa** (`billing.ajustes_conciliacion`): tope de quien concilia por línea y
 *   por día. Sin fila, los de fábrica (Q 10.00 y Q 50.00, decisión N7 del PM) y `version: 0`.
 * - **Motivos** (`billing.motivos_diferencia`): los de fábrica son globales (`empresa_id` null);
 *   la fila de una empresa con el mismo `codigo` los reemplaza solo en esa empresa. Cada motivo dice
 *   cuándo se ofrece (de más o de menos, depósitos o cobros, cuenta del banco, texto), cuánto se
 *   permite (fijo por línea, % de lo emparejado o sin límite), a qué cuenta va, si cuenta contra el
 *   tope y si siempre pide aprobación. `clase = 'retencion'` queda reservada para B10.
 * - **Diferencias** (`billing.diferencias_conciliacion`, solo inserción): una por conciliación con
 *   diferencia. Estado derivado: `aplicada` (dentro del tope, con asiento), `pendiente`, `aprobada`,
 *   `rechazada` y `anulada` (su asiento se revirtió al deshacer la conciliación).
 */

export const TOPES_FABRICA = { tope_linea: '10.00', tope_dia: '50.00' } as const

export const SENTIDOS_MOTIVO = ['menos', 'mas', 'ambos'] as const
export type SentidoMotivo = (typeof SENTIDOS_MOTIVO)[number]
export const SE_OFRECE_EN = ['cualquiera', 'depositos', 'cobros'] as const
export type SeOfreceEn = (typeof SE_OFRECE_EN)[number]
export const LIMITES_MOTIVO = ['fijo', 'porcentaje', 'sin_limite'] as const
export type LimiteMotivo = (typeof LIMITES_MOTIVO)[number]
export const RAZONES_APROBACION = ['motivo', 'tope_linea', 'tope_dia'] as const
export type RazonAprobacion = (typeof RAZONES_APROBACION)[number]
export const ESTADOS_DIFERENCIA = ['aplicada', 'pendiente', 'aprobada', 'rechazada', 'anulada'] as const
export type EstadoDiferencia = (typeof ESTADOS_DIFERENCIA)[number]

/** Lock por empresa: ajustes, motivos y el tope del día van de uno en uno. */
export const LOCK_DIFERENCIAS = 3031

/*
| Ajustes
*/

export interface Aprobador {
    usuario_id: number
    nombre: string
}

export interface AjustesConciliacion {
    empresa_id: number
    tope_linea: string
    tope_dia: string
    /** 0 = nunca se guardó (valores de fábrica) */
    version: number
    updated_by: number | null
    updated_at: Date | null
    /** usuarios activos con `bancos.aprobar_diferencia` y acceso a la empresa */
    aprobadores: Aprobador[]
}

export async function leerTopes(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<Omit<AjustesConciliacion, 'aprobadores'>> {
    const fila = (await cliente
        .from('billing.ajustes_conciliacion')
        .where('empresa_id', empresaId)
        .select('tope_linea', 'tope_dia', 'version', 'updated_by', 'updated_at')
        .first()) as {
        tope_linea: string
        tope_dia: string
        version: number
        updated_by: number | null
        updated_at: Date
    } | null
    if (!fila) {
        return { empresa_id: empresaId, ...TOPES_FABRICA, version: 0, updated_by: null, updated_at: null }
    }
    return {
        empresa_id: empresaId,
        tope_linea: aTexto(fila.tope_linea),
        tope_dia: aTexto(fila.tope_dia),
        version: Number(fila.version),
        updated_by: fila.updated_by === null ? null : Number(fila.updated_by),
        updated_at: fila.updated_at,
    }
}

/** Usuarios activos con `bancos.aprobar_diferencia` y acceso a la empresa (alcance global o fila). */
export async function aprobadoresDe(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<Aprobador[]> {
    const filas = (await cliente
        .from('core.usuarios as u')
        .where('u.activo', true)
        .whereExists((q) =>
            q
                .from('core.usuarios_roles as ur')
                .join('core.roles_permisos as rp', 'rp.role_id', 'ur.role_id')
                .join('core.permisos as p', 'p.id', 'rp.permiso_id')
                .whereRaw('ur.usuario_id = u.id')
                .where('p.nombre', 'bancos.aprobar_diferencia'),
        )
        .where((q) =>
            q
                .where('u.alcance_global', true)
                .orWhereExists((e) =>
                    e
                        .from('core.usuarios_empresas as ue')
                        .whereRaw('ue.usuario_id = u.id')
                        .where('ue.empresa_id', empresaId),
                ),
        )
        .orderBy('u.nombre')
        .orderBy('u.id')
        .select('u.id', 'u.nombre')) as Array<{ id: number; nombre: string }>
    return filas.map((f) => ({ usuario_id: Number(f.id), nombre: f.nombre }))
}

export async function leerAjustesConciliacion(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<AjustesConciliacion> {
    return { ...(await leerTopes(empresaId, cliente)), aprobadores: await aprobadoresDe(empresaId, cliente) }
}

/*
| Motivos
*/

export interface MotivoDiferenciaVista {
    id: number
    /** null = motivo de fábrica (vale para todas las empresas que no lo cambiaron) */
    empresa_id: number | null
    codigo: string | null
    clase: 'diferencia' | 'retencion'
    nombre: string
    sentido: SentidoMotivo
    se_ofrece_en: SeOfreceEn
    cuenta_banco_id: number | null
    texto: string | null
    limite_tipo: LimiteMotivo
    limite_valor: string | null
    /** código de la cuenta; null = la elige quien concilia */
    cuenta_codigo: string | null
    cuenta_nombre: string | null
    cuenta_contra_tope: boolean
    siempre_aprobacion: boolean
    fija: boolean
    activo: boolean
    orden: number
    version: number
    created_at: Date
    updated_at: Date
}

function normalizarMotivo(f: Record<string, unknown>): MotivoDiferenciaVista {
    const id = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return {
        id: Number(f.id),
        empresa_id: id(f.empresa_id),
        codigo: (f.codigo as string | null) ?? null,
        clase: f.clase as MotivoDiferenciaVista['clase'],
        nombre: String(f.nombre),
        sentido: f.sentido as SentidoMotivo,
        se_ofrece_en: f.se_ofrece_en as SeOfreceEn,
        cuenta_banco_id: id(f.cuenta_banco_id),
        texto: (f.texto as string | null) ?? null,
        limite_tipo: f.limite_tipo as LimiteMotivo,
        limite_valor: f.limite_valor === null ? null : aTexto(String(f.limite_valor)),
        cuenta_codigo: (f.cuenta_codigo as string | null) ?? null,
        cuenta_nombre: (f.cuenta_nombre as string | null) ?? null,
        cuenta_contra_tope: Boolean(f.cuenta_contra_tope),
        siempre_aprobacion: Boolean(f.siempre_aprobacion),
        fija: Boolean(f.fija),
        activo: Boolean(f.activo),
        orden: Number(f.orden),
        version: Number(f.version),
        created_at: f.created_at as Date,
        updated_at: f.updated_at as Date,
    }
}

function consultaMotivos(cliente: QueryClientContract) {
    return cliente.from('billing.motivos_diferencia as md').select(
        'md.*',
        cliente.raw(
            `(SELECT c.nombre FROM ledger.cuentas c WHERE c.codigo = md.cuenta_codigo AND c.pais = 'GT'
                   AND (c.empresa_id IS NULL OR c.empresa_id = md.empresa_id) ORDER BY c.empresa_id NULLS LAST LIMIT 1) as cuenta_nombre`,
        ),
    )
}

/**
 * Motivos que valen en la empresa: los propios y los de fábrica que la empresa no reemplazó (mismo
 * `codigo`). Ordenados por `orden` e id.
 */
export async function motivosEfectivos(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<MotivoDiferenciaVista[]> {
    const filas = (await consultaMotivos(cliente)
        .where((q) =>
            q
                .where('md.empresa_id', empresaId)
                .orWhere((g) =>
                    g
                        .whereNull('md.empresa_id')
                        .whereNotExists((x) =>
                            x
                                .from('billing.motivos_diferencia as p')
                                .where('p.empresa_id', empresaId)
                                .whereRaw('p.codigo = md.codigo'),
                        ),
                ),
        )
        .orderBy('md.orden')
        .orderBy('md.id')) as Array<Record<string, unknown>>
    return filas.map(normalizarMotivo)
}

export async function verMotivo(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<MotivoDiferenciaVista> {
    const fila = (await consultaMotivos(cliente).where('md.id', id).first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`El motivo de diferencia ${id} no existe`)
    return normalizarMotivo(fila)
}

/**
 * El motivo que vale en la empresa para `motivoId`: si es de fábrica y la empresa lo reemplazó, el
 * de la empresa. null si no existe o es de otra empresa.
 */
export async function resolverMotivo(
    empresaId: number,
    motivoId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<MotivoDiferenciaVista | null> {
    const fila = (await cliente
        .from('billing.motivos_diferencia')
        .where('id', motivoId)
        .select('id', 'empresa_id', 'codigo')
        .first()) as { id: number; empresa_id: number | null; codigo: string | null } | null
    if (!fila) return null
    if (fila.empresa_id !== null) {
        return Number(fila.empresa_id) === empresaId ? verMotivo(Number(fila.id), cliente) : null
    }
    const propio = (await cliente
        .from('billing.motivos_diferencia')
        .where({ empresa_id: empresaId, codigo: fila.codigo })
        .select('id')
        .first()) as { id: number } | null
    return verMotivo(Number(propio?.id ?? fila.id), cliente)
}

/** Lo que el motivo necesita saber de la conciliación para decidir si se ofrece. */
export interface SituacionDiferencia {
    /** `menos`: el banco muestra menos que lo emparejado; `mas`: más */
    sentido: 'menos' | 'mas'
    /** |Σ lo emparejado|: base del límite por porcentaje */
    base: Dec
    /** se emparejó un depósito de caja (o su movimiento) */
    hay_deposito: boolean
    /** se emparejó un cobro (pago o liquidación de un proveedor de cobro) */
    hay_cobro: boolean
    /** cuenta del banco de la línea */
    cuenta_id: number
    /** descripción y referencia de la línea */
    texto: string
}

export interface EvaluacionMotivo {
    aplica: boolean
    /** por qué no aplica (texto para quien concilia) */
    razon: string | null
    /** máximo que permite el motivo en esta línea; null = sin límite */
    maximo: string | null
}

/** ¿El motivo admite `monto` en esta situación? Pura (sin base de datos). */
export function evaluarMotivo(
    motivo: MotivoDiferenciaVista,
    situacion: SituacionDiferencia,
    monto: Dec,
): EvaluacionMotivo {
    const maximo =
        motivo.limite_tipo === 'fijo'
            ? dec(motivo.limite_valor)
            : motivo.limite_tipo === 'porcentaje'
              ? redondear(situacion.base.times(dec(motivo.limite_valor)).dividedBy(100))
              : null
    const no = (razon: string): EvaluacionMotivo => ({
        aplica: false,
        razon,
        maximo: maximo === null ? null : aTexto(maximo),
    })
    if (!motivo.activo) return no('El motivo está apagado')
    if (motivo.clase !== 'diferencia') return no('Las retenciones se aplican desde la factura del cliente')
    if (motivo.sentido !== 'ambos' && motivo.sentido !== situacion.sentido) {
        return no(
            motivo.sentido === 'menos'
                ? 'Solo cuando el banco muestra de menos'
                : 'Solo cuando el banco muestra de más',
        )
    }
    if (motivo.se_ofrece_en === 'depositos' && !situacion.hay_deposito) {
        return no('Solo para depósitos de efectivo')
    }
    if (motivo.se_ofrece_en === 'cobros' && !situacion.hay_cobro) {
        return no('Solo para cobros de pasarela o agente')
    }
    if (motivo.cuenta_banco_id !== null && motivo.cuenta_banco_id !== situacion.cuenta_id) {
        return no('Solo para otra cuenta del banco')
    }
    if (motivo.texto !== null && !situacion.texto.toLowerCase().includes(motivo.texto.toLowerCase())) {
        return no(`Solo si el banco dice «${motivo.texto}»`)
    }
    if (maximo !== null && monto.gt(maximo)) {
        return no(`Solo hasta Q ${aTexto(maximo)}`)
    }
    return { aplica: true, razon: null, maximo: maximo === null ? null : aTexto(maximo) }
}

/*
| Diferencias
*/

/** Lo emparejado que la diferencia completa (para volver a conciliar al aprobar). */
export interface SolicitudConciliacion {
    movimientos: number[]
    depositos: number[]
    traslados: number[]
}

/** Una parte de la diferencia, ya resuelta contra su motivo (lo que queda guardado). */
export interface ParteDiferencia {
    motivo_id: number
    codigo: string | null
    nombre: string
    /** código de la cuenta a la que va */
    cuenta: string
    monto: string
    nota: string | null
    contra_tope: boolean
    siempre_aprobacion: boolean
    /** quien llevó el depósito (faltante a su cargo); null si no aplica */
    responsable_id: number | null
}

export interface DiferenciaConciliacionVista {
    id: number
    empresa_id: number
    cuenta_id: number
    linea_id: number
    extracto_id: number
    linea_fecha: string
    linea_descripcion: string
    linea_monto: string
    sentido: 'menos' | 'mas'
    monto: string
    monto_contra_tope: string
    requiere_aprobacion: boolean
    razones: RazonAprobacion[]
    solicitud: SolicitudConciliacion
    partes: ParteDiferencia[]
    explicacion: string | null
    fecha: string
    estado: EstadoDiferencia
    solicitado_por: number | null
    solicitado_por_nombre: string | null
    created_at: Date
    decidido_por: number | null
    decidido_por_nombre: string | null
    decidido_en: Date | null
    motivo_rechazo: string | null
    /** asiento de la diferencia (null mientras espera o si se rechazó) */
    asiento_id: number | null
}

/** Asiento vigente (sin reverso) de una diferencia. */
const ASIENTO_VIGENTE = `(SELECT a.id FROM ledger.asientos a WHERE a.origen_tipo = 'diferencia_conciliacion'
       AND a.origen_id = d.id AND a.reversa_de IS NULL ORDER BY a.id LIMIT 1)`
const ASIENTO_REVERTIDO = `EXISTS (SELECT 1 FROM ledger.asientos a JOIN ledger.asientos r ON r.reversa_de = a.id
       WHERE a.origen_tipo = 'diferencia_conciliacion' AND a.origen_id = d.id)`

/** SQL del estado derivado (alias `d` y `dd` para la decisión). */
export const ESTADO_DIFERENCIA_SQL = `CASE
        WHEN ${ASIENTO_REVERTIDO} THEN 'anulada'
        WHEN NOT d.requiere_aprobacion THEN 'aplicada'
        WHEN dd.decision = 'aprobada' THEN 'aprobada'
        WHEN dd.decision = 'rechazada' THEN 'rechazada'
        ELSE 'pendiente' END`

function consultaDiferencias(cliente: QueryClientContract) {
    return cliente
        .from('billing.diferencias_conciliacion as d')
        .join('ledger.extractos_lineas as l', 'l.id', 'd.linea_id')
        .leftJoin('billing.diferencias_conciliacion_decisiones as dd', 'dd.diferencia_id', 'd.id')
        .leftJoin('core.usuarios as us', 'us.id', 'd.solicitado_por')
        .leftJoin('core.usuarios as ud', 'ud.id', 'dd.decidido_por')
        .select(
            'd.id',
            'd.empresa_id',
            'd.cuenta_id',
            'd.linea_id',
            'l.extracto_id',
            cliente.raw(`to_char(l.fecha, 'YYYY-MM-DD') as linea_fecha`),
            'l.descripcion as linea_descripcion',
            'l.monto as linea_monto',
            'd.sentido',
            'd.monto',
            'd.monto_contra_tope',
            'd.requiere_aprobacion',
            'd.razones',
            'd.solicitud',
            'd.detalle',
            'd.explicacion',
            cliente.raw(`to_char(d.fecha, 'YYYY-MM-DD') as fecha`),
            cliente.raw(`${ESTADO_DIFERENCIA_SQL} as estado`),
            'd.solicitado_por',
            'us.nombre as solicitado_por_nombre',
            'd.created_at',
            'dd.decidido_por',
            'ud.nombre as decidido_por_nombre',
            'dd.created_at as decidido_en',
            cliente.raw(`CASE WHEN dd.decision = 'rechazada' THEN dd.motivo END as motivo_rechazo`),
            cliente.raw(`${ASIENTO_VIGENTE} as asiento_id`),
        )
}

function normalizarDiferencia(f: Record<string, unknown>): DiferenciaConciliacionVista {
    const id = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    const solicitud = f.solicitud as Partial<SolicitudConciliacion>
    return {
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        cuenta_id: Number(f.cuenta_id),
        linea_id: Number(f.linea_id),
        extracto_id: Number(f.extracto_id),
        linea_fecha: String(f.linea_fecha),
        linea_descripcion: String(f.linea_descripcion),
        linea_monto: aTexto(String(f.linea_monto)),
        sentido: f.sentido as 'menos' | 'mas',
        monto: aTexto(String(f.monto)),
        monto_contra_tope: aTexto(String(f.monto_contra_tope)),
        requiere_aprobacion: Boolean(f.requiere_aprobacion),
        razones: (f.razones as RazonAprobacion[]) ?? [],
        solicitud: {
            movimientos: solicitud.movimientos ?? [],
            depositos: solicitud.depositos ?? [],
            traslados: solicitud.traslados ?? [],
        },
        partes: f.detalle as ParteDiferencia[],
        explicacion: (f.explicacion as string | null) ?? null,
        fecha: String(f.fecha),
        estado: f.estado as EstadoDiferencia,
        solicitado_por: id(f.solicitado_por),
        solicitado_por_nombre: (f.solicitado_por_nombre as string | null) ?? null,
        created_at: f.created_at as Date,
        decidido_por: id(f.decidido_por),
        decidido_por_nombre: (f.decidido_por_nombre as string | null) ?? null,
        decidido_en: (f.decidido_en as Date | null) ?? null,
        motivo_rechazo: (f.motivo_rechazo as string | null) ?? null,
        asiento_id: id(f.asiento_id),
    }
}

export async function verDiferencia(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<DiferenciaConciliacionVista> {
    const fila = (await consultaDiferencias(cliente).where('d.id', id).first()) as Record<
        string,
        unknown
    > | null
    if (!fila) throw new NoEncontrado(`La diferencia de conciliación ${id} no existe`)
    return normalizarDiferencia(fila)
}

export async function listarDiferencias(
    filtros: OpcionesPaginacion & {
        estado?: EstadoDiferencia
        extracto_id?: number
        desde?: string
        hasta?: string
    },
    empresas: number[] | null,
): Promise<Pagina<DiferenciaConciliacionVista>> {
    const cliente = db.connection()
    const consulta = consultaDiferencias(cliente)
        .if(filtros.estado, (q) => q.whereRaw(`(${ESTADO_DIFERENCIA_SQL}) = ?`, [filtros.estado!]))
        .if(filtros.extracto_id, (q) => q.where('l.extracto_id', filtros.extracto_id!))
        .if(filtros.desde, (q) => q.where('d.fecha', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('d.fecha', '<=', filtros.hasta!))
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('d.empresa_id', ids))
    const pagina = await paginar<Record<string, unknown>>(consulta, filtros, {
        columna: 'd.id',
        clave: (f) => Number(f.id),
    })
    return { data: pagina.data.map(normalizarDiferencia), nextCursor: pagina.nextCursor }
}

/** Empresa de una diferencia (para exigir el acceso en la ruta). */
export async function empresaDeDiferencia(id: number) {
    const fila = await db
        .from('billing.diferencias_conciliacion')
        .where('id', id)
        .select('empresa_id')
        .first()
    if (!fila) throw new NoEncontrado(`La diferencia de conciliación ${id} no existe`)
    return { empresa_id: Number(fila.empresa_id) }
}

/** Diferencia que espera aprobación en la línea (la línea no se concilia por otro camino mientras tanto). */
export async function diferenciaPendienteDeLinea(
    lineaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<number | null> {
    const fila = (await cliente
        .from('billing.diferencias_conciliacion as d')
        .where('d.linea_id', lineaId)
        .where('d.requiere_aprobacion', true)
        .whereNotExists((q) =>
            q.from('billing.diferencias_conciliacion_decisiones as dd').whereRaw('dd.diferencia_id = d.id'),
        )
        .select('d.id')
        .first()) as { id: number } | null
    return fila ? Number(fila.id) : null
}

/**
 * Lo que la persona ya aceptó sola hoy contra su tope en la empresa: Σ `monto_contra_tope` de sus
 * diferencias aplicadas sin aprobación cuyo asiento sigue vigente (deshacer la conciliación lo
 * libera).
 */
export async function usadoDelTopeHoy(
    empresaId: number,
    usuarioId: number | null,
    fecha: string,
    cliente: QueryClientContract = db.connection(),
): Promise<Dec> {
    if (usuarioId === null) return CERO
    const r = (await cliente.rawQuery(
        `SELECT coalesce(sum(d.monto_contra_tope), 0)::text AS s FROM billing.diferencias_conciliacion d
          WHERE d.empresa_id = ? AND d.solicitado_por = ? AND d.fecha = ?::date AND NOT d.requiere_aprobacion
            AND NOT ${ASIENTO_REVERTIDO}`,
        [empresaId, usuarioId, fecha],
    )) as { rows: Array<{ s: string }> }
    return dec(r.rows[0]?.s ?? '0')
}

/*
| Por identificar
*/

export interface PorIdentificar {
    nota: string
    marcado_por: number | null
    marcado_por_nombre: string | null
    marcado_en: Date
}

/** Última nota «por identificar» de cada línea. */
export async function porIdentificarDe(
    lineas: number[],
    cliente: QueryClientContract = db.connection(),
): Promise<Map<number, PorIdentificar>> {
    if (lineas.length === 0) return new Map()
    const filas = (await cliente
        .from('billing.lineas_por_identificar as p')
        .leftJoin('core.usuarios as u', 'u.id', 'p.marcado_por')
        .whereIn('p.linea_id', lineas)
        .orderBy('p.id', 'desc')
        .select(
            'p.linea_id',
            'p.nota',
            'p.marcado_por',
            'u.nombre as marcado_por_nombre',
            'p.created_at',
        )) as Array<{
        linea_id: number
        nota: string
        marcado_por: number | null
        marcado_por_nombre: string | null
        created_at: Date
    }>
    const salida = new Map<number, PorIdentificar>()
    for (const f of filas) {
        if (salida.has(Number(f.linea_id))) continue
        salida.set(Number(f.linea_id), {
            nota: f.nota,
            marcado_por: f.marcado_por === null ? null : Number(f.marcado_por),
            marcado_por_nombre: f.marcado_por_nombre,
            marcado_en: f.created_at,
        })
    }
    return salida
}
