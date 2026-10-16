import type { ComponentType, ReactNode } from 'react'
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion'
import { PistaAudio, valorPorEscena } from './audio/PistaAudio'
import type { PropsEscena } from './escenas/comun'
import { Cierre } from './escenas/Cierre'
import { Clientes } from './escenas/Clientes'
import { Cobro } from './escenas/Cobro'
import { Diagrama } from './escenas/Diagrama'
import { Montaje } from './escenas/Montaje'
import { Portada } from './escenas/Portada'
import { Portal } from './escenas/Portal'
import { Red } from './escenas/Red'
import { Servicio } from './escenas/Servicio'
import { Grilla } from './estilo/Grilla'
import { COLOR } from './estilo/tema'
import { FRAMES_TRANSICION, LINEA_DE_TIEMPO } from './guion'

/** Componente de cada escena del guion, por id. */
export const COMPONENTES: Record<string, ComponentType<PropsEscena>> = {
    portada: Portada,
    clientes: Clientes,
    servicio: Servicio,
    cobro: Cobro,
    diagrama: Diagrama,
    montaje: Montaje,
    portal: Portal,
    red: Red,
    cierre: Cierre,
}

/**
 * Avance de la grilla: velocidad base más un empujón en cada transición
 * (vuelo a través de la grilla). Es una suma de sigmoides, así que es
 * continua y determinista.
 */
function avanceGrilla(frame: number): number {
    const base = frame * 1.4
    const empujones = LINEA_DE_TIEMPO.slice(1).reduce((suma, escena) => {
        const centro = escena.desde + FRAMES_TRANSICION / 2
        return suma + 640 / (1 + Math.exp(-(frame - centro) / 6))
    }, 0)
    return base + empujones
}

export function Tour({ conAudio = true }: { conAudio?: boolean }) {
    const frame = useCurrentFrame()
    const intensidadGrilla = valorPorEscena(frame, (e) => e.grilla)
    return (
        <AbsoluteFill style={{ background: COLOR.fondo }}>
            <Grilla intensidad={intensidadGrilla} avance={avanceGrilla(frame)} />
            {LINEA_DE_TIEMPO.map((escena, i) => {
                const Componente = COMPONENTES[escena.id]
                if (!Componente) throw new Error(`Falta el componente de la escena "${escena.id}"`)
                return (
                    <Sequence key={escena.id} from={escena.desde} durationInFrames={escena.frames} name={escena.id}>
                        <Fundido primera={i === 0} ultima={i === LINEA_DE_TIEMPO.length - 1} frames={escena.frames}>
                            <Componente escena={escena} />
                        </Fundido>
                    </Sequence>
                )
            })}
            {conAudio ? <PistaAudio /> : null}
        </AbsoluteFill>
    )
}

/** Fundido de entrada/salida durante los solapamientos entre escenas. */
function Fundido({
    primera,
    ultima,
    frames,
    children,
}: {
    primera: boolean
    ultima: boolean
    frames: number
    children: ReactNode
}) {
    const frame = useCurrentFrame()
    const entrada = primera ? 1 : interpolate(frame, [0, FRAMES_TRANSICION], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const salida = ultima
        ? 1
        : interpolate(frame, [frames - FRAMES_TRANSICION, frames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    return <AbsoluteFill style={{ opacity: Math.min(entrada, salida) }}>{children}</AbsoluteFill>
}
