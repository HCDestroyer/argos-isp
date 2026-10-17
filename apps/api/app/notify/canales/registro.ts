import type { CanalNotificacion } from '#shared/eventos'
import type { Canal } from '#notify/canales/canal'
import {
    configPara,
    configParaSync,
    disponibilidad,
    quitarSustitutos,
    sustituirCanal,
    type Disponibilidad,
    type UsoCanal,
} from '#notify/configuracion'

/**
 * Canales disponibles según la configuración del panel (`notify/configuracion.ts`): global o de
 * la empresa, con sus interruptores. Sin configuración guardada, el entorno (`SMTP_HOST`,
 * `TELEGRAM_BOT_TOKEN`). WhatsApp aún no tiene adaptador.
 *
 * Las pruebas reemplazan el transporte con `registrarCanal` (los interruptores siguen aplicando)
 * y lo devuelven a la configuración con `reiniciarCanales`.
 */

/** Canal listo para usar con la configuración de `empresaId` (o la global), o por qué no lo hay. */
export async function resolverCanal(
    nombre: CanalNotificacion,
    opciones: { empresaId?: number | null; uso?: UsoCanal } = {},
): Promise<Disponibilidad> {
    return disponibilidad(await configPara(opciones.empresaId), nombre, opciones.uso)
}

/** Canal encendido y configurado para avisos a clientes, o `undefined`. */
export async function obtenerCanalPara(
    nombre: CanalNotificacion,
    empresaId?: number | null,
): Promise<Canal | undefined> {
    const resuelto = await resolverCanal(nombre, { empresaId })
    return resuelto.canal ?? undefined
}

/**
 * Versión síncrona con la última configuración cargada en el proceso (la global). Para el código
 * que no puede esperar; lo nuevo debe usar `resolverCanal`.
 */
export function obtenerCanal(nombre: CanalNotificacion): Canal | undefined {
    return disponibilidad(configParaSync(null), nombre).canal ?? undefined
}

/** El canal está configurado y encendido para avisos a clientes (configuración global). */
export function canalDisponible(nombre: CanalNotificacion): boolean {
    return obtenerCanal(nombre) !== undefined
}

/** Reemplaza (o quita, con `null`) el transporte de un canal. Para pruebas. */
export function registrarCanal(nombre: CanalNotificacion, canal: Canal | null) {
    sustituirCanal(nombre, canal)
}

/** Vuelve a usar los transportes de la configuración. */
export function reiniciarCanales() {
    quitarSustitutos()
}
