import type { ReactNode } from 'react'
import { Easing, interpolate } from 'remotion'
import type { PuntoInteres } from '../guion'
import { encendido, filtroNeon } from '../estilo/neon'
import { COLOR, FUENTE, conAlfa } from '../estilo/tema'

/**
 * Cursor, halos y etiquetas que viven en el plano de una captura (sus
 * coordenadas son px lógicos de la captura), así que se mueven con ella en 3D.
 */

export interface PasoCursor {
    /** Frame de la escena en el que el cursor llega al punto. */
    t: number
    x: number
    y: number
    /** Si es true, al llegar hace clic y emite un pulso. */
    clic?: boolean
}

const VIAJE = Easing.bezier(0.45, 0, 0.2, 1)

/** Posición del cursor en un frame (interpola entre pasos con aceleración suave). */
export function posicionCursor(ruta: PasoCursor[], frame: number): { x: number; y: number } {
    if (ruta.length === 0) return { x: 0, y: 0 }
    if (frame <= ruta[0].t) return { x: ruta[0].x, y: ruta[0].y }
    for (let i = 1; i < ruta.length; i++) {
        const a = ruta[i - 1]
        const b = ruta[i]
        if (frame <= b.t) {
            // El cursor espera unos frames tras un clic y luego viaja.
            const salida = Math.min(b.t - 1, a.t + (a.clic ? 6 : 0))
            const p = VIAJE(interpolate(frame, [salida, b.t], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))
            return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p }
        }
    }
    const ultimo = ruta[ruta.length - 1]
    return { x: ultimo.x, y: ultimo.y }
}

/** Paso de cursor a partir de un punto de interés. */
export function paso(t: number, punto: PuntoInteres, clic = false, desvio = { x: 0, y: 0 }): PasoCursor {
    return { t, x: punto.x + desvio.x, y: punto.y + desvio.y, clic }
}

export function CursorNeon({
    ruta,
    frame,
    variante = 'flecha',
    escala = 1,
    color = COLOR.cian,
    colorPulso = COLOR.magenta,
    hasta,
}: {
    ruta: PasoCursor[]
    frame: number
    variante?: 'flecha' | 'dedo'
    escala?: number
    color?: string
    colorPulso?: string
    /** Frame a partir del cual el cursor se desvanece. */
    hasta?: number
}) {
    if (ruta.length === 0) return null
    const { x, y } = posicionCursor(ruta, frame)
    const aparicion = interpolate(frame, [ruta[0].t - 12, ruta[0].t], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    })
    const desaparicion =
        hasta === undefined ? 1 : interpolate(frame, [hasta, hasta + 10], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const opacidad = aparicion * desaparicion
    if (opacidad <= 0) return null

    const clics = ruta.filter((p) => p.clic)
    // Presión del clic: el cursor se encoge un instante.
    const presion = clics.reduce((acc, p) => {
        const d = frame - p.t
        return d >= 0 && d < 6 ? Math.min(acc, interpolate(d, [0, 2, 6], [1, 0.82, 1])) : acc
    }, 1)

    return (
        <>
            {clics.map((p) => (
                <Pulso key={`${p.t}-${p.x}-${p.y}`} x={p.x} y={p.y} desde={p.t} frame={frame} escala={escala} color={colorPulso} />
            ))}
            <div
                style={{
                    position: 'absolute',
                    left: x,
                    top: y,
                    width: 0,
                    height: 0,
                    opacity: opacidad,
                    transform: `scale(${escala * presion})`,
                    zIndex: 10,
                }}
            >
                {variante === 'flecha' ? (
                    <svg
                        width={34}
                        height={40}
                        viewBox="0 0 34 40"
                        style={{ position: 'absolute', left: -3, top: -2, overflow: 'visible', filter: filtroNeon(color, 0.9, 0.8) }}
                    >
                        <path
                            d="M3 2 L3 30 L10.5 23.5 L16 36 L21 33.8 L15.6 21.6 L25.5 21.2 Z"
                            fill={conAlfa(COLOR.fondo, 0.85)}
                            stroke={color}
                            strokeWidth={2.4}
                            strokeLinejoin="round"
                        />
                    </svg>
                ) : (
                    <div
                        style={{
                            position: 'absolute',
                            left: -22,
                            top: -22,
                            width: 44,
                            height: 44,
                            borderRadius: '50%',
                            border: `3px solid ${color}`,
                            background: conAlfa(color, 0.16),
                            boxShadow: `0 0 10px ${conAlfa(color, 0.8)}, 0 0 26px ${conAlfa(color, 0.4)}`,
                        }}
                    />
                )}
            </div>
        </>
    )
}

function Pulso({
    x,
    y,
    desde,
    frame,
    escala,
    color,
}: {
    x: number
    y: number
    desde: number
    frame: number
    escala: number
    color: string
}) {
    const d = frame - desde
    if (d < 0 || d > 22) return null
    const radio = interpolate(d, [0, 22], [6, 46], { easing: Easing.out(Easing.cubic) }) * escala
    const opacidad = interpolate(d, [0, 4, 22], [0, 0.95, 0])
    return (
        <div
            style={{
                position: 'absolute',
                left: x - radio,
                top: y - radio,
                width: radio * 2,
                height: radio * 2,
                borderRadius: '50%',
                border: `${2.5 * escala}px solid ${color}`,
                opacity: opacidad,
                boxShadow: `0 0 12px ${conAlfa(color, 0.8)}, inset 0 0 10px ${conAlfa(color, 0.5)}`,
                zIndex: 9,
            }}
        />
    )
}

/** Halo neón alrededor de un elemento de la captura. */
export function Halo({
    punto,
    frame,
    desde,
    hasta,
    color = COLOR.cian,
    margen = 7,
    radio = 10,
    semilla = 'halo',
}: {
    punto: PuntoInteres
    frame: number
    desde: number
    hasta?: number
    color?: string
    margen?: number
    radio?: number
    semilla?: string
}) {
    const brillo = encendido(frame, desde, `${semilla}-${desde}`, 10)
    const apagado =
        hasta === undefined ? 1 : interpolate(frame, [hasta, hasta + 10], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const intensidad = brillo * apagado
    if (intensidad <= 0) return null
    const ancho = (punto.ancho ?? 44) + margen * 2
    const alto = (punto.alto ?? 44) + margen * 2
    const esCirculo = punto.ancho === undefined
    return (
        <div
            style={{
                position: 'absolute',
                left: punto.x - ancho / 2,
                top: punto.y - alto / 2,
                width: ancho,
                height: alto,
                borderRadius: esCirculo ? '50%' : radio,
                border: `2.5px solid ${color}`,
                opacity: intensidad,
                boxShadow: [
                    `0 0 6px ${conAlfa(color, 0.9)}`,
                    `0 0 18px ${conAlfa(color, 0.45)}`,
                    `inset 0 0 8px ${conAlfa(color, 0.35)}`,
                ].join(', '),
                zIndex: 8,
            }}
        />
    )
}

export type Lado = 'arriba' | 'abajo' | 'izquierda' | 'derecha'

/** Etiqueta con borde neón y una línea que apunta al elemento. */
export function EtiquetaNeon({
    punto,
    frame,
    desde,
    hasta,
    lado = 'abajo',
    distancia = 56,
    color = COLOR.cian,
    tamano = 20,
    children,
}: {
    punto: PuntoInteres
    frame: number
    desde: number
    hasta?: number
    lado?: Lado
    distancia?: number
    color?: string
    tamano?: number
    children: ReactNode
}) {
    const entrada = interpolate(frame, [desde, desde + 12], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.out(Easing.cubic),
    })
    const salida =
        hasta === undefined ? 1 : interpolate(frame, [hasta, hasta + 10], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const opacidad = entrada * salida
    if (opacidad <= 0) return null

    const mitadAncho = (punto.ancho ?? 40) / 2
    const mitadAlto = (punto.alto ?? 40) / 2
    const ancla = {
        arriba: { x: punto.x, y: punto.y - mitadAlto - 8 },
        abajo: { x: punto.x, y: punto.y + mitadAlto + 8 },
        izquierda: { x: punto.x - mitadAncho - 8, y: punto.y },
        derecha: { x: punto.x + mitadAncho + 8, y: punto.y },
    }[lado]
    const vector = { arriba: [0, -1], abajo: [0, 1], izquierda: [-1, 0], derecha: [1, 0] }[lado]
    const largo = distancia * entrada
    const fin = { x: ancla.x + vector[0] * largo, y: ancla.y + vector[1] * largo }
    const traslado = {
        arriba: 'translate(-50%, -100%)',
        abajo: 'translate(-50%, 0)',
        izquierda: 'translate(-100%, -50%)',
        derecha: 'translate(0, -50%)',
    }[lado]

    return (
        <div style={{ position: 'absolute', left: 0, top: 0, opacity: opacidad, zIndex: 11 }}>
            <svg
                style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', filter: filtroNeon(color, 0.8, 0.6) }}
                width={1}
                height={1}
            >
                <line x1={ancla.x} y1={ancla.y} x2={fin.x} y2={fin.y} stroke={color} strokeWidth={2} strokeLinecap="round" />
                <circle cx={ancla.x} cy={ancla.y} r={3.5} fill={color} />
            </svg>
            <div
                style={{
                    position: 'absolute',
                    left: fin.x,
                    top: fin.y,
                    transform: traslado,
                    whiteSpace: 'nowrap',
                    padding: `${tamano * 0.45}px ${tamano * 0.8}px`,
                    borderRadius: tamano * 0.6,
                    border: `1.5px solid ${color}`,
                    background: conAlfa(COLOR.fondo, 0.88),
                    boxShadow: `0 0 10px ${conAlfa(color, 0.55)}, 0 10px 30px rgba(0,0,0,0.5)`,
                    color: COLOR.texto,
                    fontFamily: FUENTE.cuerpo,
                    fontWeight: 600,
                    fontSize: tamano,
                    letterSpacing: '0.01em',
                }}
            >
                {children}
            </div>
        </div>
    )
}
