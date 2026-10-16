import { AbsoluteFill } from 'remotion'
import { COLOR, conAlfa } from './tema'

const CELDA = 110

/**
 * Fondo synthwave: grilla en perspectiva que avanza hacia la cámara, con un
 * horizonte violeta. `intensidad` 0..1; `avance` en px (crece con el tiempo y
 * se acelera en las transiciones para el "vuelo a través de la grilla").
 */
export function Grilla({ intensidad, avance }: { intensidad: number; avance: number }) {
    const linea = conAlfa(COLOR.violeta, 0.42 * intensidad)
    const lineaCian = conAlfa(COLOR.cian, 0.16 * intensidad)
    const desplazamiento = avance % CELDA
    return (
        <AbsoluteFill style={{ background: COLOR.fondo, overflow: 'hidden' }}>
            {/* Cielo: degradado muy tenue hacia el horizonte */}
            <AbsoluteFill
                style={{
                    background: `linear-gradient(180deg, ${COLOR.fondo} 0%, ${conAlfa('#140a2a', 0.9 * intensidad)} 50%, ${COLOR.fondo} 62%)`,
                }}
            />
            {/* Techo: la misma grilla reflejada, muy tenue */}
            <PlanoGrilla
                arriba
                desplazamiento={desplazamiento}
                linea={conAlfa(COLOR.violeta, 0.12 * intensidad)}
                lineaCian={conAlfa(COLOR.cian, 0.05 * intensidad)}
            />
            <PlanoGrilla desplazamiento={desplazamiento} linea={linea} lineaCian={lineaCian} />
            {/* Línea del horizonte */}
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: '56%',
                    height: 2,
                    background: `linear-gradient(90deg, transparent, ${conAlfa(COLOR.magenta, 0.7 * intensidad)}, transparent)`,
                    boxShadow: `0 0 24px 6px ${conAlfa(COLOR.magenta, 0.22 * intensidad)}`,
                }}
            />
            {/* Viñeta */}
            <AbsoluteFill
                style={{
                    background: `radial-gradient(ellipse at 50% 50%, transparent 40%, ${conAlfa(COLOR.fondo, 0.85)} 100%)`,
                }}
            />
        </AbsoluteFill>
    )
}

function PlanoGrilla({
    arriba = false,
    desplazamiento,
    linea,
    lineaCian,
}: {
    arriba?: boolean
    desplazamiento: number
    linea: string
    lineaCian: string
}) {
    return (
        <div
            style={{
                position: 'absolute',
                left: '50%',
                top: arriba ? undefined : '56%',
                bottom: arriba ? '44%' : undefined,
                width: 7000,
                height: 2600,
                marginLeft: -3500,
                transformOrigin: arriba ? '50% 100%' : '50% 0%',
                transform: `perspective(620px) rotateX(${arriba ? -78 : 78}deg)`,
                backgroundImage: [
                    `linear-gradient(90deg, ${linea} 2px, transparent 2px)`,
                    `linear-gradient(0deg, ${linea} 2px, transparent 2px)`,
                    `linear-gradient(90deg, ${lineaCian} 6px, transparent 6px)`,
                ].join(', '),
                backgroundSize: `${CELDA}px ${CELDA}px, ${CELDA}px ${CELDA}px, ${CELDA * 4}px ${CELDA}px`,
                backgroundPosition: `0 ${arriba ? -desplazamiento : desplazamiento}px`,
                WebkitMaskImage: `linear-gradient(${arriba ? '0deg' : '180deg'}, transparent 0%, black 18%, black 100%)`,
                maskImage: `linear-gradient(${arriba ? '0deg' : '180deg'}, transparent 0%, black 18%, black 100%)`,
            }}
        />
    )
}
