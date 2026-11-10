import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { alcanceDePermiso, type Alcance } from '#core/acl'
import { alcanceEmpresasDeUsuario } from '#core/alcance_empresas'
import type { Permiso } from '#core/permisos'
import { conectorVigente, resolverActorIris } from '#core/vinculo_externo'
import type { EmpresaPeticion } from '#shared/empresa_activa'
import { Problema, Prohibido } from '#shared/errores'
import { ConectorIrisApagado } from '#core/actions/emitir_ticket_sso'

/**
 * Actuación vinculada (contrato Iris 0.7.0, A23): un operador humano de Iris aprueba o rechaza un
 * comprobante **como su usuario de Argos vinculado**. Iris llama con el token del usuario técnico
 * Iris y `X-Iris-Actor: usuario:<id en Iris>`; Argos busca la vinculación vigente
 * (`core.vinculaciones_externas`, conector `iris`) y la acción corre y se audita con ese usuario.
 *
 * Es acotado a propósito:
 * - Solo lo pide una ruta con `actuarComoVinculado: '<permiso>'` en `definirRuta`, y solo con un
 *   permiso de `PERMISOS_ACTUACION_VINCULADA` (el registro de rutas falla al arrancar si no).
 * - La acción de nivel superior que corre con la actuación debe llamarse igual que ese permiso
 *   (`DomainAction` lo verifica); las anidadas heredan el contexto.
 * - Solo aplica al token del usuario técnico Iris; el panel y otros tokens actúan como sí mismos.
 *
 * Errores (problem+json, `type` = `urn:argosisp:problema:<code>`), en este orden:
 * - 403 `actor_ia_no_permitido` (`asistente_ia`);
 * - 409 `iris_apagado`: el conector Iris no está vigente (el mismo de
 *   `POST /integraciones/iris/sso/tickets`): token revocado o conector preparado con enlace y
 *   apagado; 403 `prohibido` si el conector se preparó con un enlace y el token no es el de ese
 *   canje (igual que los tickets);
 * - 403 `actor_sin_vinculo`, `actor_inactivo`, `actor_sin_permiso`, `actor_sin_empresa`.
 */

/** Permisos (= acciones) que una ruta puede ejecutar como el usuario vinculado. */
export const PERMISOS_ACTUACION_VINCULADA = [
    'comprobantes.aprobar',
    'comprobantes.rechazar',
] as const satisfies readonly Permiso[]
export type PermisoActuacionVinculada = (typeof PERMISOS_ACTUACION_VINCULADA)[number]

export function esPermisoActuacionVinculada(valor: unknown): valor is PermisoActuacionVinculada {
    return (PERMISOS_ACTUACION_VINCULADA as readonly unknown[]).includes(valor)
}

export const CODIGOS_ACTOR_RECHAZADO = [
    'actor_ia_no_permitido',
    'actor_sin_vinculo',
    'actor_inactivo',
    'actor_sin_permiso',
    'actor_sin_empresa',
] as const
export type CodigoActorRechazado = (typeof CODIGOS_ACTOR_RECHAZADO)[number]

const TITULOS: Record<CodigoActorRechazado, string> = {
    actor_ia_no_permitido: 'El asistente de IA no puede hacer esta acción',
    actor_sin_vinculo: 'Operador de Iris sin vinculación',
    actor_inactivo: 'Usuario vinculado inactivo',
    actor_sin_permiso: 'El usuario vinculado no tiene el permiso',
    actor_sin_empresa: 'El usuario vinculado no opera esa empresa',
}

/** 403 de la actuación vinculada, con su `code`. */
export class ActorRechazado extends Problema {
    readonly codigo: CodigoActorRechazado

    constructor(codigo: CodigoActorRechazado, detalle: string) {
        super(403, codigo, TITULOS[codigo], detalle)
        this.codigo = codigo
    }
}

/**
 * El conector Iris sigue vigente para este token: el token sin revocar (`conectorVigente`, la misma
 * regla del canje del autologin) y, si el conector se preparó con un enlace, que sea el token de ese
 * canje (403) y que el conector esté encendido (409 `iris_apagado`), igual que al pedir tickets.
 */
export async function exigirConectorIrisVigente(
    tokenApiId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<void> {
    if (!(await conectorVigente('iris', tokenApiId, cliente))) throw new ConectorIrisApagado()
    const enlazado = (await cliente
        .from('integraciones.iris_conector')
        .where('id', 1)
        .select('activo', 'token_argos_id', 'conectado_por_enlace_en')
        .first()) as {
        activo: boolean
        token_argos_id: number | null
        conectado_por_enlace_en: Date | null
    } | null
    if (enlazado?.conectado_por_enlace_en) {
        if (Number(enlazado.token_argos_id) !== Number(tokenApiId)) {
            throw new Prohibido('El conector se preparó con un enlace: solo vale el token de ese canje')
        }
        if (!enlazado.activo) throw new ConectorIrisApagado()
    }
}

export interface EntradaActuacion {
    /** `X-Iris-Actor` ya validado */
    actorIris: string
    /** permiso de la ruta (`comprobantes.aprobar`) */
    permiso: PermisoActuacionVinculada
    /** `core.tokens_api.id` del token Iris de la petición */
    tokenApiId: number
    /** empresa de la petición calculada para el usuario técnico Iris (middleware `empresa`) */
    empresaToken: EmpresaPeticion
    /** ¿la petición trajo `X-Empresa-Id`? (entonces la activa debe ser del usuario vinculado) */
    empresaExplicita: boolean
}

export interface Actuacion {
    usuarioId: number
    /** alcance del permiso del usuario vinculado, sin las restricciones del token */
    alcance: Alcance
    /** empresas: las del usuario vinculado ∩ las del token Iris */
    empresa: EmpresaPeticion
}

/**
 * Resuelve el usuario vinculado y su alcance, o lanza `ActorRechazado` con su code. Única puerta
 * de la actuación vinculada; la llama el middleware `actuarComoVinculado`.
 */
export async function resolverActuacionIris(
    entrada: EntradaActuacion,
    cliente: QueryClientContract = db.connection(),
): Promise<Actuacion> {
    if (entrada.actorIris === 'asistente_ia') {
        throw new ActorRechazado(
            'actor_ia_no_permitido',
            `El asistente de IA de Iris no puede ${entrada.permiso}: solo un operador humano con usuario vinculado`,
        )
    }
    await exigirConectorIrisVigente(entrada.tokenApiId, cliente)

    const vinculo = await resolverActorIris(entrada.actorIris, cliente)
    if (!vinculo) {
        throw new ActorRechazado(
            'actor_sin_vinculo',
            `${entrada.actorIris} no tiene una cuenta de Argos vinculada; debe entrar una vez a Argos desde Iris y vincularla`,
        )
    }
    if (!vinculo.activo) {
        throw new ActorRechazado('actor_inactivo', 'El usuario de Argos vinculado está desactivado')
    }

    // su propio permiso: sin las restricciones del token Iris
    const alcance = await alcanceDePermiso(vinculo.usuarioId, entrada.permiso, null)
    if (!alcance) {
        throw new ActorRechazado(
            'actor_sin_permiso',
            `El usuario de Argos vinculado no tiene el permiso ${entrada.permiso}`,
        )
    }

    const propias = await alcanceEmpresasDeUsuario(vinculo.usuarioId, cliente)
    const token = entrada.empresaToken
    const empresas = token.empresas.filter((id) => propias.empresas.includes(id))
    if (empresas.length === 0) {
        throw new ActorRechazado(
            'actor_sin_empresa',
            'El usuario de Argos vinculado no opera ninguna de las empresas del token de Iris',
        )
    }
    let activa: number | null
    if (entrada.empresaExplicita && token.activa !== null) {
        if (!empresas.includes(token.activa)) {
            throw new ActorRechazado(
                'actor_sin_empresa',
                `El usuario de Argos vinculado no opera la empresa ${token.activa}`,
            )
        }
        activa = token.activa
    } else {
        activa = empresas.length === 1 ? empresas[0]! : null
    }
    const alcanceGlobal = token.alcanceGlobal && propias.alcanceGlobal
    return {
        usuarioId: vinculo.usuarioId,
        alcance,
        empresa: {
            activa,
            empresas,
            permitidas: alcanceGlobal ? null : empresas,
            alcanceGlobal,
            accesoTotal: token.accesoTotal && empresas.length === token.empresas.length,
        },
    }
}
