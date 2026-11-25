import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, Problema, ReglaNegocio, type ErrorCampo, type ProblemaJson } from '#shared/errores'
import type { TipoEquipoCliente } from '#shared/eventos'
import { gestionDe, type ConfigSmartOlt, type GestionEmpresa } from '#integraciones/equipos/configuracion'
import {
    instanciaParaServicio,
    instanciasDeEmpresa,
    leerFilaInstancia,
    leerInstancia,
    oltArgosDelServicio,
    perfilPara,
    type InstanciaSmartOlt,
} from '#integraciones/equipos/smartolt_instancias'
import { acsDeEmpresa } from '#integraciones/equipos/acs'
import * as smartolt from '#integraciones/equipos/smartolt'
import * as genieacs from '#integraciones/equipos/genieacs'
import {
    capacidadesEquipos,
    empresasDelTokenIris,
    type CapacidadEquiposEmpresa,
} from '#integraciones/equipos/capacidades'
import { leerFilaIris } from '#integraciones/iris/configuracion'

/**
 * Equipos del cliente (contrato Iris 0.9.0 §12, bloque E: A32, A33 y A35) con SmartOLT (ONU de
 * fibra) y GenieACS (TR-069: routers, CPE y la propia ONT si habla TR-069). Ver `README.md`.
 *
 * - `capacidades.aprovisionamiento` (§4.3) sale por empresa de `gestionDe`: configurado, encendido
 *   y probado.
 * - `GET /servicios/:id/equipo` (`estadoEquipo`) lee el equipo gestionado del servicio
 *   (`integraciones.equipos_servicio`, lo llena el aprovisionamiento) o lo descubre una vez por la
 *   serie o la MAC de su comodato. Sin equipo gestionado: `409 equipo_sin_gestion` con los equipos
 *   del inventario como extensión.
 */

export type Tecnologia = 'ftth' | 'wireless' | 'tr069'

/** Qué gestiona Argos por empresa y tecnología (§4.3). */
export async function gestionDeEmpresa(
    empresaId: number | null,
    cliente: QueryClientContract = db.connection(),
): Promise<GestionEmpresa> {
    return gestionDe(empresaId, cliente)
}

export interface CapacidadesIris {
    aprovisionamiento: Array<{ empresa_id: number; ftth: boolean; wireless: boolean; tr069: boolean }>
    /** 0.14.3 §4.3: marcas por función, una fila por empresa del token (`#integraciones/equipos/capacidades`) */
    equipos: CapacidadEquiposEmpresa[]
}

/**
 * `capacidades` del canje y de `GET /integraciones/iris/estado` (§4.3): `aprovisionamiento` con una fila
 * por empresa activa y, desde 0.14.3, `equipos` con una fila por empresa del token de Iris. Sin
 * `opciones`, las empresas y el contrato salen del usuario técnico Iris y del conector guardado; el
 * canje pasa los suyos (el contrato que acaba de informar Iris y el alcance del token nuevo).
 */
export async function capacidadesIris(
    cliente: QueryClientContract = db.connection(),
    opciones: { empresas?: number[]; contratoIris?: string | null } = {},
): Promise<CapacidadesIris> {
    const empresas = (await cliente
        .from('core.empresas')
        .where('activa', true)
        .orderBy('id')
        .select('id')) as Array<{ id: number }>
    const aprovisionamiento = []
    for (const e of empresas) {
        aprovisionamiento.push({
            empresa_id: Number(e.id),
            ...(await gestionDeEmpresa(Number(e.id), cliente)),
        })
    }
    const delToken = opciones.empresas ?? (await empresasDelTokenIris(cliente))
    let contrato = opciones.contratoIris
    if (contrato === undefined) {
        const fila = await leerFilaIris(cliente)
        contrato = fila?.contrato ?? null
    }
    return { aprovisionamiento, equipos: await capacidadesEquipos(delToken, contrato, cliente) }
}

/** Problema con miembros de extensión (RFC 9457) bajo `extensions`. */
export class ProblemaConExtensiones extends Problema {
    constructor(
        status: number,
        codigo: string,
        titulo: string,
        detalle: string,
        readonly extensions: Record<string, unknown> | null = null,
        errores?: ErrorCampo[],
    ) {
        super(status, codigo, titulo, detalle, errores)
    }

    override toJSON(): ProblemaJson & { extensions?: Record<string, unknown> } {
        const json = super.toJSON()
        return this.extensions ? { ...json, extensions: this.extensions } : json
    }
}

/** 409 `equipo_sin_gestion` (§12.3, §12.4). */
export class EquipoSinGestion extends ProblemaConExtensiones {
    constructor(
        extensions: Record<string, unknown> | null = null,
        detalle = 'Argos no gestiona el equipo de este servicio por SmartOLT ni por el ACS (TR-069)',
    ) {
        super(409, 'equipo_sin_gestion', 'Equipo sin gestión', detalle, extensions)
    }
}

/** 503 `equipo_sin_respuesta` (§12.3): ni SmartOLT ni el ACS respondieron. */
export class EquipoSinRespuesta extends Problema {
    constructor(detalle: string) {
        super(503, 'equipo_sin_respuesta', 'El equipo no respondió', detalle)
    }
}

/**
 * 409 `aprovisionamiento_en_curso` (§12.2) con `extensions.aprovisionamiento_id` y, desde 0.14.3,
 * `extensions.iniciado_por` (`argos` | `iris`). Nunca datos del equipo.
 */
export class AprovisionamientoEnCurso extends ProblemaConExtensiones {
    constructor(aprovisionamientoId: number, iniciadoPor: 'argos' | 'iris') {
        super(
            409,
            'aprovisionamiento_en_curso',
            'Aprovisionamiento en curso',
            `El servicio ya tiene el aprovisionamiento ${aprovisionamientoId} en curso`,
            { aprovisionamiento_id: aprovisionamientoId, iniciado_por: iniciadoPor },
        )
    }
}

/** 422 `aprovisionamiento_no_disponible` (§12.2). */
export class AprovisionamientoNoDisponible extends ReglaNegocio {
    constructor(
        detalle = 'La empresa del servicio no tiene SmartOLT ni ACS configurado en Argos: activa la instalación al cerrar la orden',
    ) {
        super(detalle, 'aprovisionamiento_no_disponible')
    }
}

/** 422 `wifi_no_disponible` (§12.2): `wifi` con un equipo que Argos no configura por el ACS. */
export class WifiNoDisponible extends ReglaNegocio {
    constructor() {
        super(
            'Argos no configura el Wi-Fi de este equipo (la empresa no tiene ACS TR-069 probado): reenvía sin `wifi`',
            'wifi_no_disponible',
        )
    }
}

export class EquipoInvalido extends ReglaNegocio {
    constructor(detalle: string, errores: ErrorCampo[]) {
        super(detalle, 'equipo_invalido', errores)
    }
}

export class WifiInvalido extends ReglaNegocio {
    constructor(errores: ErrorCampo[]) {
        super(
            'SSID de 1 a 32 caracteres y clave de 8 a 63, sin caracteres de control',
            'wifi_invalido',
            errores,
        )
    }
}

export class VerificacionRequerida extends ReglaNegocio {
    constructor(detalle: string) {
        super(detalle, 'verificacion_requerida')
    }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** SSID de 1 a 32 y clave de 8 a 63 (WPA2), sin caracteres de control. Los errores nunca repiten el valor. */
export function validarWifi(wifi: { ssid?: string | null; clave?: string | null }, prefijo = ''): void {
    const errores: ErrorCampo[] = []
    const { ssid, clave } = wifi
    if ((ssid === undefined || ssid === null) && (clave === undefined || clave === null)) {
        errores.push({
            field: `${prefijo}ssid`,
            rule: 'requerido',
            message: 'Manda al menos el SSID o la clave',
        })
    }
    if (ssid !== undefined && ssid !== null && (ssid.length < 1 || ssid.length > 32 || CONTROL.test(ssid))) {
        errores.push({ field: `${prefijo}ssid`, rule: 'formato', message: 'SSID de 1 a 32 caracteres' })
    }
    if (
        clave !== undefined &&
        clave !== null &&
        (clave.length < 8 || clave.length > 63 || CONTROL.test(clave))
    ) {
        errores.push({ field: `${prefijo}clave`, rule: 'formato', message: 'Clave de 8 a 63 caracteres' })
    }
    if (errores.length > 0) throw new WifiInvalido(errores)
}

export interface EquipoComodato {
    unidad_id: number
    producto: string
    serie: string | null
    mac: string | null
    estado: string
}

/** Equipos del servicio en comodato (o por recuperar) según el inventario. */
export async function equiposEnComodato(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<EquipoComodato[]> {
    const filas = (await cliente
        .from('inventario.unidades as u')
        .join('inventario.productos as p', 'p.id', 'u.producto_id')
        .where('u.servicio_id', servicioId)
        .whereIn('u.estado', ['en_comodato', 'por_recuperar'])
        .orderBy('u.id')
        .select('u.id', 'p.nombre', 'u.serie', 'u.mac', 'u.estado')) as Array<{
        id: number
        nombre: string
        serie: string | null
        mac: string | null
        estado: string
    }>
    return filas.map((f) => ({
        unidad_id: Number(f.id),
        producto: f.nombre,
        serie: f.serie,
        mac: f.mac,
        estado: f.estado,
    }))
}

// ── Equipo gestionado del servicio ────────────────────────────────────────────────────────────

export interface EquipoGestionado {
    servicio_id: number
    empresa_id: number
    tipo: TipoEquipoCliente
    serie: string | null
    mac: string | null
    modelo: string | null
    unidad_id: number | null
    smartolt_external_id: string | null
    /** instancia de SmartOLT donde está la ONU (§4.2); null en registros anteriores al lote 3 */
    smartolt_instancia_id: number | null
    acs_device_id: string | null
}

/**
 * El equipo gestionado del servicio. Se guardó con la empresa de entonces: si el servicio pasó a otra
 * empresa, el id del ACS ya no vale (es del ACS de la otra empresa) y la parte de SmartOLT solo vale si
 * la instancia es **compartida** (la ven las dos). Si no queda nada que valga: null (se vuelve a
 * descubrir).
 */
export async function equipoGestionado(
    servicioId: number,
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<EquipoGestionado | null> {
    const fila = (await cliente
        .from('integraciones.equipos_servicio as e')
        .leftJoin('integraciones.smartolt_instancias as i', 'i.id', 'e.smartolt_instancia_id')
        .where('e.servicio_id', servicioId)
        .select('e.*', 'i.empresa_id as instancia_empresa_id', 'i.id as instancia_existe')
        .first()) as
        (EquipoGestionado & { instancia_empresa_id: number | null; instancia_existe: number | null }) | null
    if (!fila) return null
    const equipo: EquipoGestionado = {
        servicio_id: Number(fila.servicio_id),
        empresa_id: Number(fila.empresa_id),
        tipo: fila.tipo,
        serie: fila.serie,
        mac: fila.mac,
        modelo: fila.modelo,
        unidad_id: fila.unidad_id === null ? null : Number(fila.unidad_id),
        smartolt_external_id: fila.smartolt_external_id,
        smartolt_instancia_id:
            fila.smartolt_instancia_id === null ? null : Number(fila.smartolt_instancia_id),
        acs_device_id: fila.acs_device_id,
    }
    if (equipo.empresa_id === empresaId) return equipo
    const compartida = fila.instancia_existe !== null && fila.instancia_empresa_id === null
    if (!compartida || !equipo.smartolt_external_id) return null
    return { ...equipo, empresa_id: empresaId, acs_device_id: null }
}

/** Guarda (o reemplaza) el equipo gestionado de un servicio. */
export async function guardarEquipoGestionado(
    cliente: QueryClientContract,
    e: EquipoGestionado & { aprovisionamiento_id?: number | null },
): Promise<void> {
    await cliente
        .knexQuery()
        .table('integraciones.equipos_servicio')
        .insert({ ...e, aprovisionamiento_id: e.aprovisionamiento_id ?? null, actualizado_en: new Date() })
        .onConflict('servicio_id')
        .merge()
    await cliente.from('integraciones.equipos_lecturas').where('servicio_id', e.servicio_id).delete()
}

/**
 * Busca una vez el equipo de un servicio que no pasó por el aprovisionamiento (servicios viejos o
 * importados), por la serie o la MAC de su comodato:
 * - SmartOLT: la instancia del servicio (§4.2: la de su OLT en Argos, la única operativa o, si hay
 *   varias, la que tenga esa serie autorizada) y su id externo;
 * - el ACS de la empresa, por separado: por la serie o la MAC.
 * Lo que encuentra queda guardado como equipo gestionado, con la instancia.
 */
export async function descubrirEquipo(
    servicioId: number,
    empresaId: number,
    /** la transacción de quien llama si ya bloqueó el servicio (la FK chocaría con su lock) */
    cliente: QueryClientContract = db.connection(),
): Promise<EquipoGestionado | null> {
    const acsEmpresa = await acsDeEmpresa(empresaId, cliente)
    const instancias = await instanciasDeEmpresa(empresaId, cliente)
    const ftth = instancias.some((i) => i.operativa)
    if (!ftth && !acsEmpresa.operativo) return null
    for (const u of await equiposEnComodato(servicioId, cliente)) {
        let externo: string | null = null
        let modelo: string | null = null
        let instanciaId: number | null = null
        if (ftth && u.serie) {
            const serie = u.serie
            const hallazgos = new Map<number, smartolt.DetalleOnu>()
            const buscar = async (inst: InstanciaSmartOlt) => {
                const onus = await smartolt.detallesPorSerie(inst.config!, serie, servicioId)
                const onu = onus.find((o) => o.unique_external_id)
                if (onu) hallazgos.set(inst.id, onu)
                return Boolean(onu)
            }
            const eleccion = await instanciaParaServicio({ id: servicioId, empresa_id: empresaId }, null, {
                cliente,
                buscar,
            })
            const inst = eleccion.instancia
            if (inst?.operativa && inst.config) {
                if (!hallazgos.has(inst.id)) await buscar(inst).catch(() => false)
                const onu = hallazgos.get(inst.id)
                if (onu) {
                    externo = onu.unique_external_id
                    modelo = onu.onu_type_name
                    instanciaId = inst.id
                }
            }
        }
        let acs: genieacs.DispositivoAcs | null = null
        const nbi = acsEmpresa.operativo ? acsEmpresa.genieacs : null
        if (nbi) {
            acs =
                (u.serie ? await genieacs.porSerie(nbi, u.serie, servicioId).catch(() => null) : null) ??
                (u.mac ? await genieacs.porMac(nbi, u.mac, servicioId).catch(() => null) : null)
        }
        if (!externo && !acs) continue
        const equipo: EquipoGestionado = {
            servicio_id: servicioId,
            empresa_id: empresaId,
            tipo: externo ? 'ont' : 'router_tr069',
            serie: u.serie,
            mac: u.mac,
            modelo: modelo ?? acs?.clase_producto ?? null,
            unidad_id: u.unidad_id,
            smartolt_external_id: externo,
            smartolt_instancia_id: instanciaId,
            acs_device_id: acs?.id ?? null,
        }
        await guardarEquipoGestionado(cliente, equipo)
        return equipo
    }
    return null
}

/**
 * Credenciales de la instancia de SmartOLT donde está el equipo, si está operativa (§4.3: «cada
 * sistema aporta lo suyo»). Registros anteriores al lote 3 (sin instancia): la que diga §4.2 sin
 * buscar (la de su OLT en Argos o la única operativa).
 */
async function instanciaDelEquipo(equipo: EquipoGestionado): Promise<ConfigSmartOlt | null> {
    let inst: InstanciaSmartOlt | null
    if (equipo.smartolt_instancia_id === null) {
        const eleccion = await instanciaParaServicio(
            { id: equipo.servicio_id, empresa_id: equipo.empresa_id },
            null,
        )
        inst = eleccion.instancia
    } else {
        inst = await leerInstancia(equipo.smartolt_instancia_id)
    }
    return inst?.operativa ? inst.config : null
}

// ── A33: estado del equipo ────────────────────────────────────────────────────────────────────

/** La lectura guardada sirve si tiene menos de esto (§12.3: «menos de 60 s»). */
export const VIGENCIA_LECTURA_MS = 55_000
/** Sin dato de la OLT, «en línea» = el equipo informó al ACS hace menos de esto. */
export const EN_LINEA_ACS_MS = 15 * 60_000

export interface EstadoEquipoVista {
    servicio_id: number
    tecnologia: 'ftth' | 'wireless'
    tipo?: TipoEquipoCliente
    serie?: string | null
    mac?: string | null
    modelo?: string | null
    en_linea: boolean
    senal: Record<string, number | null> | null
    firmware?: string | null
    ssid?: string | null
    ultimo_contacto: string | null
    fuente?: 'smartolt' | 'acs'
    leido_en: string
}

/** Lo que ve el asistente de IA (§12.3): sin serie, MAC, modelo, firmware ni SSID. */
function paraAsistente(v: EstadoEquipoVista): EstadoEquipoVista {
    return {
        servicio_id: v.servicio_id,
        tecnologia: v.tecnologia,
        en_linea: v.en_linea,
        senal: v.senal,
        ultimo_contacto: v.ultimo_contacto,
        leido_en: v.leido_en,
    }
}

/**
 * `GET /servicios/:id/equipo` (§12.3). Lee SmartOLT (estado y señal de la ONU) y GenieACS (último
 * contacto, firmware, modelo y SSID; nunca la clave). Responde la lectura guardada si tiene menos de
 * 60 s. Errores: `409 equipo_sin_gestion` (con los equipos del inventario como extensión, salvo al
 * asistente) y `503 equipo_sin_respuesta` si ningún sistema respondió.
 */
export async function estadoEquipo(
    servicioId: number,
    opciones: { asistente: boolean },
): Promise<EstadoEquipoVista> {
    const servicio = (await db
        .from('core.servicios')
        .where('id', servicioId)
        .select('empresa_id')
        .first()) as { empresa_id: number } | null
    const empresaId = Number(servicio?.empresa_id)
    const acsEmpresa = await acsDeEmpresa(empresaId)
    const gestion = await gestionDe(empresaId)
    const sinGestion = async () =>
        opciones.asistente
            ? new EquipoSinGestion()
            : new EquipoSinGestion({ equipos: await equiposEnComodato(servicioId) })

    if (!gestion.ftth && !gestion.tr069) throw await sinGestion()
    const equipo =
        (await equipoGestionado(servicioId, empresaId)) ?? (await descubrirEquipo(servicioId, empresaId))
    if (!equipo) throw await sinGestion()

    const guardada = (await db
        .from('integraciones.equipos_lecturas')
        .where('servicio_id', servicioId)
        .first()) as { datos: EstadoEquipoVista; leido_en: Date } | null
    if (guardada && Date.now() - new Date(guardada.leido_en).getTime() < VIGENCIA_LECTURA_MS) {
        return opciones.asistente ? paraAsistente(guardada.datos) : guardada.datos
    }

    const olt = equipo.smartolt_external_id ? await instanciaDelEquipo(equipo) : null
    const acs = equipo.acs_device_id && gestion.tr069 ? acsEmpresa.genieacs : null
    if (!olt && !acs) throw await sinGestion()

    const errores: string[] = []
    let enLineaOlt: boolean | null = null
    let ultimoOlt: string | null = null
    let senal: Record<string, number | null> | null = null
    if (olt) {
        try {
            const e = await smartolt.estado(olt, equipo.smartolt_external_id!, servicioId)
            enLineaOlt = e.estado === 'Online'
            ultimoOlt = smartolt.instanteSmartOlt(e.ultimo_cambio)
            senal = enLineaOlt
                ? await smartolt.senal(olt, equipo.smartolt_external_id!, servicioId).catch(() => null)
                : null
        } catch (error) {
            errores.push((error as Error).message)
        }
    }
    let dispositivo: genieacs.DispositivoAcs | null = null
    if (acs) {
        try {
            dispositivo = await genieacs.porId(acs, equipo.acs_device_id!, servicioId)
            if (!dispositivo) errores.push('El equipo ya no está registrado en el ACS')
        } catch (error) {
            errores.push((error as Error).message)
        }
    }
    if (enLineaOlt === null && !dispositivo) {
        throw new EquipoSinRespuesta(`No se pudo leer el equipo: ${errores.join(' · ') || 'sin respuesta'}`)
    }

    const ahora = new Date()
    const enLineaAcs = dispositivo?.ultimo_contacto
        ? ahora.getTime() - new Date(dispositivo.ultimo_contacto).getTime() < EN_LINEA_ACS_MS
        : false
    const vista: EstadoEquipoVista = {
        servicio_id: servicioId,
        tecnologia: equipo.tipo === 'ont' || equipo.smartolt_external_id ? 'ftth' : 'wireless',
        tipo: equipo.tipo,
        serie: equipo.serie,
        mac: equipo.mac,
        modelo: equipo.modelo ?? dispositivo?.clase_producto ?? null,
        en_linea: enLineaOlt ?? enLineaAcs,
        senal,
        firmware: dispositivo?.firmware ?? null,
        ssid: dispositivo?.ssid ?? null,
        ultimo_contacto: dispositivo?.ultimo_contacto ?? (enLineaOlt ? ahora.toISOString() : ultimoOlt),
        fuente: enLineaOlt !== null ? 'smartolt' : 'acs',
        leido_en: ahora.toISOString(),
    }
    await db
        .knexQuery()
        .table('integraciones.equipos_lecturas')
        .insert({ servicio_id: servicioId, datos: JSON.stringify(vista), leido_en: ahora })
        .onConflict('servicio_id')
        .merge()
    return opciones.asistente ? paraAsistente(vista) : vista
}

// ── Ficha del servicio › Equipo (tablero PendEquipoServicio) ──────────────────────────────────

export interface VistaGestionEquipo {
    servicio_id: number
    empresa_id: number
    smartolt: {
        /** alguna instancia operativa (propia o compartida) */
        disponible: boolean
        /** cómo se elige la cuenta (§4.2, sin llamar a SmartOLT): `sin_buscar` = se busca la serie en `cuentas` */
        origen: 'guardada' | 'olt' | 'unica' | 'sin_buscar' | 'ninguna'
        instancia: { id: number; nombre: string; url: string; operativa: boolean; compartida: boolean } | null
        /** las cuentas operativas de la empresa (donde se busca la serie si la OLT no está ligada) */
        cuentas: Array<{ id: number; nombre: string }>
        olt_argos: { id: number; nombre: string } | null
        olt_smartolt: { id: number; smartolt_olt_id: string; nombre: string | null } | null
        /** identificador del puerto PON del servicio en la red de acceso de Argos */
        puerto_pon: string | null
        perfil: { authorization_preset_id: number; pon_type: 'gpon' | 'epon' } | null
    }
    acs: { configurado: boolean; activo: boolean; operativo: boolean; pppoe_por_acs: boolean }
    equipo: {
        tipo: TipoEquipoCliente
        serie: string | null
        mac: string | null
        modelo: string | null
        onu_external_id: string | null
        en_acs: boolean
    } | null
}

/**
 * Qué cuenta y qué OLT de SmartOLT usa un servicio y qué hace el ACS con él (para la ficha del
 * servicio). Solo lee la base de Argos: **no** llama a SmartOLT ni al ACS (el estado en vivo sale de
 * `GET /servicios/:id/equipo`). Nunca secretos.
 */
export async function gestionEquipoServicio(servicioId: number): Promise<VistaGestionEquipo> {
    const servicio = (await db
        .from('core.servicios')
        .where('id', servicioId)
        .select('empresa_id', 'plan_id', 'servidor_pppoe_id')
        .first()) as { empresa_id: number; plan_id: number; servidor_pppoe_id: number | null } | null
    if (!servicio) throw new NoEncontrado(`El servicio ${servicioId} no existe`)
    const empresaId = Number(servicio.empresa_id)
    const instancias = await instanciasDeEmpresa(empresaId)
    const cuentas = instancias.filter((i) => i.operativa).map((i) => ({ id: i.id, nombre: i.nombre }))
    const eleccion = await instanciaParaServicio({ id: servicioId, empresa_id: empresaId }, null)
    const origen =
        eleccion.origen === 'busqueda' || eleccion.origen === 'ambigua' ? 'sin_buscar' : eleccion.origen

    const oltArgosId = await oltArgosDelServicio(servicioId, db.connection())
    const oltArgos = oltArgosId
        ? ((await db.from('network.olts').where('id', oltArgosId).select('id', 'nombre').first()) as {
              id: number
              nombre: string
          } | null)
        : null
    const puerto = (await db
        .from('core.servicios as s')
        .join('network.servidores_pppoe as sp', 'sp.id', 's.servidor_pppoe_id')
        .join('network.vlans as v', 'v.id', 'sp.vlan_id')
        .join('network.olt_puertos_pon as pp', 'pp.id', 'v.puerto_pon_id')
        .where('s.id', servicioId)
        .select('pp.identificador')
        .first()) as { identificador: string } | null
    const ref = oltArgosId
        ? ((await db
              .from('integraciones.smartolt_olts')
              .where('olt_id', oltArgosId)
              .select('id', 'instancia_id', 'smartolt_olt_id', 'nombre')
              .first()) as {
              id: number
              instancia_id: number
              smartolt_olt_id: string
              nombre: string | null
          } | null)
        : null
    const refDeLaInstancia =
        ref && eleccion.instancia && Number(ref.instancia_id) === eleccion.instancia.id ? ref : null
    const perfil = refDeLaInstancia
        ? await perfilPara(Number(refDeLaInstancia.id), Number(servicio.plan_id))
        : null
    const filaInstancia = eleccion.instancia ? await leerFilaInstancia(eleccion.instancia.id) : null

    const acs = await acsDeEmpresa(empresaId)
    const equipo = await equipoGestionado(servicioId, empresaId)
    return {
        servicio_id: servicioId,
        empresa_id: empresaId,
        smartolt: {
            disponible: cuentas.length > 0,
            origen,
            instancia:
                eleccion.instancia && filaInstancia
                    ? {
                          id: eleccion.instancia.id,
                          nombre: eleccion.instancia.nombre,
                          url: filaInstancia.url,
                          operativa: eleccion.instancia.operativa,
                          compartida: filaInstancia.empresa_id === null,
                      }
                    : null,
            cuentas,
            olt_argos: oltArgos ? { id: Number(oltArgos.id), nombre: oltArgos.nombre } : null,
            olt_smartolt: refDeLaInstancia
                ? {
                      id: Number(refDeLaInstancia.id),
                      smartolt_olt_id: refDeLaInstancia.smartolt_olt_id,
                      nombre: refDeLaInstancia.nombre,
                  }
                : null,
            puerto_pon: puerto?.identificador ?? null,
            perfil: perfil
                ? { authorization_preset_id: perfil.authorization_preset_id, pon_type: perfil.pon_type }
                : null,
        },
        acs: {
            configurado: acs.genieacs !== null,
            activo: acs.activo,
            operativo: acs.operativo,
            pppoe_por_acs: acs.pppoePorAcs,
        },
        equipo: equipo
            ? {
                  tipo: equipo.tipo,
                  serie: equipo.serie,
                  mac: equipo.mac,
                  modelo: equipo.modelo,
                  onu_external_id: equipo.smartolt_external_id,
                  en_acs: equipo.acs_device_id !== null,
              }
            : null,
    }
}
