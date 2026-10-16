import { AbsoluteFill, Easing, interpolate } from 'remotion'
import { Escena3D, Objeto3D } from '../camara/Escena3D'
import { vista } from '../camara/camara'
import { encendido, respirar } from '../estilo/neon'
import { COLOR, FUENTE, conAlfa } from '../estilo/tema'
import { LogoArgos, Wordmark } from '../logo/LogoArgos'
import { type PropsEscena, camaraDeEscena, useEscena } from './comun'

/** 1. Portada: el logo se traza y se enciende; aparece "ArgosIsp" y el subtítulo. */
export function Portada({ escena }: PropsEscena) {
    const { frame, m, texto, fin } = useEscena(escena)

    const trazo = interpolate(frame, [m('trazo'), m('encendido')], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.inOut(Easing.cubic),
    })
    const brilloLogo = encendido(frame, m('encendido'), 'portada-logo', 16) * respirar(frame, 80, 0.1)
    const brilloNombre = encendido(frame, m('nombre'), 'portada-nombre', 12)
    const subtitulo = interpolate(frame, [m('subtitulo'), m('subtitulo') + 18], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    })
    const nombreVisible = interpolate(frame, [m('nombre'), m('nombre') + 6], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    })

    // Acercamiento lento y, al final, vuelo hacia adelante a través del logo.
    const camara = camaraDeEscena(
        frame,
        [
            { t: 0, cam: vista({ zoom: 0.82, ry: -6, rx: 4 }) },
            { t: m('salida'), cam: vista({ zoom: 1.0 }), curva: 'salida' },
            { t: fin, cam: vista({ zoom: 3.2, y: 40 }), curva: 'entrada' },
        ],
        undefined,
        0.6
    )

    return (
        <AbsoluteFill>
            {/* Resplandor detrás del logo */}
            <AbsoluteFill
                style={{
                    background: `radial-gradient(circle at 50% 42%, ${conAlfa(COLOR.cian, 0.12 * brilloLogo)} 0%, transparent 32%)`,
                }}
            />
            <Escena3D camara={camara}>
                <Objeto3D y={-20}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, width: 1400 }}>
                        <LogoArgos tamano={250} trazo={trazo} brillo={brilloLogo} />
                        <div style={{ opacity: nombreVisible }}>
                            <Wordmark tamano={150} brillo={brilloNombre} />
                        </div>
                        <div
                            style={{
                                opacity: subtitulo,
                                transform: `translateY(${(1 - subtitulo) * 16}px)`,
                                fontFamily: FUENTE.cuerpo,
                                fontWeight: 500,
                                fontSize: 44,
                                color: COLOR.texto,
                                letterSpacing: '0.01em',
                            }}
                        >
                            {texto('subtitulo')}
                        </div>
                    </div>
                </Objeto3D>
            </Escena3D>
        </AbsoluteFill>
    )
}
