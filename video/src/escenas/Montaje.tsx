import { AbsoluteFill } from 'remotion'
import { Escena3D, Objeto3D } from '../camara/Escena3D'
import { EtiquetaNeon, Halo, type Lado } from '../camara/Seguimiento'
import { type Clave, type Colocacion, PERSPECTIVA, enfocar, encuadrar, orbita } from '../camara/camara'
import { Panel } from '../componentes/Paneles'
import { TituloSeccion } from '../componentes/Textos'
import { COLOR } from '../estilo/tema'
import { CAPTURAS, type IdCaptura, type PuntoInteres } from '../guion'
import { type PropsEscena, camaraDeEscena, colocar, useEscena } from './comun'

/** Paneles del montaje, en orden, con su punto de interés y la clave de su texto. */
const PANELES: { id: IdCaptura; punto: PuntoInteres; texto: string; color: string; lado?: Lado }[] = [
    { id: 'caja', punto: CAPTURAS.caja.puntos.esperado, texto: 'caja', color: COLOR.cian },
    { id: 'promesas', punto: CAPTURAS.promesas.puntos.aprobada, texto: 'promesas', color: COLOR.violeta, lado: 'izquierda' },
    { id: 'facturas', punto: CAPTURAS.facturas.puntos.recargo, texto: 'facturas', color: COLOR.magenta },
    { id: 'libro', punto: CAPTURAS.libro.puntos.cuadre, texto: 'libro', color: COLOR.cian },
    { id: 'bitacora', punto: CAPTURAS.bitacora.puntos.fila, texto: 'bitacora', color: COLOR.violeta },
]

/** Los paneles van sobre un arco cóncavo (radio R, centro delante) mirando a su centro. */
const R = 3000
const PASO_ANGULO = 28
const colocaciones: Colocacion[] = PANELES.map((p, i) => {
    const phi = (i - 2) * PASO_ANGULO
    const a = (phi * Math.PI) / 180
    return colocar(p.id, { x: R * Math.sin(a), y: 30, z: R - R * Math.cos(a), ry: -phi })
})

/** 6. Caja, promesas, facturas, libro y bitácora: montaje en 3D con la cámara pasando entre paneles. */
export function Montaje({ escena }: PropsEscena) {
    const { frame, m, texto, fin } = useEscena(escena)
    const intervalo = m('intervalo')
    const llegada = (i: number) => m('primerPanel') + i * intervalo + 18

    const claves: Clave[] = [
        // Plano general del arco, desde atrás y arriba.
        { t: 0, cam: orbita({ x: 0, y: 30, z: 900 }, PERSPECTIVA * 3.2, 0, 12) },
        { t: m('primerPanel'), cam: orbita({ x: 0, y: 30, z: 900 }, PERSPECTIVA * 2.8, -6, 9) },
    ]
    PANELES.forEach((p, i) => {
        const panel = colocaciones[i]
        claves.push({ t: llegada(i), cam: encuadrar(panel, 0.82, { ry: 6 }), curva: 'suave' })
        claves.push({ t: llegada(i) + 24, cam: enfocar(panel, p.punto, 1.55), curva: 'salida' })
        claves.push({ t: m('primerPanel') + (i + 1) * intervalo, cam: enfocar(panel, p.punto, 1.62, { ry: -2 }) })
    })
    const ultimo = colocaciones[colocaciones.length - 1]
    claves.push({ t: fin, cam: encuadrar(ultimo, 0.6, { ry: 30 }), curva: 'entrada' })
    const camara = camaraDeEscena(frame, claves.filter((c, i) => i === 0 || c.t > claves[i - 1].t), undefined, 0.7)

    return (
        <AbsoluteFill>
            <Escena3D camara={camara}>
                {PANELES.map((p, i) => {
                    const panel = colocaciones[i]
                    const desde = llegada(i) + 10
                    const hasta = m('primerPanel') + (i + 1) * intervalo - 6
                    return (
                        <Objeto3D key={p.id} x={panel.x} y={panel.y} z={panel.z} ry={panel.ry} nitidez={2} tamano={panel}>
                            <Panel capas={[{ captura: CAPTURAS[p.id], opacidad: 1 }]}>
                                <Halo punto={p.punto} frame={frame} desde={desde} hasta={hasta} color={p.color} semilla={p.id} />
                                <EtiquetaNeon
                                    punto={p.punto}
                                    frame={frame}
                                    desde={desde + 8}
                                    hasta={hasta}
                                    lado={p.lado ?? (p.punto.y > 500 ? 'arriba' : 'abajo')}
                                    distancia={44}
                                    color={p.color}
                                    tamano={20}
                                >
                                    {texto(p.texto)}
                                </EtiquetaNeon>
                            </Panel>
                        </Objeto3D>
                    )
                })}
            </Escena3D>
            <TituloSeccion seccion={texto('seccion')} titulo={texto('titulo')} frame={frame} hasta={m('salida')} />
        </AbsoluteFill>
    )
}
