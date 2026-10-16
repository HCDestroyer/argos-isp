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

/** 2. Clientes: chip "Cortados" (la cámara lo sigue), filtro aplicado y la lista resultante. */
export function Clientes({ escena }: PropsEscena) {
    const { frame, m, texto, fin } = useEscena(escena)

    const ruta = [
        { t: m('vista') + 6, x: 700, y: 560 },
        paso(m('clicCortados'), P.chipCortados, true),
        paso(m('filtro'), P.filtroEstado, true, { x: 60, y: 0 }),
        { t: m('tabla') + 4, x: P.tabla.x - 240, y: P.tabla.y - 80 },
        { t: m('alejar') + 10, x: 820, y: 560 },
    ]
    const objetivo = puntoEnMundo(panel, posicionCursor(ruta, frame - 4))

    const general = encuadrar(panel, 0.78, {})
    const generalDesplazada = { ...general, x: general.x - 60, y: general.y - 90 }
    const camara = camaraDeEscena(
        frame,
        [
            { t: 0, cam: orbita({ x: 0, y: 30, z: 0 }, PERSPECTIVA * 1.5, -32, 8) },
            { t: m('vista'), cam: generalDesplazada, curva: 'salida' },
            { t: m('clicCortados') - 18, cam: generalDesplazada },
            { t: m('clicCortados') + 2, cam: enfocar(panel, P.chipCortados, 1.85) },
            { t: m('seguir') + 30, cam: enfocar(panel, P.chipCortados, 1.85), seguir: 0.6 },
            { t: m('filtro') + 4, cam: enfocar(panel, P.filtroEstado, 1.6), seguir: 0.6 },
            { t: m('tabla') + 14, cam: enfocar(panel, P.tabla, 1.3) },
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
                        <Halo punto={P.chipCortados} frame={frame} desde={m('clicCortados')} hasta={m('alejar')} color={COLOR.magenta} radio={14} />
                        <EtiquetaNeon
                            punto={P.chipCortados}
                            frame={frame}
                            desde={m('clicCortados') + 8}
                            hasta={m('filtro') - 10}
                            lado="derecha"
                            distancia={40}
                            color={COLOR.magenta}
                            tamano={16}
                        >
                            {P.chipCortados.texto}
                        </EtiquetaNeon>
                        <Halo punto={P.filtroEstado} frame={frame} desde={m('filtro')} hasta={m('alejar')} />
                        <EtiquetaNeon punto={P.filtroEstado} frame={frame} desde={m('filtro') + 8} hasta={m('tabla') - 6} lado="derecha" distancia={40} tamano={16}>
                            {P.filtroEstado.texto}
                        </EtiquetaNeon>
                        <Halo punto={P.tabla} frame={frame} desde={m('tabla')} hasta={m('salida')} color={COLOR.violeta} margen={4} />
                        <EtiquetaNeon punto={P.tabla} frame={frame} desde={m('tabla') + 8} hasta={m('salida')} lado="arriba" distancia={20} color={COLOR.violeta} tamano={17}>
                            {P.tabla.texto}
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
