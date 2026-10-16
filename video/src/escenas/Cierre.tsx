import { AbsoluteFill, Easing, interpolate } from 'remotion'
import { encendido, respirar } from '../estilo/neon'
import { COLOR, conAlfa } from '../estilo/tema'
import { LogoArgos, Wordmark } from '../logo/LogoArgos'
import { type PropsEscena, useEscena } from './comun'

/**
 * 9. Cierre: el logo centrado, limpio, en neón. Se traza, se enciende con un
 * parpadeo breve y el brillo respira. Debajo, solo el nombre. Termina encendido.
 */
export function Cierre({ escena }: PropsEscena) {
    const { frame, m } = useEscena(escena)

    const trazo = interpolate(frame, [m('trazo'), m('encendido')], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.inOut(Easing.cubic),
    })
    const respiracion = frame > m('encendido') + 16 ? respirar(frame - m('encendido'), 84, 0.16) : 1
    const brillo = encendido(frame, m('encendido'), 'cierre-logo', 16) * respiracion
    const brilloNombre = encendido(frame, m('nombre'), 'cierre-nombre', 10) * respiracion
    const nombre = interpolate(frame, [m('nombre'), m('nombre') + 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    // Un acercamiento casi imperceptible para que el plano no quede muerto.
    const escala = interpolate(frame, [0, escena.frames], [0.97, 1.02])

    return (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
            <AbsoluteFill
                style={{
                    background: `radial-gradient(circle at 50% 44%, ${conAlfa(COLOR.cian, 0.1 * brillo)} 0%, transparent 30%)`,
                }}
            />
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 40,
                    transform: `scale(${escala}) translateY(-10px)`,
                }}
            >
                <LogoArgos tamano={340} trazo={trazo} brillo={brillo} />
                <div style={{ opacity: nombre }}>
                    <Wordmark tamano={104} brillo={brilloNombre * 0.8} />
                </div>
            </div>
        </AbsoluteFill>
    )
}
