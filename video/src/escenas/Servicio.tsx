import { AbsoluteFill } from 'remotion'
import { Escena3D, Objeto3D } from '../camara/Escena3D'
import { CursorNeon, EtiquetaNeon, Halo, paso, posicionCursor } from '../camara/Seguimiento'
import { PERSPECTIVA, enfocar, encuadrar, orbita, puntoEnMundo } from '../camara/camara'
import { Panel } from '../componentes/Paneles'
import { Leyenda, TituloSeccion } from '../componentes/Textos'
import { COLOR } from '../estilo/tema'
import { CAPTURAS } from '../guion'
import { type PropsEscena, camaraDeEscena, colocar, cruce, useEscena } from './comun'

const ficha = CAPTURAS.servicioFicha
const suspendido = CAPTURAS.servicioSuspendido
const P = ficha.puntos
const panel = colocar('servicioFicha', { y: 30 })
/** Entre IPv4 e IPv6, para encuadrar ambos bloques. */
const IPS = { x: 560, y: 384, ancho: 560, alto: 190, texto: 'IPs' }
/** Entre el badge y los botones de acción. */
const ACCIONES = { x: 1080, y: 160 }

/** 3. Servicio: IPv4 y prefijos IPv6; Suspender cambia el badge, Reactivar lo devuelve. */
export function Servicio({ escena }: PropsEscena) {
    const { frame, m, texto, fin } = useEscena(escena)

    const suspendidoVisible = cruce(frame, m('badge')) * (1 - cruce(frame, m('clicReactivar') + 3))
    const ruta = [
        { t: m('vista') + 4, x: 760, y: 620 },
        { t: m('ips') + 20, x: 790, y: 455 },
        paso(m('clicSuspender'), P.suspender, true),
        paso(m('clicReactivar'), P.reactivar, true),
    ]
    const objetivo = puntoEnMundo(panel, posicionCursor(ruta, frame - 4))

    const general = encuadrar(panel, 0.78)
    const generalDesplazada = { ...general, x: general.x - 60, y: general.y - 90 }
    const camara = camaraDeEscena(
        frame,
        [
            { t: 0, cam: orbita({ x: 0, y: 30, z: 0 }, PERSPECTIVA * 1.5, 30, 6) },
            { t: m('vista'), cam: generalDesplazada, curva: 'salida' },
            { t: m('ips') + 16, cam: enfocar(panel, IPS, 1.65, { ry: -4 }) },
            { t: m('clicSuspender') - 26, cam: enfocar(panel, IPS, 1.7, { ry: -2 }) },
            { t: m('clicSuspender') + 2, cam: enfocar(panel, ACCIONES, 1.9) },
            { t: m('badge') + 14, cam: enfocar(panel, P.badge, 2.4) },
            { t: m('clicReactivar') - 22, cam: enfocar(panel, P.badge, 2.4, { ry: 3 }) },
            { t: m('clicReactivar') + 2, cam: enfocar(panel, ACCIONES, 2.0) },
            { t: m('salida'), cam: enfocar(panel, ACCIONES, 1.8, { ry: -3 }) },
            { t: fin, cam: enfocar(panel, { x: 640, y: 400 }, 0.7, { ry: -34 }), curva: 'entrada' },
        ],
        objetivo,
        0.8
    )

    return (
        <AbsoluteFill>
            <Escena3D camara={camara}>
                <Objeto3D x={panel.x} y={panel.y} z={panel.z} ry={panel.ry} nitidez={2} tamano={panel}>
                    <Panel
                        capas={[
                            { captura: ficha, opacidad: 1 },
                            { captura: suspendido, opacidad: suspendidoVisible },
                        ]}
                    >
                        <Halo punto={IPS} frame={frame} desde={m('ips') + 10} hasta={m('clicSuspender') - 20} margen={4} />
                        <EtiquetaNeon punto={IPS} frame={frame} desde={m('ips') + 18} hasta={m('clicSuspender') - 24} lado="abajo" distancia={36} tamano={18}>
                            {texto('etiquetaIps')}
                        </EtiquetaNeon>
                        <Halo
                            punto={suspendido.puntos.badge}
                            frame={frame}
                            desde={m('badge')}
                            hasta={m('clicReactivar')}
                            color={COLOR.magenta}
                            semilla="badge-suspendido"
                        />
                        <EtiquetaNeon
                            punto={suspendido.puntos.badge}
                            frame={frame}
                            desde={m('badge') + 10}
                            hasta={m('clicReactivar') - 6}
                            lado="izquierda"
                            distancia={70}
                            color={COLOR.magenta}
                            tamano={15}
                        >
                            {texto('etiquetaSuspendido')}
                        </EtiquetaNeon>
                        <Halo punto={P.badge} frame={frame} desde={m('clicReactivar') + 4} semilla="badge-activo" />
                        <EtiquetaNeon
                            punto={P.badge}
                            frame={frame}
                            desde={m('clicReactivar') + 12}
                            lado="izquierda"
                            distancia={70}
                            tamano={15}
                        >
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
