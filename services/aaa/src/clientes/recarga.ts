import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * Aviso de recarga a FreeRADIUS por un FIFO en `clients.d/.recargar` (`freeradius/recargar.sh`).
 *
 * FreeRADIUS 3.2 lee los clientes solo al arrancar (un HUP no los relee). El contenedor de
 * FreeRADIUS corre `recargar.sh`, que tiene el FIFO abierto y, al leer una línea, valida la
 * configuración (`radiusd -C`) y reinicia `radiusd`. Es por evento: nadie sondea ni hay TTL.
 *
 * - El FIFO es un archivo oculto: el `$INCLUDE clients.d/` de FreeRADIUS salta los que empiezan con
 *   punto. Lo crea `aaa` (el volumen es de solo lectura en FreeRADIUS).
 * - Se escribe sin bloquear. Si nadie lo tiene abierto (FreeRADIUS sin `recargar.sh`, o arrancando),
 *   devuelve `sin_lector`: al arrancar, FreeRADIUS ya lee los archivos nuevos.
 */

export const FIFO_RECARGA = '.recargar'

export type ResultadoAviso = 'avisado' | 'sin_lector'

const ejecutar = promisify(execFile)

async function asegurarFifo(ruta: string): Promise<void> {
    const info = await lstat(ruta).catch(() => null)
    if (info?.isFIFO()) return
    if (info) throw new Error(`${ruta} existe y no es un FIFO`)
    await ejecutar('mkfifo', ['-m', '0660', ruta]).catch(async (e: Error) => {
        // Otro nodo o proceso lo creó a la vez.
        if (!(await lstat(ruta).catch(() => null))?.isFIFO()) throw e
    })
}

export async function avisarRecarga(dir: string, motivo: string): Promise<ResultadoAviso> {
    const ruta = join(dir, FIFO_RECARGA)
    await asegurarFifo(ruta)
    let fifo
    try {
        fifo = await open(ruta, constants.O_WRONLY | constants.O_NONBLOCK)
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENXIO') return 'sin_lector'
        throw e
    }
    try {
        // Una línea corta (< PIPE_BUF): la escritura es atómica aunque escriban dos procesos.
        await fifo.write(`${new Date().toISOString()} ${motivo.replace(/[^\w.:-]/g, '_').slice(0, 120)}\n`)
    } catch (e) {
        // FIFO lleno: ya hay avisos sin leer, y uno basta para recargar.
        if ((e as NodeJS.ErrnoException).code !== 'EAGAIN') throw e
    } finally {
        await fifo.close()
    }
    return 'avisado'
}
