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
/** Columna del formulario de pago. */
const FORMULARIO = { x: 1000, y: 420 }
/** Recibo: badges de la izquierda y el detalle de la derecha a la vez. */
const VISTA_RECIBO = { x: 760, y: 470 }

/** 4. Cobro rápido: facturas marcadas (también las de un familiar), monto, método, recibo y reactivación. */
export function Cobro({ escena }: PropsEscena) {
    const { frame, m, texto, fin } = useEscena(escena)

    const ruta = [
        { t: m('clicFacturas') - 14, x: 700, y: 520 },
        paso(m('clicFacturas'), { ...P.facturasCliente, x: 287, y: 151 }, true),
        paso(m('dependiente'), { ...P.dependiente, x: 285, y: 358 }, true),
        paso(m('monto'), P.monto, false, { x: 60, y: 0 }),
        paso(m('metodo'), P.metodo, true, { x: 120, y: 0 }),
        paso(m('transferencia'), P.transferencia, false, { x: 80, y: 30 }),
        paso(m('clicRegistrar'), P.registrar, true),
    ]
    const objetivo = puntoEnMundo(panelFacturas, posicionCursor(ruta, frame - 5))

    const general = encuadrar(panelFacturas, 0.78)
    const generalDesplazada = { ...general, x: general.x - 60, y: general.y - 90 }
    const camara = camaraDeEscena(
        frame,
        [
            { t: 0, cam: orbita({ x: 0, y: 30, z: 0 }, PERSPECTIVA * 1.5, -26, -6) },
            { t: m('clicFacturas') - 16, cam: generalDesplazada, curva: 'salida' },
            { t: m('clicFacturas') + 6, cam: enfocar(panelFacturas, P.facturasCliente, 1.45) },
            { t: m('dependiente') + 10, cam: enfocar(panelFacturas, P.dependiente, 1.5) },
            { t: m('monto') + 8, cam: enfocar(panelFacturas, FORMULARIO, 1.5) },
            { t: m('transferencia') + 8, cam: enfocar(panelFacturas, FORMULARIO, 1.55, { ry: 3 }) },
            { t: m('clicRegistrar') + 2, cam: enfocar(panelFacturas, P.registrar, 1.5) },
            { t: m('vuelo'), cam: enfocar(panelFacturas, P.registrar, 1.45, { ry: -2 }) },
            { t: m('reactivado') - 16, cam: encuadrar(panelRecibo, 0.85), curva: 'suave' },
            { t: m('reactivado') + 8, cam: enfocar(panelRecibo, VISTA_RECIBO, 1.25) },
            { t: m('salida'), cam: enfocar(panelRecibo, VISTA_RECIBO, 1.2, { ry: 4 }) },
            { t: fin, cam: enfocar(panelRecibo, { x: 640, y: 400 }, 0.7, { ry: 30 }), curva: 'entrada' },
        ],
        objetivo
    )

    return (
        <AbsoluteFill>
            <Escena3D camara={camara}>
                <Objeto3D x={panelFacturas.x} y={panelFacturas.y} z={panelFacturas.z} ry={panelFacturas.ry} nitidez={2} tamano={panelFacturas}>
                    <Panel capas={[{ captura: facturas, opacidad: 1 }]}>
                        <Halo punto={P.facturasCliente} frame={frame} desde={m('clicFacturas')} hasta={m('monto')} margen={4} />
                        <EtiquetaNeon punto={P.facturasCliente} frame={frame} desde={m('clicFacturas') + 6} hasta={m('dependiente') - 4} lado="derecha" distancia={30} tamano={16}>
                            {texto('etiquetaFacturas')}
                        </EtiquetaNeon>
                        <Halo punto={P.dependiente} frame={frame} desde={m('dependiente')} hasta={m('monto')} margen={4} color={COLOR.violeta} />
                        <EtiquetaNeon
                            punto={P.dependiente}
                            frame={frame}
                            desde={m('dependiente') + 6}
                            hasta={m('monto') - 4}
                            lado="abajo"
                            distancia={36}
                            color={COLOR.violeta}
                            tamano={16}
                        >
                            {P.dependiente.texto}
                        </EtiquetaNeon>
                        <Halo punto={P.monto} frame={frame} desde={m('monto')} hasta={m('metodo')} margen={4} />
                        <EtiquetaNeon punto={P.monto} frame={frame} desde={m('monto') + 6} hasta={m('metodo') - 4} lado="izquierda" distancia={30} tamano={15}>
                            {P.monto.texto}
                        </EtiquetaNeon>
                        <Halo punto={P.metodo} frame={frame} desde={m('metodo')} hasta={m('transferencia')} margen={4} color={COLOR.magenta} />
                        <EtiquetaNeon punto={P.metodo} frame={frame} desde={m('metodo') + 6} hasta={m('transferencia') - 4} lado="abajo" distancia={22} tamano={15} color={COLOR.magenta}>
                            {texto('etiquetaMetodos')}
                        </EtiquetaNeon>
                        <Halo punto={P.transferencia} frame={frame} desde={m('transferencia')} hasta={m('clicRegistrar')} margen={4} />
                        <EtiquetaNeon punto={P.transferencia} frame={frame} desde={m('transferencia') + 6} hasta={m('clicRegistrar') - 4} lado="izquierda" distancia={30} tamano={15}>
                            {P.transferencia.texto}
                        </EtiquetaNeon>
                        <Halo punto={P.registrar} frame={frame} desde={m('clicRegistrar')} hasta={m('vuelo') + 6} color={COLOR.magenta} />
                        <CursorNeon ruta={ruta} frame={frame} hasta={m('vuelo')} />
                    </Panel>
                </Objeto3D>
                <Objeto3D x={panelRecibo.x} y={panelRecibo.y} z={panelRecibo.z} ry={panelRecibo.ry} nitidez={2} tamano={panelRecibo}>
                    <Panel capas={[{ captura: recibo, opacidad: 1 }]}>
                        <Halo punto={R.reactivados} frame={frame} desde={m('reactivado')} margen={4} semilla="reactivado" />
                        <EtiquetaNeon punto={R.reactivados} frame={frame} desde={m('reactivado') + 8} lado="izquierda" distancia={30} tamano={16}>
                            {R.reactivados.texto}
                        </EtiquetaNeon>
                        <Halo punto={R.badge} frame={frame} desde={m('badge')} color={COLOR.magenta} semilla="reactivado-badge" />
                        <EtiquetaNeon punto={R.badge} frame={frame} desde={m('badge') + 8} lado="abajo" distancia={44} tamano={16} color={COLOR.magenta}>
                            {R.badge.texto}
                        </EtiquetaNeon>
                    </Panel>
                </Objeto3D>
            </Escena3D>
            <TituloSeccion seccion={texto('seccion')} titulo={texto('titulo')} frame={frame} hasta={m('salida')} />
            <Leyenda texto={texto('leyenda')} frame={frame} desde={m('clicFacturas') - 10} hasta={m('vuelo')} />
        </AbsoluteFill>
    )
}
