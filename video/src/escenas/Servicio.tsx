import { AbsoluteFill, interpolate } from 'remotion'
import { Escena3D, Objeto3D } from '../camara/Escena3D'
import { CursorNeon, EtiquetaNeon, Halo, paso, posicionCursor } from '../camara/Seguimiento'
import { PERSPECTIVA, enfocar, encuadrar, orbita, puntoEnMundo } from '../camara/camara'
import { Panel } from '../componentes/Paneles'
import { Leyenda, TituloSeccion } from '../componentes/Textos'
import { COLOR, FUENTE } from '../estilo/tema'
import { CAPTURAS, type PuntoInteres } from '../guion'
import { type PropsEscena, camaraDeEscena, colocar, cruce, useEscena } from './comun'

const ficha = CAPTURAS.servicioFicha
const P = ficha.puntos
const panel = colocar('servicioFicha', { y: 30 })
/** Entre el estado y las acciones, para encuadrar ambos. */
const CABECERA = { x: 470, y: 150 }
/** Botón "Reactivar" dibujado sobre "Suspender" mientras el servicio está suspendido. */
const REACTIVAR: PuntoInteres = { ...P.suspender, texto: 'Reactivar' }

/** Colores del panel real (tema oscuro) para los estados que el video dibuja encima. */
const UI = {
    fondo: '#0f172b',
    rojo: '#f87171',
    rojoFondo: 'rgba(239, 68, 68, 0.12)',
    rojoBorde: 'rgba(248, 113, 113, 0.45)',
    verde: '#4ade80',
    verdeFondo: 'rgba(34, 197, 94, 0.10)',
    verdeBorde: 'rgba(74, 222, 128, 0.5)',
}

/**
 * Badge "Suspendido" y botón "Reactivar" con el estilo del panel, encima de la
 * captura del estado activo (no existe captura del estado suspendido).
 */
function EstadoSuspendido({ opacidad, badge, boton }: { opacidad: number; badge: string; boton: string }) {
    if (opacidad <= 0) return null
    const b = P.badge
    const s = P.suspender
    return (
        <div style={{ position: 'absolute', inset: 0, opacity: opacidad, zIndex: 5, fontFamily: FUENTE.cuerpo }}>
            {/* Tapa el badge original y dibuja el nuevo, alineado a su izquierda. */}
            <div style={{ position: 'absolute', left: b.x - b.ancho / 2 - 2, top: b.y - 14, width: 120, height: 28, background: UI.fondo }} />
            <div
                style={{
                    position: 'absolute',
                    left: b.x - b.ancho / 2,
                    top: b.y - b.alto / 2,
                    height: b.alto,
                    padding: '0 8px 0 6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    borderRadius: 5,
                    border: `1px solid ${UI.rojoBorde}`,
                    background: UI.rojoFondo,
                    color: UI.rojo,
                    fontSize: 12,
                    fontWeight: 500,
                }}
            >
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={UI.rojo} strokeWidth={2.2} strokeLinecap="round">
                    <circle cx={12} cy={12} r={9.5} />
                    <path d="M9 9l6 6M15 9l-6 6" />
                </svg>
                {badge}
            </div>
            <div
                style={{
                    position: 'absolute',
                    left: s.x - s.ancho / 2,
                    top: s.y - s.alto / 2,
                    width: s.ancho,
                    height: s.alto,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    borderRadius: 6,
                    border: `1px solid ${UI.verdeBorde}`,
                    background: `linear-gradient(${UI.verdeFondo}, ${UI.verdeFondo}), ${UI.fondo}`,
                    color: UI.verde,
                    fontSize: 14.5,
                    fontWeight: 500,
                }}
            >
                <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={UI.verde} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx={12} cy={12} r={9.5} />
                    <path d="M10 8.5l5 3.5-5 3.5z" />
                </svg>
                {boton}
            </div>
        </div>
    )
}

/** 3. Servicio: IPv4 y prefijos IPv6; Suspender cambia el estado y Reactivar lo devuelve. */
export function Servicio({ escena }: PropsEscena) {
    const { frame, m, texto, fin } = useEscena(escena)

    const suspendido = cruce(frame, m('badge'), 6) * (1 - cruce(frame, m('clicReactivar') + 3, 6))
    const ruta = [
        { t: m('vista') + 4, x: 760, y: 620 },
        { t: m('ips') + 20, x: P.red.x - 120, y: P.red.y + 70 },
        paso(m('clicSuspender'), P.suspender, true, { x: 20, y: 0 }),
        { t: m('clicReactivar') - 30, x: P.suspender.x + 90, y: P.suspender.y + 70 },
        paso(m('clicReactivar'), REACTIVAR, true, { x: 20, y: 0 }),
    ]
    const objetivo = puntoEnMundo(panel, posicionCursor(ruta, frame - 4))

    const general = encuadrar(panel, 0.78)
    const generalDesplazada = { ...general, x: general.x - 60, y: general.y - 90 }
    const camara = camaraDeEscena(
        frame,
        [
            { t: 0, cam: orbita({ x: 0, y: 30, z: 0 }, PERSPECTIVA * 1.5, 30, 6) },
            { t: m('vista'), cam: generalDesplazada, curva: 'salida' },
            { t: m('ips') + 16, cam: enfocar(panel, P.red, 1.6, { ry: -4 }) },
            { t: m('clicSuspender') - 26, cam: enfocar(panel, P.red, 1.65, { ry: -2 }) },
            { t: m('clicSuspender') + 2, cam: enfocar(panel, CABECERA, 1.8) },
            { t: m('badge') + 14, cam: enfocar(panel, CABECERA, 2.0) },
            { t: m('clicReactivar') - 22, cam: enfocar(panel, CABECERA, 2.0, { ry: 3 }) },
            { t: m('clicReactivar') + 2, cam: enfocar(panel, CABECERA, 1.85) },
            { t: m('salida'), cam: enfocar(panel, CABECERA, 1.7, { ry: -3 }) },
            { t: fin, cam: enfocar(panel, { x: 640, y: 400 }, 0.7, { ry: -34 }), curva: 'entrada' },
        ],
        objetivo,
        0.8,
        panel
    )

    const etiquetaSuspendido = interpolate(frame, [m('badge'), m('clicReactivar')], [0, 1]) > 0

    return (
        <AbsoluteFill>
            <Escena3D camara={camara}>
                <Objeto3D x={panel.x} y={panel.y} z={panel.z} ry={panel.ry} nitidez={2} tamano={panel}>
                    <Panel capas={[{ captura: ficha, opacidad: 1 }]}>
                        <EstadoSuspendido opacidad={suspendido} badge={texto('badgeSuspendido')} boton={texto('botonReactivar')} />
                        <Halo punto={P.red} frame={frame} desde={m('ips') + 10} hasta={m('clicSuspender') - 20} margen={6} />
                        <EtiquetaNeon punto={P.red} frame={frame} desde={m('ips') + 18} hasta={m('clicSuspender') - 24} lado="abajo" distancia={40} tamano={17}>
                            {P.red.texto}
                        </EtiquetaNeon>
                        {etiquetaSuspendido ? (
                            <>
                                <Halo
                                    punto={{ ...P.badge, x: P.badge.x + 14, ancho: 100 }}
                                    frame={frame}
                                    desde={m('badge')}
                                    hasta={m('clicReactivar')}
                                    color={COLOR.magenta}
                                    semilla="badge-suspendido"
                                />
                                <EtiquetaNeon
                                    punto={{ ...P.badge, x: P.badge.x + 14, ancho: 100 }}
                                    frame={frame}
                                    desde={m('badge') + 10}
                                    hasta={m('clicReactivar') - 6}
                                    lado="derecha"
                                    distancia={40}
                                    color={COLOR.magenta}
                                    tamano={14}
                                >
                                    {texto('etiquetaSuspendido')}
                                </EtiquetaNeon>
                            </>
                        ) : null}
                        <Halo punto={P.badge} frame={frame} desde={m('clicReactivar') + 4} semilla="badge-activo" />
                        <EtiquetaNeon punto={P.badge} frame={frame} desde={m('clicReactivar') + 12} lado="derecha" distancia={40} tamano={14}>
                            {texto('etiquetaActivo')}
                        </EtiquetaNeon>
                        <CursorNeon ruta={ruta} frame={frame} hasta={m('salida')} />
                    </Panel>
                </Objeto3D>
            </Escena3D>
            <TituloSeccion seccion={texto('seccion')} titulo={texto('titulo')} frame={frame} hasta={m('salida')} />
            <Leyenda texto={texto('leyenda')} frame={frame} desde={m('vista')} hasta={m('salida')} />
        </AbsoluteFill>
    )
}
