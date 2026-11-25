import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { descifrarCampo, type ConfigSmartOlt } from '#integraciones/equipos/configuracion'
import { nombreUsuario } from '#integraciones/equipos/acs'
import type { ContextoAccion } from '#shared/contexto'
import { Conflicto, NoEncontrado, Problema } from '#shared/errores'
import { exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'

/**
 * Instancias (cuentas, subdominios) de SmartOLT y sus OLT (`contratos/equipos-olt-acs.md` §3.1-§3.3).
 *
 * - Una instancia es `https://<subdominio>.smartolt.com` + su token + su presupuesto de llamadas. Una
 *   empresa puede tener varias; `empresa_id` null = **compartida** entre las empresas de la instalación
 *   (decisión del PM, P1): la ven todas, solo la administra quien tiene alcance global.
 * - **Operativa** = `activo` y la última prueba en ok (con token legible).
 * - Las OLT de una instancia (`smartolt_olts`) salen de `get_olts` (o `manual`, de un perfil anterior a
 *   la primera sincronización). El `smartolt_olt_id` solo vale dentro de su instancia. Cada una se puede
 *   vincular a una `network.olts` de Argos (una OLT de Argos, una sola de SmartOLT).
 * - Los perfiles de autorización cuelgan de la OLT de SmartOLT: `(smartolt_olt_ref_id, plan_id)`.
 * - `instanciaParaServicio` (§4.2) es la única regla para elegir la instancia de un servicio.
 */

export const TABLA_INSTANCIAS = 'integraciones.smartolt_instancias'
export const TABLA_OLTS = 'integraciones.smartolt_olts'
export const TABLA_PERFILES = 'integraciones.equipos_perfiles'

export interface FilaInstancia {
    id: number
    empresa_id: number | null
    nombre: string
    /** nota libre del formulario (decisión del PM, tablero aprobado) */
    nota: string | null
    url: string
    token_cifrado: string
    activo: boolean
    probado_en: Date | null
    prueba_ok: boolean | null
    prueba_error: string | null
    prueba_latencia_ms: number | null
    probado_por_id: number | null
    olts_sincronizadas_en: Date | null
    version: number
    created_at: Date
    updated_at: Date
}

export interface InstanciaSmartOlt {
    id: number
    /** null = compartida */
    empresaId: number | null
    nombre: string
    /** credenciales en claro; null si el token no se pudo descifrar */
    config: ConfigSmartOlt | null
    activo: boolean
    operativa: boolean
}

export function instanciaDesdeFila(fila: FilaInstancia): InstanciaSmartOlt {
    const id = Number(fila.id)
    const token = descifrarCampo(fila.token_cifrado, 'smartolt_token', fila.empresa_id, id)
    const config = token ? { url: fila.url, token } : null
    return {
        id,
        empresaId: fila.empresa_id === null ? null : Number(fila.empresa_id),
        nombre: fila.nombre,
        config,
        activo: fila.activo,
        operativa: Boolean(fila.activo && config && fila.prueba_ok),
    }
}

export async function leerFilaInstancia(
    id: number,
    cliente: QueryClientContract = db.connection(),
    opciones: { bloquear?: boolean } = {},
): Promise<FilaInstancia | null> {
    let q = cliente.from(TABLA_INSTANCIAS).where('id', id)
    if (opciones.bloquear) q = q.forUpdate()
    return ((await q.first()) ?? null) as FilaInstancia | null
}

export async function leerInstancia(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<InstanciaSmartOlt | null> {
    const fila = await leerFilaInstancia(id, cliente)
    return fila ? instanciaDesdeFila(fila) : null
}

/** ¿La empresa ve la instancia? La suya o una compartida. */
export function instanciaVisible(fila: { empresa_id: number | null }, empresaId: number): boolean {
    return fila.empresa_id === null || Number(fila.empresa_id) === empresaId
}

/** Filas de las instancias que ve la empresa: las suyas y las compartidas, por id. */
export async function filasInstanciasDeEmpresa(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<FilaInstancia[]> {
    return (await cliente
        .from(TABLA_INSTANCIAS)
        .where((q) => q.where('empresa_id', empresaId).orWhereNull('empresa_id'))
        .orderBy('id')) as FilaInstancia[]
}

/** Instancias que ve la empresa (propias + compartidas). */
export async function instanciasDeEmpresa(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<InstanciaSmartOlt[]> {
    const filas = await filasInstanciasDeEmpresa(empresaId, cliente)
    return filas.map(instanciaDesdeFila)
}

// ── OLT de SmartOLT y perfiles ────────────────────────────────────────────────────────────────

export interface FilaOltSmartOlt {
    id: number
    instancia_id: number
    smartolt_olt_id: string
    nombre: string | null
    hardware: string | null
    ip: string | null
    olt_id: number | null
    presente: boolean
    origen: 'sincronizada' | 'manual'
    sincronizada_en: Date | null
}

/** La OLT `smartolt_olt_id` de esa instancia (el id de SmartOLT solo vale dentro de su instancia). */
export async function oltDeInstancia(
    instanciaId: number,
    smartoltOltId: string,
    cliente: QueryClientContract = db.connection(),
): Promise<FilaOltSmartOlt | null> {
    return ((await cliente
        .from(TABLA_OLTS)
        .where({ instancia_id: instanciaId, smartolt_olt_id: smartoltOltId })
        .first()) ?? null) as FilaOltSmartOlt | null
}

export interface PerfilOlt {
    id: number
    smartolt_olt_ref_id: number
    plan_id: number | null
    authorization_preset_id: number
    pon_type: 'gpon' | 'epon'
}

/** El perfil de esa OLT de SmartOLT para el plan; si no hay, el de la OLT para cualquier plan. */
export async function perfilPara(
    oltRefId: number,
    planId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<PerfilOlt | null> {
    const filas = (await cliente
        .from(TABLA_PERFILES)
        .where('smartolt_olt_ref_id', oltRefId)
        .where((q) => q.where('plan_id', planId).orWhereNull('plan_id'))
        .select('id', 'smartolt_olt_ref_id', 'plan_id', 'authorization_preset_id', 'pon_type')) as PerfilOlt[]
    const fila = filas.find((p) => p.plan_id !== null) ?? filas.find((p) => p.plan_id === null)
    if (!fila) return null
    return {
        id: Number(fila.id),
        smartolt_olt_ref_id: Number(fila.smartolt_olt_ref_id),
        plan_id: fila.plan_id === null ? null : Number(fila.plan_id),
        authorization_preset_id: Number(fila.authorization_preset_id),
        pon_type: fila.pon_type,
    }
}

// ── Vista del panel ──────────────────────────────────────────────────────────────────────────

export interface VistaOltSmartOlt {
    id: number
    smartolt_olt_id: string
    nombre: string | null
    hardware: string | null
    ip: string | null
    presente: boolean
    origen: 'sincronizada' | 'manual'
    olt: { id: number; nombre: string } | null
    perfiles: Array<{ plan_id: number | null; authorization_preset_id: number; pon_type: 'gpon' | 'epon' }>
}

/** `InstanciaSmartOlt` del panel (§5.1): nunca el token (`***`). */
export interface VistaInstancia {
    id: number
    empresa_id: number | null
    compartida: boolean
    nombre: string
    nota: string | null
    url: string
    token: '***'
    activo: boolean
    operativa: boolean
    probado_en: string | null
    prueba_ok: boolean | null
    prueba_error: string | null
    /** en cuánto respondió la última prueba */
    prueba_latencia_ms: number | null
    /** quién hizo la última prueba (nombre), o null */
    probado_por: string | null
    olts_sincronizadas_en: string | null
    version: number
    olts: VistaOltSmartOlt[]
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null)

/**
 * Vista de una instancia. `empresaVisible` (la empresa de quien mira, sin alcance global): en una
 * instancia compartida solo ve las OLT sin vínculo o vinculadas a OLT de Argos suyas o compartidas.
 * null = ve todas.
 */
export async function vistaInstancia(
    fila: FilaInstancia,
    cliente: QueryClientContract = db.connection(),
    empresaVisible: number | null = null,
): Promise<VistaInstancia> {
    const olts = (await cliente
        .from(`${TABLA_OLTS} as o`)
        .leftJoin('network.olts as n', 'n.id', 'o.olt_id')
        .where('o.instancia_id', fila.id)
        .orderBy('o.id')
        .select('o.*', 'n.nombre as olt_nombre', 'n.empresa_id as olt_empresa_id')) as Array<
        FilaOltSmartOlt & { olt_nombre: string | null; olt_empresa_id: number | null }
    >
    const visibles =
        fila.empresa_id === null && empresaVisible !== null
            ? olts.filter(
                  (o) =>
                      o.olt_id === null ||
                      o.olt_empresa_id === null ||
                      Number(o.olt_empresa_id) === empresaVisible,
              )
            : olts
    const perfiles = (await cliente
        .from(TABLA_PERFILES)
        .whereIn(
            'smartolt_olt_ref_id',
            visibles.map((o) => o.id),
        )
        .orderBy('id')
        .select('smartolt_olt_ref_id', 'plan_id', 'authorization_preset_id', 'pon_type')) as Array<
        Omit<PerfilOlt, 'id'>
    >
    const instancia = instanciaDesdeFila(fila)
    return {
        id: Number(fila.id),
        empresa_id: fila.empresa_id === null ? null : Number(fila.empresa_id),
        compartida: fila.empresa_id === null,
        nombre: fila.nombre,
        nota: fila.nota ?? null,
        url: fila.url,
        token: '***',
        activo: fila.activo,
        operativa: instancia.operativa,
        probado_en: iso(fila.probado_en),
        prueba_ok: fila.prueba_ok,
        prueba_error: fila.prueba_error,
        prueba_latencia_ms: fila.prueba_latencia_ms ?? null,
        probado_por: await nombreUsuario(fila.probado_por_id ?? null, cliente),
        olts_sincronizadas_en: iso(fila.olts_sincronizadas_en),
        version: fila.version,
        olts: visibles.map((o) => ({
            id: Number(o.id),
            smartolt_olt_id: o.smartolt_olt_id,
            nombre: o.nombre,
            hardware: o.hardware,
            ip: o.ip,
            presente: o.presente,
            origen: o.origen,
            olt: o.olt_id === null ? null : { id: Number(o.olt_id), nombre: o.olt_nombre ?? '' },
            perfiles: perfiles
                .filter((p) => Number(p.smartolt_olt_ref_id) === Number(o.id))
                .map((p) => ({
                    plan_id: p.plan_id === null ? null : Number(p.plan_id),
                    authorization_preset_id: Number(p.authorization_preset_id),
                    pon_type: p.pon_type,
                })),
        })),
    }
}

// ── §4.2: la instancia de un servicio ────────────────────────────────────────────────────────

export interface EleccionInstancia {
    /**
     * - `guardada`: el equipo o el pedido ya dicen en qué instancia está (paso 1)
     * - `olt`: la OLT del servicio en Argos está vinculada a una OLT de SmartOLT (paso 2)
     * - `unica`: sin OLT conocida, una sola instancia operativa visible (paso 3)
     * - `busqueda`: sin OLT conocida, varias candidatas y la serie apareció en una (paso 3)
     * - `ambigua`: la serie aparece en más de una instancia
     * - `sin_buscar`: varias candidatas y quien llama no buscó (al aceptar)
     * - `ninguna`: ninguna instancia operativa visible, o la serie no apareció en ninguna
     */
    origen: 'guardada' | 'olt' | 'unica' | 'busqueda' | 'ambigua' | 'sin_buscar' | 'ninguna'
    /** la elegida (puede no estar operativa: §4.2 paso 4 lo decide quien llama) */
    instancia: InstanciaSmartOlt | null
    /** la OLT de SmartOLT que se espera por la OLT de Argos (paso 2) */
    oltEsperada: { id: number; smartolt_olt_id: string } | null
    /** paso 3: instancias operativas visibles */
    candidatas: InstanciaSmartOlt[]
    /** paso 3: errores de las búsquedas que fallaron (sin secretos) */
    errores: string[]
}

/** La OLT de Argos del servicio: servidor PPPoE → VLAN → puerto PON → OLT. */
export async function oltArgosDelServicio(
    servicioId: number,
    cliente: QueryClientContract,
): Promise<number | null> {
    const fila = (await cliente
        .from('core.servicios as s')
        .join('network.servidores_pppoe as sp', 'sp.id', 's.servidor_pppoe_id')
        .join('network.vlans as v', 'v.id', 'sp.vlan_id')
        .join('network.olt_puertos_pon as pp', 'pp.id', 'v.puerto_pon_id')
        .where('s.id', servicioId)
        .select('pp.olt_id')
        .first()) as { olt_id: number } | null
    return fila ? Number(fila.olt_id) : null
}

/**
 * §4.2: la instancia de SmartOLT de un servicio.
 *
 * 1. Ya se sabe (`instanciaGuardada`, o `equipos_servicio.smartolt_instancia_id`) → esa.
 * 2. La OLT del servicio en Argos (servidor PPPoE → VLAN → puerto PON → OLT, o `planta.olt` por nombre
 *    entre las `network.olts` visibles) vinculada a una OLT de SmartOLT → su instancia.
 * 3. Si no: las instancias operativas visibles. Una → esa. Varias → `buscar` en cada una (la serie);
 *    la única que la tiene gana; en dos → `ambigua`. Sin `buscar` → `sin_buscar`.
 *
 * No llama a SmartOLT por sí misma: la búsqueda la hace `buscar` (quien llama decide qué rutas usa).
 */
export async function instanciaParaServicio(
    servicio: { id: number; empresa_id: number },
    planta: { olt?: string | null } | null,
    opciones: {
        instanciaGuardada?: number | null
        buscar?: (instancia: InstanciaSmartOlt) => Promise<boolean>
        cliente?: QueryClientContract
    } = {},
): Promise<EleccionInstancia> {
    const cliente = opciones.cliente ?? db.connection()
    const empresaId = Number(servicio.empresa_id)
    const vacia = { oltEsperada: null, candidatas: [], errores: [] }

    // 1. ya se sabe
    let guardada = opciones.instanciaGuardada ?? null
    if (guardada === null) {
        const fila = (await cliente
            .from('integraciones.equipos_servicio')
            .where('servicio_id', servicio.id)
            .whereNotNull('smartolt_instancia_id')
            .select('smartolt_instancia_id')
            .first()) as { smartolt_instancia_id: number } | null
        guardada = fila ? Number(fila.smartolt_instancia_id) : null
    }
    if (guardada !== null) {
        const fila = await leerFilaInstancia(guardada, cliente)
        if (fila && instanciaVisible(fila, empresaId)) {
            return { ...vacia, origen: 'guardada', instancia: instanciaDesdeFila(fila) }
        }
    }

    // 2. por la OLT del servicio en Argos
    let oltArgos = await oltArgosDelServicio(servicio.id, cliente)
    if (oltArgos === null && planta?.olt?.trim()) {
        const filas = (await cliente
            .from('network.olts')
            .whereRaw('lower(nombre) = lower(?)', [planta.olt.trim()])
            .where((q) => q.where('empresa_id', empresaId).orWhereNull('empresa_id'))
            .select('id')) as Array<{ id: number }>
        if (filas.length === 1) oltArgos = Number(filas[0]!.id)
    }
    if (oltArgos !== null) {
        const ref = (await cliente
            .from(TABLA_OLTS)
            .where('olt_id', oltArgos)
            .select('id', 'instancia_id', 'smartolt_olt_id')
            .first()) as { id: number; instancia_id: number; smartolt_olt_id: string } | null
        if (ref) {
            const filaInstancia = await leerFilaInstancia(Number(ref.instancia_id), cliente)
            if (filaInstancia && instanciaVisible(filaInstancia, empresaId)) {
                return {
                    ...vacia,
                    origen: 'olt',
                    instancia: instanciaDesdeFila(filaInstancia),
                    oltEsperada: { id: Number(ref.id), smartolt_olt_id: ref.smartolt_olt_id },
                }
            }
        }
    }

    // 3. sin OLT conocida
    const visibles = await instanciasDeEmpresa(empresaId, cliente)
    const candidatas = visibles.filter((i) => i.operativa)
    if (candidatas.length === 0) return { ...vacia, origen: 'ninguna', instancia: null }
    if (candidatas.length === 1) {
        return { ...vacia, origen: 'unica', instancia: candidatas[0]!, candidatas }
    }
    if (!opciones.buscar) return { ...vacia, origen: 'sin_buscar', instancia: null, candidatas }
    const encontradas: InstanciaSmartOlt[] = []
    const errores: string[] = []
    for (const c of candidatas) {
        try {
            if (await opciones.buscar(c)) encontradas.push(c)
        } catch (error) {
            errores.push(`${c.nombre}: ${(error as Error).message}`)
        }
    }
    if (encontradas.length > 1) {
        return { oltEsperada: null, origen: 'ambigua', instancia: null, candidatas, errores }
    }
    if (encontradas.length === 1) {
        return { oltEsperada: null, origen: 'busqueda', instancia: encontradas[0]!, candidatas, errores }
    }
    return { oltEsperada: null, origen: 'ninguna', instancia: null, candidatas, errores }
}

// ── Administración (acciones `smartolt.*`) ───────────────────────────────────────────────────

/** ¿El actor tiene alcance global? (`empresasPermitidas` null o ausente). */
export function alcanceGlobal(ctx: ContextoAccion): boolean {
    return ctx.empresasPermitidas === null || ctx.empresasPermitidas === undefined
}

/** 403 `empresa_no_permitida`: una instancia compartida solo la administra quien ve todas las empresas. */
export class CompartidaSinAlcance extends Problema {
    constructor() {
        super(
            403,
            'empresa_no_permitida',
            'Empresa no permitida',
            'Una instancia compartida de SmartOLT solo la administra quien tiene acceso a todas las empresas',
        )
    }
}

/**
 * La instancia que se quiere administrar, bloqueada: 404 si no existe o no la ve la empresa activa;
 * 403 si es compartida y el actor no tiene alcance global.
 */
export async function instanciaAdministrable(
    trx: QueryClientContract,
    ctx: ContextoAccion,
    id: number,
): Promise<FilaInstancia> {
    const empresaId = exigirEmpresaActivaDelContexto(ctx)
    const fila = await leerFilaInstancia(id, trx, { bloquear: true })
    if (!fila || !instanciaVisible(fila, empresaId)) {
        throw new NoEncontrado(`La instancia ${id} de SmartOLT no existe`)
    }
    if (fila.empresa_id === null && !alcanceGlobal(ctx)) throw new CompartidaSinAlcance()
    return fila
}

/** La empresa que ve la vista: null (todas sus OLT) con alcance global; si no, la activa. */
export function empresaQueMira(ctx: ContextoAccion): number | null {
    return alcanceGlobal(ctx) ? null : exigirEmpresaActivaDelContexto(ctx)
}

/** 409 si ya hay otra instancia con ese nombre en la empresa (o entre las compartidas). */
export async function exigirNombreLibre(
    trx: QueryClientContract,
    empresaId: number | null,
    nombre: string,
    excepto: number | null = null,
): Promise<void> {
    const q = trx
        .from(TABLA_INSTANCIAS)
        .whereRaw('coalesce(empresa_id, 0) = ?', [empresaId ?? 0])
        .whereRaw('lower(nombre) = lower(?)', [nombre])
    if (excepto !== null) q.whereNot('id', excepto)
    if (await q.first()) {
        throw new Conflicto(
            `Ya hay una instancia de SmartOLT llamada «${nombre}»`,
            'instancia_duplicada',
            'Nombre repetido',
        )
    }
}

/** 409 `subdominio_duplicado`: una cuenta (subdominio) se registra una sola vez en la instalación. */
export async function exigirUrlLibre(
    trx: QueryClientContract,
    url: string,
    excepto: number | null = null,
): Promise<void> {
    const q = trx.from(TABLA_INSTANCIAS).whereRaw('lower(url) = lower(?)', [url])
    if (excepto !== null) q.whereNot('id', excepto)
    if (await q.first()) {
        throw new Conflicto(
            'Esa cuenta (subdominio) de SmartOLT ya está registrada en Argos',
            'subdominio_duplicado',
            'Subdominio repetido',
        )
    }
}

/** Para `audit.cambios`: el token solo como «hay» (`***`). */
export function instanciaSinSecretos(fila: FilaInstancia, tokenNuevo = false): Record<string, unknown> {
    return {
        empresa_id: fila.empresa_id === null ? null : Number(fila.empresa_id),
        nombre: fila.nombre,
        nota: fila.nota ?? null,
        url: fila.url,
        token: tokenNuevo ? '*** (nuevo)' : '***',
        activo: fila.activo,
    }
}

/** `GET /integraciones/smartolt/instancias`: las de la empresa activa y las compartidas, por id. */
export async function listarInstancias(
    ctx: ContextoAccion,
    opciones: OpcionesPaginacion,
): Promise<Pagina<VistaInstancia>> {
    const empresaId = exigirEmpresaActivaDelContexto(ctx)
    const pagina = await paginar(
        db.from(TABLA_INSTANCIAS).where((q) => q.where('empresa_id', empresaId).orWhereNull('empresa_id')),
        opciones,
        { direccion: 'asc' },
    )
    const data: VistaInstancia[] = []
    for (const fila of pagina.data as FilaInstancia[]) {
        data.push(await vistaInstancia(fila, db.connection(), empresaQueMira(ctx)))
    }
    return { data, nextCursor: pagina.nextCursor }
}

/** `GET /integraciones/smartolt/instancias/:id`: 404 si no existe o no la ve la empresa activa. */
export async function verInstancia(ctx: ContextoAccion, id: number): Promise<VistaInstancia> {
    const empresaId = exigirEmpresaActivaDelContexto(ctx)
    const fila = await leerFilaInstancia(id)
    if (!fila || !instanciaVisible(fila, empresaId)) {
        throw new NoEncontrado(`La instancia ${id} de SmartOLT no existe`)
    }
    return vistaInstancia(fila, db.connection(), empresaQueMira(ctx))
}
