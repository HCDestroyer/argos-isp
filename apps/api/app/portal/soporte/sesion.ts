import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { NoEncontrado, Problema, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirSesionPortal, type SesionPortal } from '#portal/acceso/sesion'
import { empresasDeCliente, verContacto, type ContactoVista, type PermisoContacto } from '#core/contactos'
import type { MetodoSesionIris, SesionIris } from '#portal/soporte/iris_portal'

/**
 * Quién pide y en qué empresa, para las rutas de soporte del portal (contrato Iris 0.9.0 §11.1:
 * «el `cliente_id` de la ruta y `X-Iris-Empresa` salen, en su servidor, de la sesión del portal del
 * cliente; nunca de un dato que mande el navegador»).
 *
 * - **Método** (§11.2): una sesión abierta con código o contraseña es `documento`; la de «Ver mi
 *   cuenta» en `/corte` (origen `corte`, identificada por la IP de una sesión PPPoE vigente o por el
 *   código de corte de un único servicio, nunca por una IP compartida) es `ip`.
 * - **Empresa**: el navegador puede pedir una (`empresa_id`), pero solo vale si es la de algún
 *   servicio vigente del cliente (con sesión `ip`, solo la del servicio de esa sesión). Sin ella, la
 *   del primer servicio.
 */

export interface SesionSoporte {
    sesion: SesionPortal
    clienteId: number
    iris: SesionIris
    /** servicio de la sesión `corte` (sesión `ip`); null con `documento` */
    servicioDeLaSesion: number | null
}

/** 403 `sesion_insuficiente`: la acción exige entrar con código o contraseña (§11.2). */
export class SesionInsuficiente extends Problema {
    constructor() {
        super(
            403,
            'sesion_insuficiente',
            'Entra a tu cuenta',
            'Para esto entra con tu código o tu contraseña: con la página de corte solo puedes abrir un ticket y ver la lista.',
        )
    }
}

export async function sesionSoporte(ctx: HttpContext): Promise<SesionSoporte> {
    const sesion = await exigirSesionPortal(ctx)
    const metodo: MetodoSesionIris = sesion.origen === 'corte' ? 'ip' : 'documento'
    let servicio: number | null = null
    if (metodo === 'ip') {
        const fila = (await db
            .from('core.portal_sesiones')
            .where('id', sesion.id)
            .select('servicio_id')
            .first()) as { servicio_id: number | null } | null
        servicio =
            fila?.servicio_id === null || fila?.servicio_id === undefined ? null : Number(fila.servicio_id)
    }
    return {
        sesion,
        clienteId: sesion.clienteId,
        iris: { metodo, sesionId: sesion.id },
        servicioDeLaSesion: servicio,
    }
}

/** La sesión debe ser `documento` (detalle, mensajes, adjuntos, responder, confirmar, solicitudes). */
export function exigirDocumento(s: SesionSoporte): void {
    if (s.iris.metodo !== 'documento') throw new SesionInsuficiente()
}

async function empresaDelServicio(servicioId: number): Promise<number | null> {
    const fila = (await db.from('core.servicios').where('id', servicioId).select('empresa_id').first()) as {
        empresa_id: number
    } | null
    return fila ? Number(fila.empresa_id) : null
}

/** Empresas del cliente en que puede pedir soporte (con sesión `ip`, solo la de su servicio). */
export async function empresasDeSoporte(s: SesionSoporte): Promise<number[]> {
    if (s.servicioDeLaSesion !== null) {
        const empresa = await empresaDelServicio(s.servicioDeLaSesion)
        return empresa === null ? [] : [empresa]
    }
    return empresasDeCliente(s.clienteId, db.connection())
}

/** Empresa para `X-Iris-Empresa`: la pedida si es una del cliente; si no viene, la primera. */
export async function empresaDeSoporte(s: SesionSoporte, pedida: number | undefined): Promise<number> {
    const empresas = await empresasDeSoporte(s)
    if (empresas.length === 0) {
        throw new ReglaNegocio('Tu cuenta no tiene servicios vigentes para pedir soporte.', 'sin_servicios')
    }
    if (pedida === undefined) return empresas[0]!
    if (!empresas.includes(pedida)) throw new NoEncontrado('No tienes servicios con esa empresa')
    return pedida
}

/**
 * `servicio_id` del cliente (no retirado) en la empresa elegida, o 422 en `servicio_id` (§11.4 y
 * §11.7, `rule: "servicio"`). Con sesión `ip`, solo el servicio de la sesión.
 */
export async function exigirServicioDelCliente(
    s: SesionSoporte,
    servicioId: number,
    empresaId: number,
): Promise<void> {
    const invalido = () =>
        new ValidacionFallida([
            {
                field: 'servicio_id',
                rule: 'servicio',
                message: 'Ese servicio no es de tu cuenta en esta empresa',
            },
        ])
    if (s.servicioDeLaSesion !== null && servicioId !== s.servicioDeLaSesion) throw invalido()
    const fila = await db
        .from('core.servicios')
        .where({ id: servicioId, cliente_id: s.clienteId, empresa_id: empresaId })
        .whereNot('estado', 'retirado')
        .select('id')
        .first()
    if (!fila) throw invalido()
}

// ── «Está a cargo de» (contrato Iris 0.10.1 §3.8, A46) ──────────────────────────────────────

/** 403 `permiso_de_contacto`: el titular no le dio ese permiso (§3.5). */
export class PermisoDeContacto extends Problema {
    constructor(permiso: PermisoContacto) {
        const textos: Record<PermisoContacto, string> = {
            consultar: 'consultar el saldo',
            reportar: 'reportar fallas',
            pagar: 'pagar',
            avisos: 'recibir avisos',
        }
        super(
            403,
            'permiso_de_contacto',
            'Permiso del contacto apagado',
            `El titular de este servicio no te dio permiso para ${textos[permiso]}.`,
        )
    }
}

export interface ServicioACargo {
    contacto: ContactoVista
    /** dueño del servicio (el cliente cuyo contacto es la persona de la sesión) */
    clienteId: number
    servicioId: number
    empresaId: number
}

/**
 * El cliente de la sesión actúa sobre el servicio de otro como su contacto (`persona_cliente_id`):
 * el contacto debe ser vigente y apuntar a él, el servicio debe ser del dueño, no retirado y estar
 * entre los `servicios[]` del contacto (null = todos), y el permiso encendido. Lo que no cuadra
 * responde 404 (sin decir si el contacto o el servicio existen); el permiso apagado, 403
 * `permiso_de_contacto`. Nunca abre lo reservado al titular.
 */
export async function servicioACargo(
    personaClienteId: number,
    contactoId: number,
    servicioId: number,
    permiso: PermisoContacto,
): Promise<ServicioACargo> {
    const ajeno = () => new NoEncontrado('Ese servicio no está a tu cargo')
    const contacto = await verContacto(contactoId).catch(() => null)
    if (!contacto || contacto.persona_cliente_id !== personaClienteId) throw ajeno()
    if (contacto.servicios !== null && !contacto.servicios.includes(servicioId)) throw ajeno()
    const servicio = (await db
        .from('core.servicios')
        .where({ id: servicioId, cliente_id: contacto.cliente_id })
        .whereNot('estado', 'retirado')
        .select('empresa_id')
        .first()) as { empresa_id: number } | null
    if (!servicio) throw ajeno()
    if (!contacto.permisos[permiso]) throw new PermisoDeContacto(permiso)
    return { contacto, clienteId: contacto.cliente_id, servicioId, empresaId: Number(servicio.empresa_id) }
}
