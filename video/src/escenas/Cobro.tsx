import { AbsoluteFill } from 'remotion'
import { Escena3D, Objeto3D } from '../camara/Escena3D'
import { CursorNeon, EtiquetaNeon, Halo, paso, posicionCursor } from '../camara/Seguimiento'
import { PERSPECTIVA, enfocar, encuadrar, orbita, puntoEnMundo } from '../camara/camara'
import { Panel } from '../componentes/Paneles'
import { Leyenda, TituloSeccion } from '../componentes/Textos'
import { COLOR } from '../estilo/tema'
import { CAPTURAS } from '../guion'
import { type PropsEscena, camaraDeEscena, colocar, useEscena } from './comun'

const facturas = CAPTURAS.cobroFacturas
const recibo = CAPTURAS.cobroRecibo
const P = facturas.puntos
const R = recibo.puntos
const panelFacturas = colocar('cobroFacturas', { y: 30 })
const panelRecibo = colocar('cobroRecibo', { x: 2050, y: 30, z: -420, ry: -32 })
const METODOS = [P.efectivo, P.deposito, P.transferencia, P.ach, P.remesa]
const CENTRO_METODOS = { x: 1000, y: 326 }
const CENTRO_PAGO = { x: 1000, y: 610 }
/** Recibo y badge "Servicio reactivado" a la vez. */
const VISTA_RECIBO = { x: 640, y: 400 }

/** 4. Cobro rápido: buscar, marcar facturas (también de un familiar), método, recibo y reactivación. */
export function Cobro({ escena }: PropsEscena) {
    const { frame, m, texto, fin } = useEscena(escena)

    const ruta = [
        { t: m('clicBuscar') - 14, x: 700, y: 520 },
        paso(m('clicBuscar'), P.buscar, true, { x: 60, y: 0 }),
        paso(m('clicFactura1'), P.factura1, true, { x: -180, y: 0 }),
        paso(m('clicFactura2'), P.factura2, true, { x: -180, y: 0 }),
        paso(m('clicFamiliar'), P.familiar, true, { x: -180, y: 0 }),
        paso(m('metodos') + 4, P.efectivo, false, { x: 0, y: 30 }),
        paso(m('clicMetodo'), P.transferencia, true),
        paso(m('clicCobrar'), P.cobrar, true),
    ]
    const objetivo = puntoEnMundo(panelFacturas, posicionCursor(ruta, frame - 5))

    // El halo recorre los cinco métodos de pago y se queda en "Transferencia".
    const pasoMetodo = Math.round((m('clicMetodo') - m('metodos')) / (METODOS.length + 1))

    const general = encuadrar(panelFacturas, 0.78)
    const generalDesplazada = { ...general, x: general.x - 60, y: general.y - 90 }
    const camara = camaraDeEscena(
        frame,
        [
            { t: 0, cam: orbita({ x: 0, y: 30, z: 0 }, PERSPECTIVA * 1.5, -26, -6) },
            { t: m('clicBuscar') - 16, cam: generalDesplazada, curva: 'salida' },
            { t: m('clicBuscar') + 4, cam: enfocar(panelFacturas, P.buscar, 1.6), seguir: 0.85 },
            { t: m('clicFamiliar') + 10, cam: enfocar(panelFacturas, P.familiar, 1.6), seguir: 0.85 },
            { t: m('metodos') + 8, cam: enfocar(panelFacturas, CENTRO_METODOS, 1.85) },
            { t: m('clicMetodo') + 8, cam: enfocar(panelFacturas, CENTRO_METODOS, 1.9, { ry: 3 }) },
            { t: m('clicCobrar') + 2, cam: enfocar(panelFacturas, CENTRO_PAGO, 1.6) },
            { t: m('vuelo'), cam: enfocar(panelFacturas, CENTRO_PAGO, 1.5, { ry: -2 }) },
            { t: m('reactivado') - 16, cam: encuadrar(panelRecibo, 0.85), curva: 'suave' },
            { t: m('reactivado') + 8, cam: enfocar(panelRecibo, VISTA_RECIBO, 1.22) },
            { t: m('salida'), cam: enfocar(panelRecibo, VISTA_RECIBO, 1.18, { ry: 4 }) },
            { t: fin, cam: enfocar(panelRecibo, { x: 640, y: 400 }, 0.7, { ry: 30 }), curva: 'entrada' },
        ],
        objetivo
    )

    return (
        <AbsoluteFill>
            <Escena3D camara={camara}>
                <Objeto3D x={panelFacturas.x} y={panelFacturas.y} z={panelFacturas.z} ry={panelFacturas.ry} nitidez={2} tamano={panelFacturas}>
                    <Panel capas={[{ captura: facturas, opacidad: 1 }]}>
                        <Halo punto={P.buscar} frame={frame} desde={m('clicBuscar')} hasta={m('clicFactura1') - 4} />
                        <Halo punto={P.factura1} frame={frame} desde={m('clicFactura1')} hasta={m('metodos')} margen={4} />
                        <Halo punto={P.factura2} frame={frame} desde={m('clicFactura2')} hasta={m('metodos')} margen={4} />
                        <Halo punto={P.familiar} frame={frame} desde={m('clicFamiliar')} hasta={m('metodos')} margen={4} color={COLOR.violeta} />
                        <EtiquetaNeon
                            punto={P.familiar}
                            frame={frame}
                            desde={m('clicFamiliar') + 6}
                            hasta={m('metodos') - 4}
                            lado="abajo"
                            distancia={40}
                            color={COLOR.violeta}
                            tamano={17}
                        >
                            {texto('etiquetaFamiliar')}
                        </EtiquetaNeon>
                        {METODOS.map((metodo, i) => {
                            const desde = m('metodos') + i * pasoMetodo
                            const esElegido = metodo === P.transferencia
                            return (
                                <Halo
                                    key={metodo.texto}
                                    punto={metodo}
                                    frame={frame}
                                    desde={esElegido ? m('clicMetodo') : desde}
                                    hasta={esElegido ? m('vuelo') : desde + pasoMetodo}
                                    margen={4}
                                    radio={22}
                                    semilla={`metodo-${i}`}
                                />
                            )
                        })}
                        <EtiquetaNeon
                            punto={{ ...P.deposito, x: 1000, y: 300, alto: 38 }}
                            frame={frame}
                            desde={m('metodos') + 6}
                            hasta={m('clicCobrar') - 10}
                            lado="arriba"
                            distancia={46}
                            tamano={16}
                        >
                            {texto('etiquetaMetodos')}
                        </EtiquetaNeon>
                        <Halo punto={P.cobrar} frame={frame} desde={m('clicCobrar')} hasta={m('vuelo') + 6} color={COLOR.magenta} />
                        <CursorNeon ruta={ruta} frame={frame} hasta={m('vuelo')} />
                    </Panel>
                </Objeto3D>
                <Objeto3D x={panelRecibo.x} y={panelRecibo.y} z={panelRecibo.z} ry={panelRecibo.ry} nitidez={2} tamano={panelRecibo}>
                    <Panel capas={[{ captura: recibo, opacidad: 1 }]}>
                        <EtiquetaNeon punto={R.recibo} frame={frame} desde={m('reactivado') - 14} hasta={m('reactivado') + 4} lado="arriba" distancia={30} tamano={20}>
                            {texto('etiquetaRecibo')}
                        </EtiquetaNeon>
                        <Halo punto={R.reactivado} frame={frame} desde={m('reactivado')} radio={20} semilla="reactivado" />
                        <EtiquetaNeon punto={R.reactivado} frame={frame} desde={m('reactivado') + 8} lado="abajo" distancia={34} tamano={17}>
                            {texto('etiquetaReactivado')}
                        </EtiquetaNeon>
                    </Panel>
                </Objeto3D>
            </Escena3D>
            <TituloSeccion seccion={texto('seccion')} titulo={texto('titulo')} frame={frame} hasta={m('salida')} />
            <Leyenda texto={texto('leyenda')} frame={frame} desde={m('clicBuscar') - 10} hasta={m('vuelo')} />
        </AbsoluteFill>
    )
}
