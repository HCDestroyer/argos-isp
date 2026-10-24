import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { registrarContactoRouter, type FuenteContacto } from '#network/contacto_router'

/**
 * Alimenta el contacto de los routers (`network.routers_contacto`, `Router.en_linea`; fila 70 de
 * `.claude/integration/a1.md`) desde las fuentes de A2:
 *
 * - **accounting**: Start, Interim-Update, Stop y Accounting-On/Off de cada NAS
 *   (`IniciarSesion`, `ActualizarSesion`, `TerminarSesion`, `CerrarSesionesNas`), en su transacción.
 *   `aaa` no escribe en Postgres: solo encola el paquete con su `nas_ip`; lo anota el worker.
 * - **routeros**: cada respuesta 2xx de la API REST del router (`ClienteRouterOS`, opción `contacto`).
 * - **sondeo**: el cron `sondear` del worker de RouterOS, para routers sin accounting reciente.
 *
 * Escrituras de más: un NAS con 2 000 sesiones manda ~7 Interim-Update por segundo. Cada proceso
 * escribe un mismo router a lo sumo una vez cada `ROUTERS_CONTACTO_MINIMO_S` (60 s por defecto);
 * el resto ni llega a Postgres. No es una caché de datos (regla 5): no se lee nada de aquí, solo
 * evita repetir una escritura cuyo efecto sería el mismo. El error que agrega (≤ 60 s) es chico
 * frente al umbral de `en_linea` (15 min). `registrarContactoRouter` tiene además su propio filtro
 * de 30 s en SQL, que cubre a varios procesos a la vez.
 */

const ultimas = new Map<string, number>()

export function contactoMinimoS(): number {
    return Math.max(0, env.get('ROUTERS_CONTACTO_MINIMO_S') ?? 60)
}

/** Solo pruebas: olvida lo anotado por este proceso. */
export function reiniciarContactos(): void {
    ultimas.clear()
}

/**
 * Anota el contacto si este proceso no lo hizo hace menos de `contactoMinimoS()`. `en` se recorta a
 * ahora: un NAS con el reloj adelantado no puede dejar un router «en línea» hacia el futuro.
 * Devuelve true si escribió.
 */
export async function anotarContacto(
    cliente: QueryClientContract,
    router: { routerId: number } | { nasIp: string },
    fuente: FuenteContacto,
    en: Date = new Date(),
    opciones: { forzar?: boolean } = {},
): Promise<boolean> {
    const clave = 'routerId' in router ? `id:${router.routerId}` : `nas:${router.nasIp}`
    const ahora = Date.now()
    const ultima = ultimas.get(clave)
    if (!opciones.forzar && ultima !== undefined && ahora - ultima < contactoMinimoS() * 1000) return false
    ultimas.set(clave, ahora)
    const instante = Number.isNaN(en.getTime()) || en.getTime() > ahora ? new Date(ahora) : en
    await registrarContactoRouter(cliente, router, fuente, instante)
    return true
}

/** Contacto de un paquete de accounting, dentro de la transacción de su acción. */
export function anotarAccounting(
    cliente: QueryClientContract,
    registro: { nas_ip: string; evento_en: string; tipo?: string },
): Promise<boolean> {
    // Accounting-On/Off es raro y marca un reinicio del NAS: se anota siempre.
    const forzar = registro.tipo === 'Accounting-On' || registro.tipo === 'Accounting-Off'
    return anotarContacto(cliente, { nasIp: registro.nas_ip }, 'accounting', new Date(registro.evento_en), {
        forzar,
    })
}

/**
 * Para `ClienteRouterOS` (respuesta 2xx de la API REST): fuera de la transacción de la acción,
 * como `audit.red` (el router respondió aunque la acción se revierta). Nunca lanza.
 */
export async function contactoRouterOS(routerId: number): Promise<void> {
    try {
        await anotarContacto(db.connection(), { routerId }, 'routeros')
    } catch (error) {
        logger.warn({ err: error, router_id: routerId }, 'no se pudo anotar el contacto del router')
    }
}
