import type { Log } from './dispatcher.ts'

const NIVELES = ['debug', 'info', 'warn', 'error', 'silent'] as const
type Nivel = (typeof NIVELES)[number]

/** Log JSON a stdout, una línea por evento. */
export function crearLog(nivel = 'info'): Log {
    const minimo = Math.max(0, NIVELES.indexOf(nivel as Nivel))
    const escribir = (level: Nivel, obj: object, msg: string) => {
        if (NIVELES.indexOf(level) < minimo) return
        console.log(JSON.stringify({ level, time: new Date().toISOString(), servicio: 'coa', ...obj, msg }))
    }
    return {
        info: (obj, msg) => escribir('info', obj, msg),
        warn: (obj, msg) => escribir('warn', obj, msg),
        error: (obj, msg) => escribir('error', obj, msg),
    }
}
