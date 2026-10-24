import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, Problema } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { jsonCanonico, sha256Hex, type Boletos } from '#lealtad/sorteo_v1'
import { archivosDeSorteo } from '#lealtad/sorteos_archivos'
import { armarReporte, definirColumnas } from '#billing/reportes/definicion'

/**
 * Sorteos (`contratos/lealtad.md` §7 y §8). Lectura, bases, hash canónico y checklist. Las acciones
 * están en `actions/*_sorteo.ts`. Estados de esta fase: `borrador → bases_publicadas →
 * participacion_abierta → corte_cerrado → ejecutado → premios_entregados`, y `cancelado` antes de
 * `ejecutado` (`acta_cerrada` llega con la segunda PR).
 */

export const ESTADOS_SORTEO = [
    'borrador',
    'bases_publicadas',
    'participacion_abierta',
    'corte_cerrado',
    'ejecutado',
    'acta_cerrada',
    'premios_entregados',
    'cancelado',
] as const

/** Estados con resultado (después de ejecutar). */
export const ESTADOS_EJECUTADOS: readonly EstadoSorteo[] = ['ejecutado', 'acta_cerrada', 'premios_entregados']
export type EstadoSorteo = (typeof ESTADOS_SORTEO)[number]

export const TIPOS_PREMIO_SORTEO = ['efectivo', 'bien', 'servicio'] as const
export type TipoPremioSorteo = (typeof TIPOS_PREMIO_SORTEO)[number]

/** Checklist legal (§8) y para qué paso se exige cada requisito. */
export const REQUISITOS_SORTEO = [
    'bases_diaco',
    'autorizacion_gobernacion',
    'fianza',
    'isr_premios',
    'timbre_fiscal',
    'delegado_o_notario',
    'publicacion_resultados',
    'lista_a_gobernacion',
] as const
export type RequisitoSorteo = (typeof REQUISITOS_SORTEO)[number]
export const REQUISITOS_PARA_ABRIR: readonly RequisitoSorteo[] = ['bases_diaco']
/**
 * Decisión del PM (19 oct): no hace falta la autorización de la Gobernación; `autorizacion_gobernacion` y
 * `fianza` se pueden marcar (quedan en el checklist) pero no bloquean la ejecución.
 */
export const REQUISITOS_PARA_EJECUTAR: readonly RequisitoSorteo[] = [
    'bases_diaco',
    'isr_premios',
    'timbre_fiscal',
    'delegado_o_notario',
]
export const ESTADOS_REQUISITO = ['cumplido', 'no_aplica', 'pendiente'] as const
export type EstadoRequisito = (typeof ESTADOS_REQUISITO)[number]

/** Bases (§7.2). `regla_participacion` es el texto que ve el cliente en el portal. */
export interface BasesSorteo {
    mecanica?: string
    regla_participacion?: string
    plazo_reclamo_dias?: number
    no_reclamados?: string
    publicacion_resultados?: string
    resolucion_gobernacion?: string | null
    /**
     * De dónde sale el valor público del acto (p. ej. «los números del sorteo X de la Lotería Santa Lucía
     * del día D»): obligatoria al publicar y congelada con `bases_hash` (riesgo de manipulación: quien
     * conoce la semilla no elige el valor)
     */
    fuente_valor_publico?: string
}

/** Criterios del corte: boletos por servicio activo sin facturas vencidas y si admite canjes. */
export interface CriteriosSorteo {
    boletos_por_servicio: number
    admite_canje: boolean
}

export interface PremioSorteo {
    id: number
    posicion: number
    nombre: string
    cantidad: number
    imagen_url: string | null
    /** la imagen subida (`lealtad.sorteos_archivos`, uso `imagen_premio`) */
    imagen_archivo_id: number | null
    valor: string
    tipo: TipoPremioSorteo
    premio_id: number | null
    retiene_isr: boolean
    isr_pct: string
}

export interface SorteoVista {
    id: number
    empresa_id: number
    programa_id: number | null
    nombre: string
    descripcion: string | null
    estado: EstadoSorteo
    bases: BasesSorteo
    criterios: CriteriosSorteo
    bases_hash: string | null
    inscripcion_desde: string | null
    corte_en: Date | null
    fecha_sorteo: Date | null
    lugar: string | null
    suplentes: number
    algoritmo: string
    compromiso: string | null
    semilla: string | null
    valor_publico: string | null
    /** cómo se obtuvo el valor público en el acto (acta del notario, enlace al resultado oficial…) */
    valor_publico_evidencia: string | null
    lista_hash: string | null
    resultado: Record<string, unknown> | null
    motivo_cancelacion: string | null
    publicado_en: Date | null
    corte_cerrado_en: Date | null
    ejecutado_en: Date | null
    cancelado_en: Date | null
    /** el panel lo anuncia en el portal (pedido del PM); editable hasta antes de ejecutar */
    aviso_portal: boolean
    acta_hash: string | null
    acta_archivo_id: number | null
    acta_constancia: string | null
    acta_cerrada_en: Date | null
    premios: PremioSorteo[]
    version: number
    created_at: Date
    updated_at: Date
}

const columnas = (cliente: QueryClientContract) => [
    'id',
    'empresa_id',
    'programa_id',
    'nombre',
    'descripcion',
    'estado',
    'bases',
    'criterios',
    'bases_hash',
    cliente.raw(`to_char(inscripcion_desde, 'YYYY-MM-DD') as inscripcion_desde`),
    'corte_en',
    'fecha_sorteo',
    'lugar',
    'suplentes',
    'algoritmo',
    'compromiso',
    'semilla',
    'valor_publico',
    'valor_publico_evidencia',
    'lista_hash',
    'resultado',
    'motivo_cancelacion',
    'publicado_en',
    'corte_cerrado_en',
    'ejecutado_en',
    'cancelado_en',
    'aviso_portal',
    'acta_hash',
    'acta_archivo_id',
    'acta_constancia',
    'acta_cerrada_en',
    'version',
    'created_at',
    'updated_at',
]

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function premiosDeSorteo(
    sorteoId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PremioSorteo[]> {
    const filas = (await cliente
        .from('lealtad.sorteos_premios')
        .where('sorteo_id', sorteoId)
        .orderBy('posicion', 'asc')
        .select(
            'id',
            'posicion',
            'nombre',
            'cantidad',
            'imagen_url',
            'imagen_archivo_id',
            'valor',
            'tipo',
            'premio_id',
            'retiene_isr',
            'isr_pct',
        )) as Array<Record<string, unknown>>
    return filas.map((f) => ({
        ...(f as unknown as PremioSorteo),
        id: Number(f.id),
        posicion: Number(f.posicion),
        cantidad: Number(f.cantidad),
        premio_id: n(f.premio_id),
        imagen_archivo_id: n(f.imagen_archivo_id),
    }))
}

function aVista(f: Record<string, unknown>, premios: PremioSorteo[]): SorteoVista {
    return {
        ...(f as unknown as SorteoVista),
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        programa_id: n(f.programa_id),
        suplentes: Number(f.suplentes),
        acta_archivo_id: n(f.acta_archivo_id),
        version: Number(f.version),
        premios,
    }
}

export async function verSorteo(
    id: number,
    cliente: QueryClientContract = db.connection(),
    bloquear = false,
): Promise<SorteoVista> {
    const q = cliente
        .from('lealtad.sorteos')
        .where('id', id)
        .select(...columnas(cliente))
    if (bloquear) q.forUpdate()
    const fila = (await q.first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`El sorteo ${id} no existe`)
    return aVista(fila, await premiosDeSorteo(id, cliente))
}

export async function listarSorteos(
    filtros: OpcionesPaginacion & { estado?: EstadoSorteo },
    empresas: number[] | null,
): Promise<Pagina<SorteoVista>> {
    const consulta = db
        .from('lealtad.sorteos')
        .if(filtros.estado, (q) => q.where('estado', filtros.estado!))
        .if(empresas !== null, (q) => q.whereIn('empresa_id', empresas!))
        .select(...columnas(db.connection()))
    const pagina = await paginar<Record<string, unknown>>(consulta, filtros, { columna: 'id' })
    const data: SorteoVista[] = []
    for (const fila of pagina.data) data.push(aVista(fila, await premiosDeSorteo(Number(fila.id))))
    return { data, nextCursor: pagina.nextCursor }
}

/** Titulares del sorteo: Σ cantidad de sus premios. */
export function titularesDe(sorteo: Pick<SorteoVista, 'premios'>): number {
    return sorteo.premios.reduce((s, p) => s + p.cantidad, 0)
}

/** Lo que se congela y se publica: `bases_hash` = SHA-256 del JSON canónico. */
export function documentoBases(s: SorteoVista): Record<string, unknown> {
    return {
        algoritmo: s.algoritmo,
        bases: s.bases,
        corte_en: s.corte_en ? new Date(s.corte_en).toISOString() : null,
        criterios: s.criterios,
        descripcion: s.descripcion,
        empresa_id: s.empresa_id,
        fecha_sorteo: s.fecha_sorteo ? new Date(s.fecha_sorteo).toISOString() : null,
        inscripcion_desde: s.inscripcion_desde,
        lugar: s.lugar,
        nombre: s.nombre,
        premios: s.premios.map((p) => ({
            cantidad: p.cantidad,
            imagen_url: p.imagen_url,
            isr_pct: p.isr_pct,
            nombre: p.nombre,
            posicion: p.posicion,
            retiene_isr: p.retiene_isr,
            tipo: p.tipo,
            valor: p.valor,
        })),
        sorteo_id: s.id,
        suplentes: s.suplentes,
    }
}

export function hashBases(s: SorteoVista): string {
    return sha256Hex(jsonCanonico(documentoBases(s)))
}

/** 422 `bases_incompletas` con el primer campo que falta (§7.2). */
export class BasesIncompletas extends Problema {
    constructor(campo: string, detalle: string) {
        super(422, 'bases_incompletas', 'Bases incompletas', detalle, [
            { field: campo, message: detalle, rule: 'bases_incompletas' },
        ])
    }
}

/** 422 `requisito_pendiente`: falta un requisito del checklist legal para este paso (§8). */
export class RequisitoPendiente extends Problema {
    constructor(clave: string, paso: string) {
        super(
            422,
            'requisito_pendiente',
            'Requisito legal pendiente',
            `Para ${paso} falta marcar el requisito ${clave} (cumplido o no aplica, con su evidencia)`,
            [{ field: 'requisitos', message: clave, rule: 'requisito_pendiente' }],
        )
    }
}

/** 409 `estado_sorteo`: la acción no corresponde al estado del sorteo. */
export class EstadoSorteoInvalido extends Problema {
    constructor(id: number, estado: string, accion: string) {
        super(
            409,
            'estado_sorteo',
            'Estado del sorteo',
            `El sorteo ${id} está ${estado}: no admite ${accion}`,
        )
    }
}

export function exigirEstado(
    s: Pick<SorteoVista, 'id' | 'estado'>,
    permitidos: EstadoSorteo[],
    accion: string,
) {
    if (!permitidos.includes(s.estado)) throw new EstadoSorteoInvalido(s.id, s.estado, accion)
}

/** Bases completas para publicar (§7.2). */
export function exigirBasesCompletas(s: SorteoVista): void {
    const b = s.bases
    const texto = (v: unknown) => typeof v === 'string' && v.trim().length > 0
    if (!texto(b.mecanica)) {
        throw new BasesIncompletas('bases.mecanica', 'Falta la mecánica y forma del sorteo')
    }
    if (!texto(b.regla_participacion)) {
        throw new BasesIncompletas(
            'bases.regla_participacion',
            'Falta la regla de participación (cómo se ganan boletos)',
        )
    }
    if (!s.inscripcion_desde || !s.corte_en) {
        throw new BasesIncompletas('corte_en', 'Falta el periodo de participación con fecha de fin explícita')
    }
    if (s.premios.length === 0) {
        throw new BasesIncompletas('premios', 'Faltan los premios, en qué consisten y su valor')
    }
    if (!s.fecha_sorteo || !texto(s.lugar)) {
        throw new BasesIncompletas('fecha_sorteo', 'Faltan la fecha, la hora y el lugar del sorteo')
    }
    if (new Date(s.fecha_sorteo).getTime() < new Date(s.corte_en).getTime()) {
        throw new BasesIncompletas('fecha_sorteo', 'El sorteo no puede ser antes del corte')
    }
    if (!(Number(b.plazo_reclamo_dias) > 0) || !texto(b.no_reclamados)) {
        throw new BasesIncompletas(
            'bases.plazo_reclamo_dias',
            'Faltan el plazo para reclamar y qué pasa con los premios no reclamados',
        )
    }
    if (!texto(b.publicacion_resultados)) {
        throw new BasesIncompletas(
            'bases.publicacion_resultados',
            'Falta la forma y el medio de publicar los resultados',
        )
    }
    if (!texto(b.fuente_valor_publico)) {
        throw new BasesIncompletas(
            'bases.fuente_valor_publico',
            'Falta la fuente pública del valor que se usará en el acto (p. ej. un resultado de la Lotería Santa Lucía)',
        )
    }
}

export interface RequisitoVigente {
    clave: RequisitoSorteo
    estado: EstadoRequisito
    valor: string | null
    evidencia: string | null
    /** evidencia como archivo (`GET /lealtad/sorteos/:id/archivos/:archivoId`) */
    archivo_id: number | null
    nota: string | null
    marcado_en: Date | null
}

/** Estado vigente de cada requisito: la última fila por clave (pendiente si no hay ninguna). */
export async function requisitosVigentes(
    sorteoId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<RequisitoVigente[]> {
    const filas = (await cliente
        .from('lealtad.sorteos_requisitos')
        .where('sorteo_id', sorteoId)
        .distinctOn('clave')
        .orderBy([
            { column: 'clave', order: 'asc' },
            { column: 'id', order: 'desc' },
        ])
        .select(
            'clave',
            'estado',
            'valor',
            'evidencia',
            'archivo_id',
            'nota',
            'marcado_en',
        )) as RequisitoVigente[]
    const porClave = new Map(
        filas.map((f) => [
            f.clave,
            { ...f, archivo_id: f.archivo_id === null ? null : Number(f.archivo_id) },
        ]),
    )
    return REQUISITOS_SORTEO.map(
        (clave) =>
            porClave.get(clave) ?? {
                clave,
                estado: 'pendiente',
                valor: null,
                evidencia: null,
                archivo_id: null,
                nota: null,
                marcado_en: null,
            },
    )
}

export async function exigirRequisitos(
    cliente: QueryClientContract,
    sorteoId: number,
    claves: readonly RequisitoSorteo[],
    paso: string,
): Promise<void> {
    const vigentes = await requisitosVigentes(sorteoId, cliente)
    for (const clave of claves) {
        const r = vigentes.find((v) => v.clave === clave)
        if (!r || r.estado === 'pendiente') throw new RequisitoPendiente(clave, paso)
    }
}

/** Lista del corte en orden canónico (`codigo_publico`). */
export async function listaDelCorte(
    cliente: QueryClientContract,
    sorteoId: number,
): Promise<Array<Boletos & { id: number; cliente_id: number }>> {
    const filas = (await cliente
        .from('lealtad.sorteos_participantes')
        .where('sorteo_id', sorteoId)
        .orderBy('codigo_publico', 'asc')
        .select('id', 'cliente_id', 'codigo_publico', 'boletos')) as Array<{
        id: number
        cliente_id: number
        codigo_publico: string
        boletos: number
    }>
    return filas.map((f) => ({
        id: Number(f.id),
        cliente_id: Number(f.cliente_id),
        codigo: f.codigo_publico,
        boletos: Number(f.boletos),
    }))
}

export interface GanadorVista {
    id: number
    posicion: number
    tipo: 'titular' | 'suplente'
    participante_id: number
    cliente_id: number
    codigo_publico: string
    premio_posicion: number | null
    estado: string
    retencion_isr: string | null
    contrapartida: string | null
    asiento_id: number | null
    egreso_id: number | null
    canje_id: number | null
    /** decisión del PM: la línea de la compra (con factura) del bien entregado */
    compra_linea_id: number | null
    /** unidades de la línea que consumió esta entrega y la parte de la base que le tocó */
    compra_unidades: number | null
    compra_base: string | null
    /** fase C del inventario: el movimiento `premio` del bien que salió del kardex */
    movimiento_inventario_id: number | null
    entregado_en: Date | null
    /**
     * El premio que le toca: el de su puesto (titular) o, si es un suplente que tomó el premio de un
     * ganador que no lo reclamó, `premio_sustitucion`. null = sin premio (suplente en espera).
     */
    premio: number | null
    premio_sustitucion: number | null
    sustituye_a: number | null
    notificado_en: Date | null
    reclamar_antes: Date | null
    no_reclamado_en: Date | null
    constancia_archivo_id: number | null
    version: number
}

export async function ganadoresDe(
    sorteoId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<GanadorVista[]> {
    const filas = (await cliente
        .from('lealtad.sorteos_ganadores as g')
        .join('lealtad.sorteos_participantes as p', 'p.id', 'g.participante_id')
        .where('g.sorteo_id', sorteoId)
        .orderBy('g.posicion', 'asc')
        .select(
            'g.id',
            'g.posicion',
            'g.tipo',
            'g.participante_id',
            'p.cliente_id',
            'p.codigo_publico',
            'g.premio_posicion',
            'g.estado',
            'g.retencion_isr',
            'g.contrapartida',
            'g.asiento_id',
            'g.egreso_id',
            'g.canje_id',
            'g.compra_linea_id',
            'g.compra_unidades',
            'g.compra_base',
            'g.movimiento_inventario_id',
            'g.entregado_en',
            'g.premio_sustitucion',
            'g.sustituye_a',
            'g.notificado_en',
            'g.reclamar_antes',
            'g.no_reclamado_en',
            'g.constancia_archivo_id',
            'g.version',
        )) as Array<Record<string, unknown>>
    return filas.map((f) => ({
        ...(f as unknown as GanadorVista),
        id: Number(f.id),
        posicion: Number(f.posicion),
        participante_id: Number(f.participante_id),
        cliente_id: Number(f.cliente_id),
        premio_posicion: n(f.premio_posicion),
        asiento_id: n(f.asiento_id),
        egreso_id: n(f.egreso_id),
        canje_id: n(f.canje_id),
        compra_linea_id: n(f.compra_linea_id),
        movimiento_inventario_id: n(f.movimiento_inventario_id),
        premio: n(f.premio_posicion) ?? n(f.premio_sustitucion),
        premio_sustitucion: n(f.premio_sustitucion),
        sustituye_a: n(f.sustituye_a),
        constancia_archivo_id: n(f.constancia_archivo_id),
        compra_unidades: n(f.compra_unidades),
        version: Number(f.version),
    }))
}

/** Detalle para el panel: el sorteo, su checklist, cuántos participan y sus ganadores. */
export async function detalleSorteo(id: number, cliente: QueryClientContract = db.connection()) {
    const sorteo = await verSorteo(id, cliente)
    const participantes = (await cliente
        .from('lealtad.sorteos_participantes')
        .where('sorteo_id', id)
        .select(cliente.raw('count(*)::int as n'), cliente.raw('coalesce(sum(boletos), 0)::int as boletos'))
        .first()) as { n: number; boletos: number }
    return {
        ...sorteo,
        requisitos: await requisitosVigentes(id, cliente),
        participantes: Number(participantes.n),
        boletos: Number(participantes.boletos),
        ganadores: await ganadoresDe(id, cliente),
        archivos: await archivosDeSorteo(id, cliente),
    }
}

/** Datos públicos para recalcular el resultado (§7.3, punto 7): solo después de ejecutar. */
export async function verificacionSorteo(id: number) {
    const sorteo = await verSorteo(id)
    if (!ESTADOS_EJECUTADOS.includes(sorteo.estado)) {
        throw new NoEncontrado(`El sorteo ${id} aún no se ejecutó`)
    }
    const lista = await listaDelCorte(db.connection(), id)
    const ganadores = await ganadoresDe(id)
    return {
        sorteo_id: sorteo.id,
        algoritmo: sorteo.algoritmo,
        bases_hash: sorteo.bases_hash,
        bases: documentoBases(sorteo),
        compromiso: sorteo.compromiso,
        semilla: sorteo.semilla,
        valor_publico: sorteo.valor_publico,
        fuente_valor_publico: sorteo.bases.fuente_valor_publico ?? null,
        valor_publico_evidencia: sorteo.valor_publico_evidencia,
        lista_hash: sorteo.lista_hash,
        lista: lista.map((p) => ({ codigo: p.codigo, boletos: p.boletos })),
        titulares: titularesDe(sorteo),
        suplentes: sorteo.suplentes,
        acta_hash: sorteo.acta_hash,
        ganadores: ganadores.map((g) => ({
            posicion: g.posicion,
            tipo: g.tipo,
            codigo: g.codigo_publico,
            premio_posicion: g.premio_posicion,
        })),
    }
}

/** Bases publicadas (públicas desde `bases_publicadas`): el documento y su hash. */
export async function basesPublicas(id: number) {
    const sorteo = await verSorteo(id)
    if (sorteo.estado === 'borrador' || !sorteo.bases_hash) {
        throw new NoEncontrado(`El sorteo ${id} aún no publicó sus bases`)
    }
    return {
        sorteo_id: sorteo.id,
        estado: sorteo.estado,
        bases_hash: sorteo.bases_hash,
        compromiso: sorteo.compromiso,
        bases: documentoBases(sorteo),
    }
}

/** Sorteos del portal: publicados y vigentes de las empresas del cliente, con sus boletos. */
export async function sorteosDelPortal(clienteId: number) {
    const empresas = (await db
        .from('core.servicios')
        .where('cliente_id', clienteId)
        .whereNot('estado', 'retirado')
        .distinct('empresa_id')) as Array<{ empresa_id: number }>
    if (empresas.length === 0) return []
    const filas = (await db
        .from('lealtad.sorteos')
        .whereIn(
            'empresa_id',
            empresas.map((e) => Number(e.empresa_id)),
        )
        .whereIn('estado', [
            'bases_publicadas',
            'participacion_abierta',
            'corte_cerrado',
            'ejecutado',
            'acta_cerrada',
            'premios_entregados',
        ])
        // el panel decide si se anuncia en el portal (pedido del PM)
        .where('aviso_portal', true)
        // vigentes: los que aún no se sortean y los ejecutados de los últimos 30 días (resultado)
        .whereRaw(`fecha_sorteo >= now() - interval '30 days'`)
        .orderBy('fecha_sorteo', 'asc')
        .select('id')) as Array<{ id: number }>
    const salida = []
    for (const { id } of filas) {
        const s = await verSorteo(Number(id))
        const boletos = (await db
            .from('lealtad.sorteos_boletos')
            .where({ sorteo_id: s.id, cliente_id: clienteId })
            .select(db.raw('coalesce(sum(boletos), 0)::int as n'))
            .first()) as { n: number }
        const participante = (await db
            .from('lealtad.sorteos_participantes')
            .where({ sorteo_id: s.id, cliente_id: clienteId })
            .select('codigo_publico', 'boletos')
            .first()) as { codigo_publico: string; boletos: number } | null
        const elegidos = ESTADOS_EJECUTADOS.includes(s.estado) ? await ganadoresDe(s.id) : null
        const ganadores = elegidos
            ? elegidos.map((g) => ({
                  posicion: g.posicion,
                  tipo: g.tipo,
                  codigo: g.codigo_publico,
                  premio_posicion: g.premio_posicion,
              }))
            : null
        salida.push({
            id: s.id,
            empresa_id: s.empresa_id,
            nombre: s.nombre,
            descripcion: s.descripcion,
            estado: s.estado,
            regla_participacion: s.bases.regla_participacion ?? null,
            inscripcion_desde: s.inscripcion_desde,
            corte_en: s.corte_en,
            fecha_sorteo: s.fecha_sorteo,
            lugar: s.lugar,
            premios: s.premios.map((p) => ({
                posicion: p.posicion,
                nombre: p.nombre,
                cantidad: p.cantidad,
                // por el portal (mismo origen): el walled garden no carga URLs externas
                imagen_url: p.imagen_archivo_id
                    ? `/api/v1/portal/sorteos/${s.id}/premios/${p.posicion}/imagen`
                    : null,
                valor: p.valor,
            })),
            bases_hash: s.bases_hash,
            compromiso: s.compromiso,
            mis_boletos: participante ? Number(participante.boletos) : Number(boletos.n),
            mi_codigo: participante?.codigo_publico ?? null,
            ganadores,
        })
    }
    return salida
}

export const COLUMNAS_PARTICIPANTES = definirColumnas([
    { clave: 'orden', titulo: 'Orden', tipo: 'entero' },
    { clave: 'codigo_publico', titulo: 'Código público', tipo: 'texto' },
    { clave: 'boletos', titulo: 'Boletos', tipo: 'entero' },
    { clave: 'cliente_id', titulo: 'Cliente (id)', tipo: 'id' },
    { clave: 'cliente', titulo: 'Cliente', tipo: 'texto' },
    { clave: 'servicio_id', titulo: 'Servicio (id)', tipo: 'id', nulable: true },
])

/**
 * Lista del corte para la autoridad y la contabilidad (§7.3, punto 3): en orden canónico
 * (`codigo_publico`), con el cliente; al pie, en la columna del código, `lista_hash` (SHA-256 de las
 * líneas `codigo|boletos\n`): cualquiera lo recalcula con las dos primeras columnas.
 */
export async function reporteParticipantes(id: number) {
    const sorteo = await verSorteo(id)
    if (!sorteo.lista_hash) throw new EstadoSorteoInvalido(sorteo.id, sorteo.estado, 'exportar participantes')
    const filas = (await db
        .from('lealtad.sorteos_participantes as p')
        .join('core.clientes as c', 'c.id', 'p.cliente_id')
        .where('p.sorteo_id', id)
        .orderBy('p.codigo_publico', 'asc')
        .select(
            'p.orden',
            'p.codigo_publico',
            'p.boletos',
            'p.cliente_id',
            'c.nombre as cliente',
            'p.servicio_id',
        )) as Array<Record<string, string | number | null>>
    return armarReporte({
        reporte: `participantes-sorteo-${id}`,
        titulo: `Participantes del sorteo ${sorteo.nombre}`,
        columnas: COLUMNAS_PARTICIPANTES,
        filas: filas.map((f) => ({
            ...f,
            orden: Number(f.orden),
            boletos: Number(f.boletos),
            cliente_id: Number(f.cliente_id),
            servicio_id: f.servicio_id === null ? null : Number(f.servicio_id),
        })),
        filtros: { sorteo_id: id },
        totales: {
            orden: null,
            codigo_publico: `lista_hash ${sorteo.lista_hash}`,
            cliente_id: null,
            servicio_id: null,
        },
    })
}

/**
 * Imagen de un premio para el portal: solo de un sorteo que el panel anuncia (`aviso_portal`), publicado
 * y no cancelado, de una empresa donde el cliente tiene un servicio vigente; si no, 404.
 */
export async function imagenPremioDelPortal(clienteId: number, sorteoId: number, posicion: number) {
    const sorteo = await verSorteo(sorteoId)
    const empresa = (await db
        .from('core.servicios')
        .where({ cliente_id: clienteId, empresa_id: sorteo.empresa_id })
        .whereNot('estado', 'retirado')
        .select('id')
        .first()) as { id: number } | null
    const premio = sorteo.premios.find((p) => p.posicion === posicion)
    if (
        !empresa ||
        !sorteo.aviso_portal ||
        ['borrador', 'cancelado'].includes(sorteo.estado) ||
        !premio?.imagen_archivo_id
    ) {
        throw new NoEncontrado('La imagen no existe')
    }
    return { sorteo, archivoId: premio.imagen_archivo_id }
}

/**
 * Imagen de un premio para un visitante sin sesión (página pública del sorteo, pedido de A5): solo de
 * sorteos con las bases publicadas (`bases_hash`), con `aviso_portal` y no cancelados; 404 si no.
 * Solo la imagen: nada del cliente ni de la empresa.
 */
export async function imagenPremioPublica(sorteoId: number, posicion: number) {
    const sorteo = await verSorteo(sorteoId)
    const premio = sorteo.premios.find((p) => p.posicion === posicion)
    if (
        !sorteo.bases_hash ||
        !sorteo.aviso_portal ||
        ['borrador', 'cancelado'].includes(sorteo.estado) ||
        !premio?.imagen_archivo_id
    ) {
        throw new NoEncontrado('La imagen no existe')
    }
    return { sorteo, archivoId: premio.imagen_archivo_id }
}

/** Imagen de un premio para el panel (404 si no tiene). */
export async function imagenPremio(sorteoId: number, posicion: number) {
    const sorteo = await verSorteo(sorteoId)
    const premio = sorteo.premios.find((p) => p.posicion === posicion)
    if (!premio?.imagen_archivo_id) throw new NoEncontrado('El premio no tiene imagen')
    return { sorteo, archivoId: premio.imagen_archivo_id }
}
