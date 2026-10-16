import { interpolate, useCurrentFrame } from 'remotion'
import type { Camara, Clave, Colocacion } from '../camara/camara'
import { animarCamara, deriva, sumarCamaras } from '../camara/camara'
import { CAPTURAS, type EscenaCalculada, FPS, type IdCaptura } from '../guion'

export interface PropsEscena {
    escena: EscenaCalculada
}

/** Frame local y conversor de momentos del guion a frames. */
export function useEscena(escena: EscenaCalculada) {
    const frame = useCurrentFrame()
    const m = (nombre: string) => {
        const segundos = escena.momentos[nombre]
        if (segundos === undefined) throw new Error(`La escena "${escena.id}" no tiene el momento "${nombre}"`)
        return Math.round(segundos * FPS)
    }
    const texto = (clave: string) => escena.textos[clave] ?? ''
    return { frame, m, texto, fin: escena.frames }
}

/** Coloca una captura del guion en el mundo. */
export function colocar(id: IdCaptura, pose: Partial<Omit<Colocacion, 'ancho' | 'alto'>> = {}): Colocacion {
    const captura = CAPTURAS[id]
    return { x: 0, y: 0, z: 0, ry: 0, escala: 1, ...pose, ancho: captura.ancho, alto: captura.alto }
}

/**
 * Cámara final de una escena: claves interpoladas, seguimiento de un objetivo
 * dinámico (normalmente el cursor) y una deriva sutil "a mano".
 */
export function camaraDeEscena(
    frame: number,
    claves: Clave[],
    objetivo?: { x: number; y: number },
    amplitudDeriva = 1
): Camara {
    const { cam, seguir } = animarCamara(frame, claves)
    const seguida =
        objetivo && seguir > 0
            ? { ...cam, x: cam.x + (objetivo.x - cam.x) * seguir, y: cam.y + (objetivo.y - cam.y) * seguir }
            : cam
    return sumarCamaras(seguida, deriva(frame, amplitudDeriva))
}

/** Opacidad 0..1 entre dos frames, con rampas de `rampa` frames. */
export function ventana(frame: number, desde: number, hasta: number, rampa = 8): number {
    return interpolate(frame, [desde, desde + rampa, hasta, hasta + rampa], [0, 1, 1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    })
}

/** Fundido de una capa de captura a otra en `en` frames. */
export function cruce(frame: number, en: number, duracion = 8): number {
    return interpolate(frame, [en, en + duracion], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
}
