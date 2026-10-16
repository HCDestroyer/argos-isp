import { AbsoluteFill } from 'remotion'
import { Escena3D, Objeto3D } from '../camara/Escena3D'
import { CursorNeon, EtiquetaNeon, Halo, paso, posicionCursor } from '../camara/Seguimiento'
import { enfocar, encuadrar, orbita, puntoEnMundo, PERSPECTIVA } from '../camara/camara'
import { Panel } from '../componentes/Paneles'
import { Leyenda, TituloSeccion } from '../componentes/Textos'
import { COLOR } from '../estilo/tema'
import { CAPTURAS } from '../guion'
import { type PropsEscena, camaraDeEscena, colocar, useEscena } from './comun'

const captura = CAPTURAS.clientesFiltros
const P = captura.puntos
const panel = colocar('clientesFiltros', { y: 30 })

/** 2. Clientes: filtros avanzados; la cámara sigue el chip "Cortados". */
export function Clientes({ escena }: PropsEscena) {
    const { frame, m, texto, fin } = useEscena(escena)

    const ruta = [
        { t: m('vista') + 6, x: 760, y: 560 },
        paso(m('clicCortados'), P.chipCortados, true),
        paso(m('clicRouter'), P.filtroRouter, true),
        paso(m('clicPlan'), P.filtroPlan, true),
        { t: m('alejar') + 10, x: 820, y: 430 },
    ]
    const cursor = posicionCursor(ruta, frame - 4)
    const objetivo = puntoEnMundo(panel, cursor)

    const general = encuadrar(panel, 0.78, {})
    const generalDesplazada = { ...general, x: general.x - 60, y: general.y - 90 }
    const camara = camaraDeEscena(
        frame,
        [
            { t: 0, cam: orbita({ x: 0, y: 30, z: 0 }, PERSPECTIVA * 1.5, -32, 8) },
            { t: m('vista'), cam: generalDesplazada, curva: 'salida' },
            { t: m('clicCortados') - 18, cam: generalDesplazada },
            { t: m('clicCortados') + 2, cam: enfocar(panel, P.chipCortados, 1.85) },
            { t: m('seguir') + 30, cam: enfocar(panel, P.chipCortados, 1.85) },
            { t: m('clicRouter') - 8, cam: enfocar(panel, P.filtroRouter, 1.55), seguir: 1 },
            { t: m('clicPlan') + 14, cam: enfocar(panel, P.filtroPlan, 1.55), seguir: 1 },
            { t: m('alejar') + 16, cam: enfocar(panel, { x: 700, y: 420 }, 0.95, { ry: 5 }) },
            { t: m('salida'), cam: enfocar(panel, { x: 700, y: 420 }, 1.0, { ry: 8 }) },
            { t: fin, cam: enfocar(panel, { x: 700, y: 420 }, 0.7, { ry: 34 }), curva: 'entrada' },
        ],
        objetivo,
        1,
        panel
    )

    return (
        <AbsoluteFill>
            <Escena3D camara={camara}>
                <Objeto3D x={panel.x} y={panel.y} z={panel.z} ry={panel.ry} nitidez={2} tamano={panel}>
                    <Panel capas={[{ captura, opacidad: 1 }]}>
                        <Halo punto={P.chipCortados} frame={frame} desde={m('clicCortados')} hasta={m('clicRouter') + 20} color={COLOR.magenta} />
                        <Halo punto={P.filtroRouter} frame={frame} desde={m('clicRouter')} hasta={m('alejar')} />
                        <Halo punto={P.filtroPlan} frame={frame} desde={m('clicPlan')} hasta={m('alejar')} />
                        <EtiquetaNeon
                            punto={P.chipCortados}
                            frame={frame}
                            desde={m('clicCortados') + 8}
                            hasta={m('clicRouter') - 12}
                            lado="abajo"
                            distancia={44}
                            color={COLOR.magenta}
                            tamano={17}
                        >
                            {texto('etiquetaCortados')}
                        </EtiquetaNeon>
                        <EtiquetaNeon
                            punto={P.filtroPlan}
                            frame={frame}
                            desde={m('clicPlan') + 8}
                            hasta={m('alejar') + 10}
                            lado="abajo"
                            distancia={48}
                            tamano={18}
                        >
                            {texto('etiquetaFiltros')}
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
