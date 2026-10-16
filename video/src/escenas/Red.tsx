import { AbsoluteFill, interpolate } from 'remotion'
import { Escena3D, Objeto3D } from '../camara/Escena3D'
import { PERSPECTIVA, orbita, vista } from '../camara/camara'
import { IconoNeon, type NombreIcono } from '../componentes/IconosNeon'
import { TituloSeccion } from '../componentes/Textos'
import { encendido, filtroNeon, mezclarConBlanco, respirar } from '../estilo/neon'
import { COLOR, FUENTE, conAlfa } from '../estilo/tema'
import { LogoArgos } from '../logo/LogoArgos'
import { type PropsEscena, camaraDeEscena, useEscena } from './comun'

const ANCHO = 1800
const ALTO = 900
const RADIO_CENTRO = 110
const RADIO_ICONO = 86

const NODOS: { icono: NombreIcono; texto: string; angulo: number; color: string }[] = [
    { icono: 'servidor', texto: 'radius', angulo: 180, color: COLOR.cian },
    { icono: 'router', texto: 'router', angulo: 232, color: COLOR.magenta },
    { icono: 'mensaje', texto: 'telegram', angulo: 308, color: COLOR.cian },
    { icono: 'respaldo', texto: 'respaldos', angulo: 0, color: COLOR.violeta },
    { icono: 'monitoreo', texto: 'monitoreo', angulo: 90, color: COLOR.magenta },
]

const posicion = (angulo: number) => ({
    x: Math.cos((angulo * Math.PI) / 180) * 640,
    y: Math.sin((angulo * Math.PI) / 180) * 290,
})

/** 8. Red y operación: RADIUS, MikroTik, alertas, respaldos y monitoreo como íconos neón conectados. */
export function Red({ escena }: PropsEscena) {
    const { frame, m, texto, fin } = useEscena(escena)
    const tIcono = (i: number) => m('primerIcono') + i * m('intervalo')

    const trazoCentro = interpolate(frame, [m('centro'), m('centro') + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const brilloCentro = encendido(frame, m('centro') + 16, 'red-centro', 12) * respirar(frame, 60, 0.12)

    const centro = { x: 0, y: 50, z: 0 }
    const camara = camaraDeEscena(
        frame,
        [
            { t: 0, cam: orbita(centro, PERSPECTIVA * 1.6, 26, 14) },
            { t: m('primerIcono') + 10, cam: orbita(centro, PERSPECTIVA / 0.98, 10, 9), curva: 'salida' },
            { t: m('salida'), cam: orbita(centro, PERSPECTIVA / 1.03, -10, 6) },
            { t: fin, cam: { ...vista({ zoom: 2.6, y: 50 }), ry: -6 }, curva: 'entrada' },
        ],
        undefined,
        0.6
    )

    return (
        <AbsoluteFill>
            <Escena3D camara={camara}>
                <Objeto3D y={centro.y}>
                    <div style={{ position: 'relative', width: ANCHO, height: ALTO }}>
                        <svg
                            width={ANCHO}
                            height={ALTO}
                            viewBox={`${-ANCHO / 2} ${-ALTO / 2} ${ANCHO} ${ALTO}`}
                            style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
                        >
                            {NODOS.map((n, i) => {
                                const p = posicion(n.angulo)
                                const largo = Math.hypot(p.x, p.y)
                                const u = { x: p.x / largo, y: p.y / largo }
                                const a = { x: u.x * (RADIO_CENTRO + 10), y: u.y * (RADIO_CENTRO + 10) }
                                const b = { x: p.x - u.x * (RADIO_ICONO + 10), y: p.y - u.y * (RADIO_ICONO + 10) }
                                const progreso = interpolate(frame, [tIcono(i) - 6, tIcono(i) + 10], [0, 1], {
                                    extrapolateLeft: 'clamp',
                                    extrapolateRight: 'clamp',
                                })
                                if (progreso <= 0) return null
                                return (
                                    <g key={n.icono} style={{ filter: filtroNeon(n.color, 0.7, 0.7) }}>
                                        <line
                                            x1={a.x}
                                            y1={a.y}
                                            x2={a.x + (b.x - a.x) * progreso}
                                            y2={a.y + (b.y - a.y) * progreso}
                                            stroke={mezclarConBlanco(n.color, 0.15)}
                                            strokeWidth={3}
                                            strokeLinecap="round"
                                            strokeDasharray="2 10"
                                        />
                                        {progreso >= 1
                                            ? [0, 1].map((k) => {
                                                  const ida = k === 0
                                                  const t = ((frame - tIcono(i)) / 34 + k * 0.5 + i * 0.17) % 1
                                                  const q = ida ? t : 1 - t
                                                  return (
                                                      <circle
                                                          key={k}
                                                          cx={a.x + (b.x - a.x) * q}
                                                          cy={a.y + (b.y - a.y) * q}
                                                          r={5}
                                                          fill={mezclarConBlanco(n.color, 0.6)}
                                                          opacity={Math.sin(t * Math.PI)}
                                                      />
                                                  )
                                              })
                                            : null}
                                    </g>
                                )
                            })}
                        </svg>
                        {/* Centro: ArgosIsp */}
                        <div
                            style={{
                                position: 'absolute',
                                left: ANCHO / 2,
                                top: ALTO / 2,
                                transform: 'translate(-50%, -50%)',
                                width: RADIO_CENTRO * 2,
                                height: RADIO_CENTRO * 2,
                                borderRadius: '50%',
                                border: `2.5px solid ${conAlfa(COLOR.cian, 0.25 + 0.6 * brilloCentro)}`,
                                boxShadow: `0 0 18px ${conAlfa(COLOR.cian, 0.4 * brilloCentro)}, inset 0 0 18px ${conAlfa(COLOR.cian, 0.2 * brilloCentro)}`,
                                background: conAlfa(COLOR.fondo, 0.8),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: trazoCentro,
                            }}
                        >
                            <LogoArgos tamano={140} trazo={trazoCentro} brillo={brilloCentro} />
                        </div>
                        {NODOS.map((n, i) => (
                            <NodoIcono
                                key={n.icono}
                                nombre={n.icono}
                                color={n.color}
                                frame={frame}
                                desde={tIcono(i)}
                                texto={texto(n.texto)}
                                {...posicion(n.angulo)}
                            />
                        ))}
                    </div>
                </Objeto3D>
            </Escena3D>
            <TituloSeccion seccion={texto('seccion')} titulo={texto('titulo')} frame={frame} hasta={m('salida')} color={COLOR.violeta} />
        </AbsoluteFill>
    )
}

function NodoIcono({
    nombre,
    color,
    frame,
    desde,
    texto,
    x,
    y,
}: {
    nombre: NombreIcono
    color: string
    frame: number
    desde: number
    texto: string
    x: number
    y: number
}) {
    const trazo = interpolate(frame, [desde, desde + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    if (trazo <= 0) return null
    const brillo = encendido(frame, desde + 12, `icono-${nombre}`, 10)
    return (
        <div
            style={{
                position: 'absolute',
                left: ANCHO / 2 + x,
                top: ALTO / 2 + y,
                width: 0,
                height: 0,
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    left: -RADIO_ICONO,
                    top: -RADIO_ICONO,
                    width: RADIO_ICONO * 2,
                    height: RADIO_ICONO * 2,
                    borderRadius: '50%',
                    border: `2px solid ${conAlfa(color, 0.2 + 0.5 * brillo)}`,
                    background: conAlfa(COLOR.fondo, 0.82),
                    boxShadow: `0 0 16px ${conAlfa(color, 0.3 * brillo)}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <IconoNeon nombre={nombre} color={color} tamano={96} trazo={trazo} brillo={Math.max(0.15, brillo)} />
            </div>
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    top: RADIO_ICONO + 18,
                    transform: 'translateX(-50%)',
                    whiteSpace: 'nowrap',
                    fontFamily: FUENTE.titulo,
                    fontWeight: 500,
                    fontSize: 28,
                    color: COLOR.texto,
                    opacity: trazo,
                    textShadow: `0 0 12px ${conAlfa(color, 0.5 * brillo)}`,
                }}
            >
                {texto}
            </div>
        </div>
    )
}
