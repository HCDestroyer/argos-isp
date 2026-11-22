import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado, Problema } from '#shared/errores'
import { exigirServicio } from '#core/acceso_empresa'
import { usuarioIris } from '#core/integraciones_iris'
import { alcanceEmpresasDeUsuario } from '#core/alcance_empresas'
import { configDeEmpresa, gestionDe } from '#integraciones/equipos/configuracion'
import { contratoAdmite, leerFilaIris } from '#integraciones/iris/configuracion'
import { esTokenIris } from '#integraciones/iris/atencion'
import { avisoApagado, configPara, disponibilidad } from '#notify/configuracion'
import { EVENTO_BIENVENIDA } from '#notify/instalacion'
import type { CanalNotificacion } from '#shared/eventos'

/**
 * Marcas por función de los equipos del cliente (contrato Iris 0.14.3 §4.3): `capacidades.equipos`,
 * una fila por empresa del token de Iris, y el `422 capacidad_no_disponible` de las rutas que controlan.
 *
 * | Marca | Sale de | Controla |
 * | --- | --- | --- |
 * | `estado_equipo` | SmartOLT o GenieACS de la empresa, encendidos y probados | `GET /servicios/:id/equipo` |
 * | `wifi` | GenieACS de la empresa, encendido y probado (el Wi-Fi solo se cambia por TR-069) | `POST /servicios/:id/wifi` y el `wifi` de `aprovisionar` |
 * | `bienvenida` | aviso de bienvenida encendido en la empresa y al menos un canal con plantilla activa y configurado | `bienvenida_servicio` con `origen` (§6.2) y `…/bienvenida/reenviar` |
 * | `cobro_equipo` | el concepto con `codigo_sistema = 'instalacion'` de la empresa, activo (columna de A3) | las líneas de `cargo-unico` con ese concepto (nunca visita ni otros) |
 *
 * - Con un contrato de Iris < 0.9.0, todas en false (`aprovisionamiento` conserva su valor).
 * - El `422` solo a conectores con contrato ≥ 0.14.3 (`exigeCapacidades`), después de comprobar el
 *   alcance del token (`exigirServicioIris`: un servicio de otra empresa responde 404, igual que uno que
 *   no existe). Sin `extensions` y con un `detail` genérico: nunca datos de SmartOLT ni del ACS.
 * - Se calcula en cada llamada (sin caché, regla 5).
 */

export const CONTRATO_CAPACIDADES_EQUIPOS = '0.14.3'
/** `capacidades.equipos` en false con un Iris anterior a esta versión (§4.3). */
export const CONTRATO_EQUIPOS_090 = '0.9.0'
/** Código de sistema del concepto de instalación (`billing.conceptos_cargo.codigo_sistema`). */
export const CONCEPTO_INSTALACION = 'instalacion'

export type FuncionEquipos = 'estado_equipo' | 'wifi' | 'bienvenida' | 'cobro_equipo'

export interface MarcasEquipos {
    estado_equipo: boolean
    wifi: boolean
    bienvenida: boolean
    cobro_equipo: boolean
}

export interface CapacidadEquiposEmpresa extends MarcasEquipos {
    empresa_id: number
}

const NINGUNA: MarcasEquipos = { estado_equipo: false, wifi: false, bienvenida: false, cobro_equipo: false }

/** 422 `capacidad_no_disponible` (§4.3): sin `extensions` ni datos de la configuración. */
export class CapacidadNoDisponible extends Problema {
    constructor() {
        super(
            422,
            'capacidad_no_disponible',
            'Función no disponible',
            'Esta función no está disponible para la empresa del servicio',
        )
    }
}

const CANALES: CanalNotificacion[] = ['whatsapp', 'correo', 'telegram']

/** ¿La empresa manda la bienvenida? Aviso encendido y algún canal con plantilla activa y configurado. */
async function bienvenidaDe(empresaId: number, cliente: QueryClientContract): Promise<boolean> {
    const config = await configPara(empresaId)
    if (avisoApagado(config, EVENTO_BIENVENIDA)) return false
    const filas = (await cliente
        .from('notify.plantillas')
        .where('evento', EVENTO_BIENVENIDA)
        .where('activa', true)
        .select('canal')) as Array<{ canal: CanalNotificacion }>
    const conPlantilla = new Set(filas.map((f) => f.canal))
    return CANALES.some((c) => conPlantilla.has(c) && disponibilidad(config, c, 'clientes').canal !== null)
}

/**
 * ¿Existe ya `billing.conceptos_cargo.codigo_sistema`? La agrega A3 (billing) en esta misma rama
 * (pedido en `a6.md`). Mientras no exista, ningún concepto es el de instalación: `cobro_equipo` sale
 * false y `cargo-unico` nunca responde `capacidad_no_disponible`. Se mira el catálogo y no se atrapa el
 * error de la consulta, porque dentro de una transacción (el canje) un error la deja abortada.
 */
async function hayCodigoSistema(cliente: QueryClientContract): Promise<boolean> {
    const fila = await cliente
        .from('information_schema.columns')
        .where({ table_schema: 'billing', table_name: 'conceptos_cargo', column_name: 'codigo_sistema' })
        .select('column_name')
        .first()
    return Boolean(fila)
}

/** ¿La empresa tiene activo su concepto de sistema de instalación? */
async function cobroEquipoDe(empresaId: number, cliente: QueryClientContract): Promise<boolean> {
    if (!(await hayCodigoSistema(cliente))) return false
    const fila = await cliente
        .from('billing.conceptos_cargo')
        .where({ empresa_id: empresaId, codigo_sistema: CONCEPTO_INSTALACION, activo: true })
        .select('id')
        .first()
    return Boolean(fila)
}

/** Las cuatro marcas de una empresa con su configuración actual (sin mirar el contrato de Iris). */
export async function marcasDeEmpresa(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<MarcasEquipos> {
    const gestion = gestionDe(await configDeEmpresa(empresaId, cliente))
    return {
        estado_equipo: gestion.ftth || gestion.tr069,
        wifi: gestion.tr069,
        bienvenida: await bienvenidaDe(empresaId, cliente),
        cobro_equipo: await cobroEquipoDe(empresaId, cliente),
    }
}

/** Una marca de una empresa (lo que usa cada ruta). */
export async function tieneCapacidad(
    empresaId: number,
    funcion: FuncionEquipos,
    cliente: QueryClientContract = db.connection(),
): Promise<boolean> {
    const marcas = await marcasDeEmpresa(empresaId, cliente)
    return marcas[funcion]
}

/** Empresas del token de Iris (el alcance del usuario técnico Iris); [] sin usuario. */
export async function empresasDelTokenIris(
    cliente: QueryClientContract = db.connection(),
): Promise<number[]> {
    const id = await usuarioIris(cliente)
    if (id === null) return []
    const alcance = await alcanceEmpresasDeUsuario(id, cliente)
    return alcance.empresas
}

/**
 * `capacidades.equipos` (§4.3): una fila por empresa del token. Con un contrato de Iris < 0.9.0 (o sin
 * contrato), todas en false.
 */
export async function capacidadesEquipos(
    empresas: number[],
    contratoIris: string | null | undefined,
    cliente: QueryClientContract = db.connection(),
): Promise<CapacidadEquiposEmpresa[]> {
    const admite = contratoAdmite(contratoIris, CONTRATO_EQUIPOS_090)
    const filas: CapacidadEquiposEmpresa[] = []
    for (const empresaId of empresas) {
        filas.push({
            empresa_id: empresaId,
            ...(admite ? await marcasDeEmpresa(empresaId, cliente) : NINGUNA),
        })
    }
    return filas
}

/** ¿La petición es del token de Iris con un contrato ≥ 0.14.3? Entonces aplican las reglas de la 0.14.3. */
export async function exigeCapacidades(ctx: HttpContext): Promise<boolean> {
    if (!esTokenIris(ctx)) return false
    const fila = await leerFilaIris()
    return contratoAdmite(fila?.contrato, CONTRATO_CAPACIDADES_EQUIPOS)
}

/**
 * Alcance primero (§4.3): con las reglas de la 0.14.3, un servicio fuera de las empresas del token
 * responde el mismo 404 que uno que no existe. Devuelve la empresa del servicio.
 */
export async function exigirServicioIris(ctx: HttpContext, servicioId: number, reglas0143: boolean) {
    const noExiste = () => new NoEncontrado(`El servicio ${servicioId} no existe`)
    try {
        await exigirServicio(ctx, servicioId)
    } catch (error) {
        if (reglas0143 && error instanceof Problema && error.status === 403) throw noExiste()
        throw error
    }
    const fila = (await db.from('core.servicios').where('id', servicioId).select('empresa_id').first()) as {
        empresa_id: number
    } | null
    if (!fila) throw noExiste()
    return Number(fila.empresa_id)
}

/** `422 capacidad_no_disponible` si la empresa no tiene la marca (solo con las reglas de la 0.14.3). */
export async function exigirCapacidad(empresaId: number, funcion: FuncionEquipos): Promise<void> {
    if (!(await tieneCapacidad(empresaId, funcion))) throw new CapacidadNoDisponible()
}

/**
 * `cobro_equipo` en `cargo-unico` (§4.3, A36): solo las líneas cuyo concepto es el de sistema
 * `instalacion`; los demás conceptos (visita, materiales, otros) nunca responden `422`.
 */
export async function exigirCobroEquipo(conceptoIds: number[]): Promise<void> {
    if (conceptoIds.length === 0 || !(await hayCodigoSistema(db.connection()))) return
    const filas = (await db
        .from('billing.conceptos_cargo')
        .whereIn('id', conceptoIds)
        .where('codigo_sistema', CONCEPTO_INSTALACION)
        .select('empresa_id')) as Array<{ empresa_id: number }>
    for (const f of filas) {
        if (!(await cobroEquipoDe(Number(f.empresa_id), db.connection()))) throw new CapacidadNoDisponible()
    }
}
