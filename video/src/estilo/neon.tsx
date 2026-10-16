import type { CSSProperties, ReactNode } from 'react'
import { random } from 'remotion'
import { COLOR, FUENTE, conAlfa } from './tema'

/**
 * Intensidad de encendido de un tubo neón (0..1) con parpadeo determinista.
 * Antes de `inicio` está apagado; durante `duracion` frames parpadea con
 * probabilidad creciente de quedar encendido; después queda en 1.
 */
export function encendido(frame: number, inicio: number, semilla: string, duracion = 14): number {
    const t = frame - inicio
    if (t < 0) return 0
    if (t >= duracion) return 1
    const progreso = t / duracion
    // Pasos de 2 frames: el parpadeo se percibe sin volverse estroboscópico.
    const r = random(`${semilla}-${Math.floor(t / 2)}`)
    const prendido = r < 0.3 + progreso * 0.75
    return prendido ? 0.55 + 0.45 * progreso : 0.06
}

/** Respiración suave del brillo: oscila entre `1 - amplitud` y 1. */
export function respirar(frame: number, periodoFrames = 90, amplitud = 0.12): number {
    return 1 - amplitud / 2 + (amplitud / 2) * Math.sin((frame / periodoFrames) * Math.PI * 2)
}

/** Sombra de texto en capas para neón. `intensidad` 0..1. */
export function sombraNeon(color: string, intensidad = 1, escala = 1): string {
    const i = Math.max(0, intensidad)
    return [
        `0 0 ${1.5 * escala}px ${conAlfa('#ffffff', 0.55 * i)}`,
        `0 0 ${5 * escala}px ${conAlfa(color, 0.9 * i)}`,
        `0 0 ${14 * escala}px ${conAlfa(color, 0.55 * i)}`,
        `0 0 ${32 * escala}px ${conAlfa(color, 0.3 * i)}`,
    ].join(', ')
}

/** Filtro de brillo para SVG y cajas (drop-shadow en capas). */
export function filtroNeon(color: string, intensidad = 1, escala = 1): string {
    const i = Math.max(0, intensidad)
    return [
        `drop-shadow(0 0 ${2 * escala}px ${conAlfa(color, 0.95 * i)})`,
        `drop-shadow(0 0 ${7 * escala}px ${conAlfa(color, 0.6 * i)})`,
        `drop-shadow(0 0 ${18 * escala}px ${conAlfa(color, 0.35 * i)})`,
    ].join(' ')
}

/** Color del tubo según intensidad: apagado es un gris oscuro con un tinte del color. */
export function colorTubo(color: string, intensidad: number): string {
    return intensidad < 0.2 ? conAlfa(color, 0.18) : color
}

export function TextoNeon({
    children,
    color = COLOR.cian,
    intensidad = 1,
    tamano = 72,
    peso = 600,
    familia = FUENTE.titulo,
    estilo,
}: {
    children: ReactNode
    color?: string
    intensidad?: number
    tamano?: number
    peso?: number
    familia?: string
    estilo?: CSSProperties
}) {
    // El núcleo del tubo es casi blanco con un tinte; el halo lleva el color.
    const nucleo = intensidad < 0.2 ? conAlfa(color, 0.22) : mezclarConBlanco(color, 0.55)
    return (
        <span
            style={{
                fontFamily: familia,
                fontSize: tamano,
                fontWeight: peso,
                color: nucleo,
                textShadow: sombraNeon(color, intensidad, tamano / 72),
                letterSpacing: '-0.01em',
                lineHeight: 1.05,
                ...estilo,
            }}
        >
            {children}
        </span>
    )
}

/** Mezcla un color con blanco (`cantidad` 0..1 de blanco). */
export function mezclarConBlanco(hex: string, cantidad: number): string {
    const valor = parseInt(hex.slice(1), 16)
    const canal = (c: number) => Math.round(c + (255 - c) * cantidad)
    const r = canal((valor >> 16) & 255)
    const g = canal((valor >> 8) & 255)
    const b = canal(valor & 255)
    return `rgb(${r}, ${g}, ${b})`
}
