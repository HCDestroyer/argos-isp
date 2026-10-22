import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { CanalNotificacion } from '#shared/eventos'
import { ErrorCanal, type Canal, type EstadoEntrega, type ResultadoEnvio } from '#notify/canales/canal'
import type { ColaEnvios } from '#notify/cola'
import { unico } from '#tests/ayudas'
import { ipUnica } from '#tests/core/fabricas'

/**
 * Datos y dobles de prueba de notify. Los datos de núcleo y facturación se insertan directo
 * porque son fixtures de prueba (las acciones de A1/A3 aún no existen).
 */

/**
 * `pago_id` de los eventos simulados: un id que no existe. Con un id real (p. ej. 1) el resultado
 * depende de qué pruebas corrieron antes: si ese pago salió de un comprobante, `pago.registrado`
 * no avisa al pagador (`avisos_pago.ts`) y la prueba no encuentra el envío.
 */
export const PAGO_SIN_COMPROBANTE = 1_999_999_999

export interface DatosCliente {
    nombre?: string
    email?: string | null
    canal_preferido?: CanalNotificacion
    telegram_chat_id?: string | null
}

export async function crearCliente(datos: DatosCliente = {}): Promise<number> {
    const [fila] = (await db
        .table('core.clientes')
        .insert({
            nombre: datos.nombre ?? unico('Cliente'),
            email: datos.email === undefined ? `${unico('c')}@prueba.local` : datos.email,
            canal_preferido: datos.canal_preferido ?? 'correo',
            telegram_chat_id: datos.telegram_chat_id ?? null,
        })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

/** `empresaId` por defecto es la principal (1): con varias empresas activas el trigger exige una. */
export async function crearServicio(clienteId: number, plan = unico('Plan'), empresaId = 1): Promise<number> {
    const nasIp = ipUnica()
    const [router] = (await db
        .table('network.routers')
        .insert({ nombre: unico('Router'), host: '10.0.0.1', nas_ip: nasIp })
        .returning('id')) as Array<{ id: number }>
    const [planFila] = (await db
        .table('network.planes')
        .insert({ nombre: plan, precio: '150.00', bajada_kbps: 10_000, subida_kbps: 5000 })
        .returning('id')) as Array<{ id: number }>
    const [servicio] = (await db
        .table('core.servicios')
        .insert({
            cliente_id: clienteId,
            router_id: router!.id,
            plan_id: planFila!.id,
            user_ppp: unico('ppp'),
            pass_ppp: 'cifrada',
            empresa_id: empresaId,
        })
        .returning('id')) as Array<{ id: number }>
    return servicio!.id
}

export async function crearFactura(
    clienteId: number,
    servicioId: number,
    datos: { periodo?: string; vence?: string; total?: string; pagado?: string; estado?: string } = {},
): Promise<number> {
    const periodo = datos.periodo ?? '2026-10-01'
    const [fila] = (await db
        .table('billing.facturas')
        .insert({
            cliente_id: clienteId,
            servicio_id: servicioId,
            periodo,
            clave_unica: `${servicioId}-${periodo}-${randomUUID().slice(0, 6)}`,
            vence_en: datos.vence ?? '2026-10-15',
            estado: datos.estado ?? 'emitida',
            subtotal: datos.total ?? '150.00',
            iva: '0.00',
            total: datos.total ?? '150.00',
            pagado: datos.pagado ?? '0.00',
        })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

/** Inserta un evento en `audit.outbox` (como lo haría `t.emit`) y devuelve su id. */
export async function eventoOutbox(evento: string, payload: Record<string, unknown>): Promise<number> {
    const [fila] = (await db
        .table('audit.outbox')
        .insert({ evento, payload: JSON.stringify(payload), request_id: randomUUID() })
        .returning('id')) as Array<{ id: number }>
    return fila!.id
}

export interface MensajeFalso {
    destino: string
    asunto: string | null
    cuerpo: string
}

/** Canal en memoria. `fallar` decide por llamada si lanza (y si el error es permanente). */
export class CanalFalso implements Canal {
    readonly enviados: MensajeFalso[] = []
    llamadas = 0
    fallar: (llamada: number) => { permanente: boolean } | null = () => null

    constructor(readonly nombre: CanalNotificacion) {}

    async enviar(destino: string, asunto: string | null, cuerpo: string): Promise<ResultadoEnvio> {
        this.llamadas++
        const falla = this.fallar(this.llamadas)
        if (falla) throw new ErrorCanal(this.nombre, `falla simulada ${this.llamadas}`, falla.permanente)
        this.enviados.push({ destino, asunto, cuerpo })
        return { id: `${this.nombre}-${this.llamadas}` }
    }

    async estado(): Promise<EstadoEntrega> {
        return 'enviado'
    }
}

/** Cola en memoria: solo registra los ids encolados. */
export class ColaFalsa implements ColaEnvios {
    readonly ids: number[] = []
    async encolar(envioIds: number[]) {
        this.ids.push(...envioIds)
    }
}

/** `fetch` simulado para la Bot API de Telegram. */
export function fetchTelegramFalso(
    responder: (metodo: string, cuerpo: Record<string, unknown>) => { status: number; json: unknown },
) {
    const llamadas: Array<{ url: string; metodo: string; cuerpo: Record<string, unknown> }> = []
    const falso = (async (entrada: string | URL | Request, init?: RequestInit) => {
        const url =
            typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
        const metodo = url.split('/').at(-1) ?? ''
        const texto = typeof init?.body === 'string' ? init.body : '{}'
        const cuerpo = JSON.parse(texto) as Record<string, unknown>
        llamadas.push({ url, metodo, cuerpo })
        const { status, json } = responder(metodo, cuerpo)
        return new Response(JSON.stringify(json), {
            status,
            headers: { 'content-type': 'application/json' },
        })
    }) as typeof fetch
    return { fetch: falso, llamadas }
}

export function respuestaTelegramOk(cuerpo: Record<string, unknown>) {
    return {
        status: 200,
        json: {
            ok: true,
            result: {
                message_id: 42,
                date: 1_760_000_000,
                chat: { id: Number(cuerpo.chat_id), type: 'private' },
                text: cuerpo.text,
            },
        },
    }
}

/** Usuario con rol `contabilidad` (respaldo del correo de los avisos fiscales). Devuelve su correo. */
export async function crearUsuarioContabilidad(
    datos: { alcanceGlobal?: boolean; empresas?: number[]; activo?: boolean } = {},
): Promise<{ id: number; email: string }> {
    const email = `${unico('conta')
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase()}@argos.gt`
    const [usuario] = (await db
        .table('core.usuarios')
        .insert({
            nombre: unico('Contador'),
            email,
            password_hash: 'x',
            activo: datos.activo ?? true,
            alcance_global: datos.alcanceGlobal ?? false,
        })
        .returning('id')) as Array<{ id: number }>
    const rol = (await db.from('core.roles').where('nombre', 'contabilidad').select('id').first()) as {
        id: number
    }
    await db.table('core.usuarios_roles').insert({ usuario_id: usuario!.id, role_id: rol.id })
    for (const empresaId of datos.empresas ?? []) {
        await db.table('core.usuarios_empresas').insert({ usuario_id: usuario!.id, empresa_id: empresaId })
    }
    return { id: Number(usuario!.id), email }
}

/**
 * Desactiva los usuarios activos con rol `contabilidad` que dejaron otras pruebas (para probar el
 * caso "sin destinatario"). Devuelve la función que los reactiva.
 */
export async function apartarUsuariosContabilidad(): Promise<() => Promise<void>> {
    const filas = (await db
        .from('core.usuarios as u')
        .join('core.usuarios_roles as ur', 'ur.usuario_id', 'u.id')
        .join('core.roles as r', 'r.id', 'ur.role_id')
        .where('r.nombre', 'contabilidad')
        .where('u.activo', true)
        .distinct('u.id')) as Array<{ id: number }>
    const ids = filas.map((f) => f.id)
    if (ids.length > 0) await db.from('core.usuarios').whereIn('id', ids).update({ activo: false })
    return async () => {
        if (ids.length > 0) await db.from('core.usuarios').whereIn('id', ids).update({ activo: true })
    }
}
