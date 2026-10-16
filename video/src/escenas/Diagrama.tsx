import { AbsoluteFill, interpolate } from 'remotion'
import { Escena3D, Objeto3D } from '../camara/Escena3D'
import { PERSPECTIVA, orbita, vista } from '../camara/camara'
import { TituloSeccion } from '../componentes/Textos'
import { encendido, filtroNeon, mezclarConBlanco, respirar } from '../estilo/neon'
import { COLOR, FUENTE, conAlfa } from '../estilo/tema'
import { type PropsEscena, camaraDeEscena, useEscena } from './comun'

const ANCHO = 1800
const ALTO = 900
const RX = 690
const RY = 300
const CY = 30
const TOTAL = 8
const HUECO = 16
const RAD = Math.PI / 180

const COLORES = [COLOR.violeta, COLOR.magenta, COLOR.magenta, COLOR.magenta, COLOR.cian, COLOR.cian, COLOR.cian, COLOR.cian]

const enElipse = (grados: number, escala = 1) => ({
    x: Math.cos(grados * RAD) * RX * escala,
    y: CY + Math.sin(grados * RAD) * RY * escala,
})
const anguloNodo = (i: number) => 180 + (360 / TOTAL) * i

interface Arista {
    p0: { x: number; y: number }
    c: { x: number; y: number }
    p2: { x: number; y: number }
}

function arista(desde: number, hasta: number): Arista {
    const a = anguloNodo(desde) + HUECO
    const b = anguloNodo(hasta) + (hasta < desde ? 360 : 0) - HUECO
    return { p0: enElipse(a), c: enElipse((a + b) / 2, 1.07), p2: enElipse(b) }
}

function puntoBezier({ p0, c, p2 }: Arista, t: number) {
    const u = 1 - t
    return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y }
}

/** 5. Diagrama neón del ciclo: Factura → Vence → Limita → Corta → Pago → Evento → CoA → Activo. */
export function Diagrama({ escena }: PropsEscena) {
    const { frame, m, texto, fin } = useEscena(escena)
    const intervalo = m('intervalo')
    const tNodo = (i: number) => m('primerNodo') + i * intervalo
    const aristas = Array.from({ length: TOTAL - 1 }, (_, i) => arista(i, i + 1))
    const cierre = arista(TOTAL - 1, 0)
    const brilloCierre = interpolate(frame, [m('cierreCiclo'), m('cierreCiclo') + 24], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    })

    const centro = { x: 0, y: 40, z: 0 }
    const camara = camaraDeEscena(
        frame,
        [
            { t: 0, cam: orbita(centro, PERSPECTIVA * 1.4, -34, 16) },
            { t: m('primerNodo') + 10, cam: orbita(centro, PERSPECTIVA / 0.95, -12, 11), curva: 'salida' },
            { t: m('cierreCiclo'), cam: orbita(centro, PERSPECTIVA / 1.0, 8, 7) },
            { t: m('salida'), cam: orbita(centro, PERSPECTIVA / 1.04, 12, 6) },
            { t: fin, cam: { ...vista({ zoom: 2.8, y: 60 }), ry: 4 }, curva: 'entrada' },
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
                            {aristas.map((a, i) => {
                                const desde = tNodo(i) + 8
                                const hasta = tNodo(i + 1) - 2
                                const p = interpolate(frame, [desde, hasta], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
                                if (p <= 0) return null
                                const color = COLORES[i + 1]
                                return (
                                    <g key={i} style={{ filter: filtroNeon(color, 0.85, 0.8) }}>
                                        <path
                                            d={`M${a.p0.x} ${a.p0.y} Q${a.c.x} ${a.c.y} ${a.p2.x} ${a.p2.y}`}
                                            fill="none"
                                            stroke={mezclarConBlanco(color, 0.2)}
                                            strokeWidth={3.5}
                                            strokeLinecap="round"
                                            pathLength={1}
                                            strokeDasharray={1}
                                            strokeDashoffset={1 - p}
                                        />
                                        {p >= 1 ? <Flecha a={a} color={mezclarConBlanco(color, 0.2)} /> : null}
                                        {p >= 1 ? <Particulas a={a} frame={frame - hasta} color={color} semilla={i} /> : null}
                                    </g>
                                )
                            })}
                            {brilloCierre > 0 ? (
                                <g style={{ opacity: brilloCierre * 0.8, filter: filtroNeon(COLOR.violeta, 0.6, 0.7) }}>
                                    <path
                                        d={`M${cierre.p0.x} ${cierre.p0.y} Q${cierre.c.x} ${cierre.c.y} ${cierre.p2.x} ${cierre.p2.y}`}
                                        fill="none"
                                        stroke={COLOR.violeta}
                                        strokeWidth={2.5}
                                        strokeDasharray="10 12"
                                        strokeDashoffset={-frame * 0.8}
                                    />
                                    <Flecha a={cierre} color={COLOR.violeta} />
                                </g>
                            ) : null}
                        </svg>
                        {Array.from({ length: TOTAL }, (_, i) => (
                            <Nodo
                                key={i}
                                i={i}
                                frame={frame}
                                desde={tNodo(i)}
                                titulo={texto(`nodo${i + 1}`)}
                                detalle={texto(`detalle${i + 1}`)}
                            />
                        ))}
                        <Centro frame={frame} desde={tNodo(3)} />
                    </div>
                </Objeto3D>
            </Escena3D>
            <TituloSeccion seccion={texto('seccion')} titulo={texto('titulo')} frame={frame} hasta={m('salida')} color={COLOR.magenta} />
        </AbsoluteFill>
    )
}

function Nodo({ i, frame, desde, titulo, detalle }: { i: number; frame: number; desde: number; titulo: string; detalle: string }) {
    const brillo = encendido(frame, desde, `nodo-${i}`, 12)
    if (brillo <= 0) return null
    const color = COLORES[i]
    const { x, y } = enElipse(anguloNodo(i))
    const destacado = i === TOTAL - 1 ? respirar(frame, 50, 0.25) : 1
    const intensidad = brillo * destacado
    return (
        <div
            style={{
                position: 'absolute',
                left: ANCHO / 2 + x,
                top: ALTO / 2 + y,
                transform: 'translate(-50%, -50%)',
                width: 280,
                height: 98,
                borderRadius: 18,
                border: `2.5px solid ${intensidad < 0.2 ? conAlfa(color, 0.25) : mezclarConBlanco(color, 0.15)}`,
                background: conAlfa(COLOR.fondo, 0.86),
                boxShadow: `0 0 8px ${conAlfa(color, 0.8 * intensidad)}, 0 0 26px ${conAlfa(color, 0.35 * intensidad)}, inset 0 0 14px ${conAlfa(color, 0.22 * intensidad)}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
            }}
        >
            <span
                style={{
                    fontFamily: FUENTE.titulo,
                    fontWeight: 600,
                    fontSize: 30,
                    color: intensidad < 0.2 ? conAlfa(COLOR.texto, 0.2) : mezclarConBlanco(color, 0.6),
                    textShadow: `0 0 10px ${conAlfa(color, 0.6 * intensidad)}`,
                    whiteSpace: 'nowrap',
                }}
            >
                {titulo}
            </span>
            <span style={{ fontFamily: FUENTE.mono, fontSize: 16, color: COLOR.textoSuave, opacity: brillo, whiteSpace: 'nowrap' }}>{detalle}</span>
        </div>
    )
}

function Flecha({ a, color }: { a: Arista; color: string }) {
    const dx = a.p2.x - a.c.x
    const dy = a.p2.y - a.c.y
    const largo = Math.hypot(dx, dy) || 1
    const ux = dx / largo
    const uy = dy / largo
    const tam = 16
    const izq = { x: a.p2.x - ux * tam - uy * tam * 0.6, y: a.p2.y - uy * tam + ux * tam * 0.6 }
    const der = { x: a.p2.x - ux * tam + uy * tam * 0.6, y: a.p2.y - uy * tam - ux * tam * 0.6 }
    return (
        <path
            d={`M${izq.x} ${izq.y} L${a.p2.x} ${a.p2.y} L${der.x} ${der.y}`}
            fill="none"
            stroke={color}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    )
}

function Particulas({ a, frame, color, semilla }: { a: Arista; frame: number; color: string; semilla: number }) {
    const cantidad = 3
    return (
        <>
            {Array.from({ length: cantidad }, (_, k) => {
                const u = (frame / 38 + k / cantidad + semilla * 0.13) % 1
                const { x, y } = puntoBezier(a, u)
                const opacidad = Math.sin(u * Math.PI)
                return <circle key={k} cx={x} cy={y} r={5} fill={mezclarConBlanco(color, 0.6)} opacity={opacidad} />
            })}
        </>
    )
}

function Centro({ frame, desde }: { frame: number; desde: number }) {
    const opacidad = interpolate(frame, [desde, desde + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    if (opacidad <= 0) return null
    return (
        <div
            style={{
                position: 'absolute',
                left: ANCHO / 2,
                top: ALTO / 2 + CY,
                transform: 'translate(-50%, -50%)',
                textAlign: 'center',
                opacity: opacidad,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
            }}
        >
            <span style={{ fontFamily: FUENTE.mono, fontSize: 30, color: mezclarConBlanco(COLOR.violeta, 0.3), textShadow: `0 0 12px ${conAlfa(COLOR.violeta, 0.6)}` }}>
                evaluarEstadoServicio()
            </span>
            <span style={{ fontFamily: FUENTE.cuerpo, fontSize: 22, color: COLOR.textoSuave }}>una sola función decide el estado</span>
        </div>
    )
}
