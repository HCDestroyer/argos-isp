import type { Problem, Schema } from '@argosisp/contracts'

/**
 * Eliminar sin historial (`contratos/eliminar.md`): los `motivos[]` de `GET …/eliminable` (o los
 * `errors[]` del 422) en una frase: «tiene 3 facturas y 12 sesiones PPPoE».
 */
export function frasesMotivos(motivos: Pick<Schema<'MotivoEliminacion'>, 'mensaje'>[]): string {
    const mensajes = motivos.map(m => m.mensaje.trim()).filter(Boolean)
    if (mensajes.length <= 1) {
        return mensajes[0] ?? ''
    }
    return `${mensajes.slice(0, -1).join(', ')} y ${mensajes.at(-1)!.replace(/^tiene /, '')}`
}

/** «No se puede eliminar: tiene 3 facturas. Puedes retirarlo.» (o «desactivarlo» un router). */
export function textoNoEliminable(tipo: 'servicio' | 'router', motivos: Pick<Schema<'MotivoEliminacion'>, 'mensaje'>[], yaRetirado = false): string {
    const alternativa = yaRetirado
        ? (tipo === 'servicio' ? 'Ya está retirado: lo encuentras en «Retirados».' : 'Ya está inactivo: lo encuentras en «Inactivos».')
        : (tipo === 'servicio' ? 'Puedes retirarlo.' : 'Puedes desactivarlo.')
    const frase = frasesMotivos(motivos)
    return frase ? `No se puede eliminar: ${frase}. ${alternativa}` : `No se puede eliminar. ${alternativa}`
}

/** Los motivos de un 422 `servicio_con_historial` / `router_con_historial` (`errors[]`). */
export function motivosDeProblema(problema: Problem): { mensaje: string }[] {
    return (problema.errors ?? []).map(error => ({ mensaje: error.message }))
}
