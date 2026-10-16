import type { CSSProperties } from 'react'
import { interpolate } from 'remotion'
import { filtroNeon, mezclarConBlanco, sombraNeon } from '../estilo/neon'
import { COLOR, FUENTE, conAlfa } from '../estilo/tema'
import { type DefinicionLogo, LOGO_ELEGIDO } from './geometria'

/**
 * Logo de ArgosIsp (símbolo). Monocromo en trazos.
 *
 * - `trazo` 0..1: cuánto está dibujado (stroke-dashoffset, por orden).
 * - `brillo` 0..1: encendido del neón (0 = tubo apagado, 1 = encendido).
 *   Con `neon = false` se dibuja plano, sin brillo, para usos estáticos.
 */
export function LogoArgos({
    tamano = 256,
    color = COLOR.cian,
    trazo = 1,
    brillo = 1,
    neon = true,
    definicion = LOGO_ELEGIDO,
    estilo,
}: {
    tamano?: number
    color?: string
    trazo?: number
    brillo?: number
    neon?: boolean
    definicion?: DefinicionLogo
    estilo?: CSSProperties
}) {
    const maxOrden = Math.max(...definicion.trazos.map((t) => t.orden), 1)
    const encendido = neon ? brillo : 1
    const colorTrazo = !neon ? color : encendido < 0.2 ? conAlfa(color, 0.32) : mezclarConBlanco(color, 0.35 * encendido)
    // El brillo escala con el tamaño para verse igual a cualquier escala.
    const escalaBrillo = tamano / 256
    return (
        <svg
            width={tamano}
            height={tamano}
            viewBox={definicion.viewBox}
            fill="none"
            style={{
                overflow: 'visible',
                filter: neon && encendido > 0.05 ? filtroNeon(color, encendido, escalaBrillo * 1.6) : undefined,
                ...estilo,
            }}
        >
            {definicion.trazos.map((t, i) => {
                const inicio = (t.orden / maxOrden) * 0.62
                const p = interpolate(trazo, [inicio, inicio + 0.38], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                })
                if (p <= 0) return null
                const comun = {
                    stroke: colorTrazo,
                    strokeWidth: definicion.grosor,
                    strokeLinecap: 'round' as const,
                    strokeLinejoin: 'round' as const,
                    pathLength: 1,
                    strokeDasharray: 1,
                    strokeDashoffset: 1 - p,
                }
                return t.tipo === 'path' ? (
                    <path key={i} d={t.d} {...comun} />
                ) : (
                    <circle key={i} cx={t.cx} cy={t.cy} r={t.r} {...comun} />
                )
            })}
        </svg>
    )
}

/** Wordmark "ArgosIsp": "Argos" en negrita, "Isp" en peso ligero y en color. */
export function Wordmark({
    tamano = 120,
    brillo = 1,
    color = COLOR.cian,
    neon = true,
    estilo,
}: {
    tamano?: number
    brillo?: number
    color?: string
    neon?: boolean
    estilo?: CSSProperties
}) {
    const apagado = neon && brillo < 0.2
    return (
        <span
            style={{
                fontFamily: FUENTE.titulo,
                fontSize: tamano,
                letterSpacing: '-0.02em',
                lineHeight: 1,
                whiteSpace: 'nowrap',
                ...estilo,
            }}
        >
            <span
                style={{
                    fontWeight: 700,
                    color: apagado ? conAlfa(COLOR.texto, 0.15) : COLOR.texto,
                    textShadow: neon ? sombraNeon(COLOR.violeta, brillo * 0.55, tamano / 110) : undefined,
                }}
            >
                Argos
            </span>
            <span
                style={{
                    fontWeight: 300,
                    marginLeft: '0.04em',
                    color: apagado ? conAlfa(color, 0.2) : mezclarConBlanco(color, neon ? 0.3 : 0),
                    textShadow: neon ? sombraNeon(color, brillo, tamano / 110) : undefined,
                }}
            >
                Isp
            </span>
        </span>
    )
}
