import { AbsoluteFill, Easing, interpolate } from 'remotion'
import { TextoNeon, encendido } from '../estilo/neon'
import { COLOR, FUENTE, conAlfa } from '../estilo/tema'

/**
 * Título de sección (neón) arriba a la izquierda, sobre un velo oscuro para
 * que se lea encima de cualquier captura.
 */
export function TituloSeccion({
    seccion,
    titulo,
    frame,
    desde = 6,
    hasta,
    color = COLOR.cian,
}: {
    seccion: string
    titulo: string
    frame: number
    desde?: number
    hasta?: number
    color?: string
}) {
    const brillo = encendido(frame, desde + 4, `titulo-${seccion}`, 12)
    const entrada = interpolate(frame, [desde, desde + 14], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.out(Easing.cubic),
    })
    const salida =
        hasta === undefined ? 1 : interpolate(frame, [hasta, hasta + 12], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const opacidad = entrada * salida
    return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    right: 0,
                    height: 330,
                    opacity: opacidad,
                    background: `linear-gradient(180deg, ${conAlfa(COLOR.fondo, 0.97)} 0%, ${conAlfa(COLOR.fondo, 0.9)} 55%, ${conAlfa(COLOR.fondo, 0)} 100%)`,
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    left: 96,
                    top: 64,
                    opacity: opacidad,
                    transform: `translateX(${(1 - entrada) * -30}px)`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                }}
            >
                <span
                    style={{
                        fontFamily: FUENTE.mono,
                        fontSize: 22,
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                        color: COLOR.violeta,
                    }}
                >
                    {seccion}
                </span>
                <TextoNeon color={color} intensidad={brillo * 0.85} tamano={62} peso={600}>
                    {titulo}
                </TextoNeon>
            </div>
        </AbsoluteFill>
    )
}

/** Leyenda limpia (sin neón) abajo a la izquierda. */
export function Leyenda({
    texto,
    frame,
    desde,
    hasta,
    anchoMaximo = 1300,
}: {
    texto: string
    frame: number
    desde: number
    hasta?: number
    anchoMaximo?: number
}) {
    const entrada = interpolate(frame, [desde, desde + 14], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.out(Easing.cubic),
    })
    const salida =
        hasta === undefined ? 1 : interpolate(frame, [hasta, hasta + 12], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const opacidad = entrada * salida
    if (opacidad <= 0) return null
    return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 270,
                    opacity: opacidad,
                    background: `linear-gradient(0deg, ${conAlfa(COLOR.fondo, 0.96)} 0%, ${conAlfa(COLOR.fondo, 0.85)} 50%, ${conAlfa(COLOR.fondo, 0)} 100%)`,
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    left: 96,
                    bottom: 72,
                    maxWidth: anchoMaximo,
                    opacity: opacidad,
                    transform: `translateY(${(1 - entrada) * 18}px)`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 18,
                }}
            >
                <div
                    style={{
                        width: 6,
                        alignSelf: 'stretch',
                        borderRadius: 3,
                        background: COLOR.magenta,
                        boxShadow: `0 0 10px ${conAlfa(COLOR.magenta, 0.7)}`,
                    }}
                />
                <span style={{ fontFamily: FUENTE.cuerpo, fontSize: 34, fontWeight: 500, color: COLOR.texto, lineHeight: 1.3 }}>
                    {texto}
                </span>
            </div>
        </AbsoluteFill>
    )
}
