import { interpolate } from 'remotion'
import { filtroNeon, mezclarConBlanco } from '../estilo/neon'
import { conAlfa } from '../estilo/tema'

/** Íconos genéricos en trazos (viewBox 100×100), dibujables con stroke-dashoffset. */
export const ICONOS = {
    /** Servidor RADIUS: tres unidades apiladas con luces. */
    servidor: [
        'M22 18 H78 A6 6 0 0 1 84 24 V36 A6 6 0 0 1 78 42 H22 A6 6 0 0 1 16 36 V24 A6 6 0 0 1 22 18 Z',
        'M22 46 H78 A6 6 0 0 1 84 52 V64 A6 6 0 0 1 78 70 H22 A6 6 0 0 1 16 64 V52 A6 6 0 0 1 22 46 Z',
        'M30 74 H70',
        'M50 70 V82',
        'M28 30 H44',
        'M28 58 H44',
        'M70 30 h0.01',
        'M70 58 h0.01',
    ],
    /** Router con dos antenas. */
    router: [
        'M14 56 H86 A6 6 0 0 1 92 62 V74 A6 6 0 0 1 86 80 H14 A6 6 0 0 1 8 74 V62 A6 6 0 0 1 14 56 Z',
        'M28 56 L22 26',
        'M72 56 L78 26',
        'M22 68 h0.01',
        'M34 68 h0.01',
        'M46 68 h0.01',
        'M64 68 H80',
        'M36 34 A20 20 0 0 1 64 34',
        'M42 42 A11 11 0 0 1 58 42',
    ],
    /** Avión de papel (mensajería). */
    mensaje: ['M10 48 L88 16 L72 84 L48 62 Z', 'M48 62 L88 16', 'M48 62 L44 82 L56 70'],
    /** Base de datos con flecha circular (respaldos). */
    respaldo: [
        'M18 24 A26 9 0 0 0 70 24 A26 9 0 0 0 18 24 Z',
        'M18 24 V66 A26 9 0 0 0 52 74',
        'M70 24 V44',
        'M18 45 A26 9 0 0 0 56 52',
        'M62 74 A14 14 0 1 0 64 56',
        'M64 48 V57 H73',
    ],
    /** Pantalla con pulso (monitoreo). */
    monitoreo: [
        'M14 18 H86 A6 6 0 0 1 92 24 V66 A6 6 0 0 1 86 72 H14 A6 6 0 0 1 8 66 V24 A6 6 0 0 1 14 18 Z',
        'M18 48 H34 L40 34 L50 60 L58 40 L64 48 H82',
        'M38 86 H62',
        'M50 72 V86',
    ],
} as const

export type NombreIcono = keyof typeof ICONOS

export function IconoNeon({
    nombre,
    tamano = 120,
    color,
    trazo = 1,
    brillo = 1,
}: {
    nombre: NombreIcono
    tamano?: number
    color: string
    trazo?: number
    brillo?: number
}) {
    const caminos = ICONOS[nombre]
    return (
        <svg
            width={tamano}
            height={tamano}
            viewBox="0 0 100 100"
            fill="none"
            style={{ overflow: 'visible', filter: brillo > 0.05 ? filtroNeon(color, brillo, tamano / 160) : undefined }}
        >
            {caminos.map((d, i) => {
                const inicio = (i / caminos.length) * 0.5
                const p = interpolate(trazo, [inicio, inicio + 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
                if (p <= 0) return null
                return (
                    <path
                        key={i}
                        d={d}
                        stroke={brillo < 0.2 ? conAlfa(color, 0.3) : mezclarConBlanco(color, 0.3)}
                        strokeWidth={5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pathLength={1}
                        strokeDasharray={1}
                        strokeDashoffset={1 - p}
                    />
                )
            })}
        </svg>
    )
}
