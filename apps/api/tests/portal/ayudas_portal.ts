import db from '@adonisjs/lucid/services/db'
import type { ApiResponse } from '@japa/api-client'
import { unico } from '#tests/ayudas'
import type { CanalCodigo, EnviadorCodigo, MensajeCodigo } from '#portal/acceso/envio_codigo'
import { generarToken, hashToken } from '#portal/acceso/codigos'

/**
 * Datos de prueba del portal: cliente, servicio con facturas y sesiones de red.
 * Insertan directo en las tablas porque las acciones de A1/A3 que los crean no son del portal.
 */

let contador = 0

export interface OpcionesServicio {
    estado?: string
    nombre?: string
    promesa?: boolean
    /** NIT ya normalizado (sin guion); por defecto `1234567-8` compartido (no identifica a nadie) */
    nit?: string
    /** `null` para un cliente sin correo */
    email?: string | null
    telegram?: string | null
    canal?: 'correo' | 'telegram' | 'whatsapp'
}

/** NIT guatemalteco válido y aleatorio (cuerpo de 8 dígitos + verificador módulo 11). */
export function nitAleatorio(): string {
    const cuerpo = String(10_000_000 + Math.floor(Math.random() * 89_999_999))
    let factor = cuerpo.length + 1
    let total = 0
    for (const caracter of cuerpo) {
        total += Number(caracter) * factor
        factor -= 1
    }
    const modulo = (11 - (total % 11)) % 11
    return `${cuerpo}${modulo === 10 ? 'K' : modulo}`
}

/** Cliente + servicio con facturas: adeudado 399.75, vencidas 2 por 299.75. */
export async function crearServicio(opciones: OpcionesServicio = {}) {
    contador += 1
    const sufijo = unico('portal')
    const [router] = await db
        .table('network.routers')
        .insert({ nombre: `router-${sufijo}`, host: 'lab', nas_ip: `192.0.2.${100 + contador}` })
        .returning('id')
    const [plan] = await db
        .table('network.planes')
        .insert({ nombre: `plan-${sufijo}`, precio: '150.00', bajada_kbps: 20000, subida_kbps: 5000 })
        .returning('id')
    const [cliente] = await db
        .table('core.clientes')
        .insert({
            nombre: opciones.nombre ?? 'María José García López',
            email: opciones.email === undefined ? 'maria@example.com' : opciones.email,
            telefono: '5555-1234',
            nit_cui: opciones.nit ?? '1234567-8',
            telegram_chat_id: opciones.telegram ?? null,
            canal_preferido: opciones.canal ?? 'correo',
            direccion: '5a avenida 10-20 zona 1',
        })
        .returning('id')
    const [servicio] = await db
        .table('core.servicios')
        .insert({
            cliente_id: cliente.id,
            router_id: router.id,
            plan_id: plan.id,
            estado: opciones.estado ?? 'suspendido',
            user_ppp: `ppp-${sufijo}`,
            pass_ppp: 'cifrado',
        })
        .returning('id')

    const factura = (periodo: string, vence: string, est: string, total: string, pagado = '0.00') => ({
        cliente_id: cliente.id,
        servicio_id: servicio.id,
        periodo,
        clave_unica: `${servicio.id}-${periodo}`,
        vence_en: vence,
        estado: est,
        subtotal: total,
        iva: '0.00',
        total,
        pagado,
    })
    await db.table('billing.facturas').multiInsert([
        factura('2026-07-01', '2026-07-10', 'vencida', '150.00'),
        // parcial ya pasada su fecha aunque el cron aún no la marque vencida
        factura('2026-08-01', '2026-08-10', 'parcial', '200.00', '50.25'),
        factura('2099-01-01', '2099-01-10', 'emitida', '100.00'),
        factura('2026-06-01', '2026-06-10', 'pagada', '150.00', '150.00'),
        factura('2026-05-01', '2026-05-10', 'anulada', '999.00'),
    ])
    if (opciones.promesa) {
        await db.table('billing.promesas').insert({
            servicio_id: servicio.id,
            cliente_id: cliente.id,
            vence_en: '2099-01-01T00:00:00Z',
            monto: '100.00',
            canal: 'portal',
        })
    }
    return {
        servicioId: Number(servicio.id),
        clienteId: Number(cliente.id),
        routerId: Number(router.id),
        sufijo,
        userPpp: `ppp-${sufijo}`,
    }
}

export async function crearSesion(
    s: { servicioId: number; routerId: number; sufijo: string },
    datos: { ipv4?: string; enlace?: string; delegado?: string; fin?: string },
) {
    await db.table('network.sesiones').insert({
        servicio_id: s.servicioId,
        router_id: s.routerId,
        nas_ip: '192.0.2.1',
        acct_session_id: unico('acct'),
        user_ppp: `ppp-${s.sufijo}`,
        ipv4: datos.ipv4 ?? null,
        prefijo_enlace_v6: datos.enlace ?? null,
        prefijo_delegado_v6: datos.delegado ?? null,
        fin: datos.fin ?? null,
    })
}

/** Enviador de códigos falso: guarda los mensajes en lugar de mandarlos. */
export class EnviadorFalso implements EnviadorCodigo {
    mensajes: MensajeCodigo[] = []
    fallar = false

    constructor(public canales: CanalCodigo[] = ['correo', 'telegram']) {}

    disponibles(): CanalCodigo[] {
        return this.canales
    }

    async enviar(mensaje: MensajeCodigo): Promise<void> {
        if (this.fallar) throw new Error('SMTP caído (prueba)')
        this.mensajes.push(mensaje)
    }

    /** Código de 6 dígitos del último mensaje. */
    ultimoCodigo(): string {
        const ultimo = this.mensajes.at(-1)
        const codigo = ultimo ? /\b(\d{6})\b/.exec(ultimo.cuerpo)?.[1] : undefined
        if (!codigo) throw new Error('No se envió ningún código')
        return codigo
    }
}

/** `argos_portal=<token>` de las cabeceras `Set-Cookie` de una respuesta. */
export function cookieDeSesion(respuesta: ApiResponse): string | null {
    const cabecera = respuesta.headers()['set-cookie'] as string | string[] | undefined
    const lista = Array.isArray(cabecera) ? cabecera : cabecera ? [cabecera] : []
    const cookie = lista.find((c) => c.startsWith('argos_portal='))
    if (!cookie) return null
    const valor = cookie.split(';')[0]!
    return valor === 'argos_portal=' ? null : valor
}

/**
 * Sesión del portal creada directo en la tabla (sin pasar por el código): para pruebas que solo
 * necesitan estar dentro. Devuelve la cookie `argos_portal=<token>` y el id de la sesión.
 */
export async function sesionDirecta(clienteId: number): Promise<{ cookie: string; sesionId: number }> {
    const token = generarToken()
    const [fila] = await db
        .table('core.portal_sesiones')
        .insert({
            cliente_id: clienteId,
            token_hash: hashToken(token),
            expira_en: db.raw("now() + interval '30 minutes'"),
            expira_max_en: db.raw("now() + interval '4 hours'"),
        })
        .returning('id')
    return { cookie: `argos_portal=${token}`, sesionId: Number(fila.id) }
}
