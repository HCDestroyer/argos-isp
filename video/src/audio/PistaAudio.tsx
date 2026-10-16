import { Html5Audio, Sequence, interpolate, staticFile } from 'remotion'
import { DURACION_TOTAL, FPS, FRAMES_TRANSICION, LINEA_DE_TIEMPO, type NombreSonido, frameDeEfecto } from '../guion'

/** Volumen base de la música (antes del ducking). */
const VOLUMEN_MUSICA = 0.5

const VOLUMEN_EFECTO: Record<NombreSonido, number> = {
    whoosh: 0.55,
    clic: 0.6,
    confirmacion: 0.6,
    corte: 0.65,
    neon: 0.75,
}

/**
 * Valor de una propiedad numérica de la escena en un frame global, mezclando
 * linealmente durante los solapamientos entre escenas.
 */
export function valorPorEscena(frame: number, leer: (escena: (typeof LINEA_DE_TIEMPO)[number]) => number): number {
    for (let i = 0; i < LINEA_DE_TIEMPO.length; i++) {
        const actual = LINEA_DE_TIEMPO[i]
        const siguiente = LINEA_DE_TIEMPO[i + 1]
        if (siguiente && frame >= siguiente.desde && frame < actual.desde + actual.frames) {
            const p = (frame - siguiente.desde) / FRAMES_TRANSICION
            return leer(actual) + (leer(siguiente) - leer(actual)) * p
        }
        if (frame < actual.desde + actual.frames) return leer(actual)
    }
    return leer(LINEA_DE_TIEMPO[LINEA_DE_TIEMPO.length - 1])
}

/**
 * Volumen de la música con ducking: cada escena declara su nivel en el guion
 * (más bajo cuando hay texto o explicación). El cambio se suaviza con una
 * rampa de ~0.8 s para que no se note el escalón.
 */
export function volumenMusica(frame: number): number {
    const rampa = Math.round(0.8 * FPS)
    let suma = 0
    for (let k = -rampa; k <= rampa; k += 3) {
        suma += valorPorEscena(Math.max(0, Math.min(DURACION_TOTAL - 1, frame + k)), (e) => e.musica)
    }
    const nivel = suma / (Math.floor((2 * rampa) / 3) + 1)
    // Fundido final extra por si se reemplaza la pista por una sin fade-out.
    const final = interpolate(frame, [DURACION_TOTAL - 45, DURACION_TOTAL - 1], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    })
    return VOLUMEN_MUSICA * nivel * final
}

/** Música de fondo + efectos sincronizados con los momentos del guion. */
export function PistaAudio({ conMusica = true }: { conMusica?: boolean }) {
    return (
        <>
            {conMusica ? <Html5Audio src={staticFile('audio/musica.wav')} volume={volumenMusica} /> : null}
            {LINEA_DE_TIEMPO.flatMap((escena) =>
                escena.efectos.map((efecto, i) => {
                    const desde = escena.desde + frameDeEfecto(escena, efecto)
                    return (
                        <Sequence key={`${escena.id}-${i}`} from={desde} durationInFrames={Math.round(3 * FPS)} layout="none">
                            <Html5Audio
                                src={staticFile(`audio/${efecto.sonido}.wav`)}
                                volume={VOLUMEN_EFECTO[efecto.sonido] * (efecto.volumen ?? 1)}
                            />
                        </Sequence>
                    )
                })
            )}
        </>
    )
}
