import { AbsoluteFill } from 'remotion'
import { Escena3D, Objeto3D } from '../camara/Escena3D'
import { CursorNeon, EtiquetaNeon, Halo, paso } from '../camara/Seguimiento'
import { type Colocacion, PERSPECTIVA, enfocar, orbita } from '../camara/camara'
import { Panel } from '../componentes/Paneles'
import { Leyenda, TituloSeccion } from '../componentes/Textos'
import { COLOR } from '../estilo/tema'
import { CAPTURAS } from '../guion'
import { type PropsEscena, camaraDeEscena, colocar, useEscena } from './comun'

/**
 * Cuatro pantallas en el espacio: dos teléfonos (corte y promesa aprobada) y
 * dos de escritorio (mi cuenta y el PDF del aviso), en un arco suave.
 */
const corte = colocar('portalCorte', { x: -1500, y: 0, z: -200, ry: 16 })
const promesa = colocar('portalPromesa', { x: -900, y: 0, z: -60, ry: 8 })
const cuenta = colocar('portalCuenta', { x: 300, y: 0, z: 0, ry: 0 })
const pdf = colocar('portalPdf', { x: 1800, y: 0, z: -260, ry: -14 })
const PANTALLAS: { id: 'portalCorte' | 'portalPromesa' | 'portalCuenta' | 'portalPdf'; panel: Colocacion }[] = [
    { id: 'portalCorte', panel: corte },
    { id: 'portalPromesa', panel: promesa },
    { id: 'portalCuenta', panel: cuenta },
    { id: 'portalPdf', panel: pdf },
]
const C = CAPTURAS.portalCorte.puntos
const A = CAPTURAS.portalPromesa.puntos
const K = CAPTURAS.portalCuenta.puntos
const D = CAPTURAS.portalPdf.puntos

/** Teléfono a la derecha del cuadro (título y leyenda a la izquierda). */
function encuadreTelefono(panel: Colocacion, zoom: number, punto = { x: 195, y: 422 }, desvio = {}) {
    const corrimiento = 300 / zoom
    return enfocar(panel, { x: punto.x - corrimiento, y: punto.y }, zoom, desvio)
}
/** Escritorio un poco abajo del centro (bajo el título). */
function encuadreEscritorio(panel: Colocacion, zoom: number, punto = { x: 640, y: 400 }, desvio = {}) {
    return enfocar(panel, { x: punto.x, y: punto.y - 60 / zoom }, zoom, desvio)
}

/** 7. Portal del cliente: página de corte, promesa aprobada, mi cuenta y el PDF del aviso. */
export function Portal({ escena }: PropsEscena) {
    const { frame, m, texto, fin } = useEscena(escena)

    const rutaCorte = [{ t: m('monto') + 6, x: 300, y: 700 }, paso(m('tocarPromesa'), C.promesa, true, { x: 40, y: 0 })]
    const rutaCuenta = [{ t: m('vueloCuenta') + 24, x: 760, y: 700 }, paso(m('tocarPdf'), K.pdf, true, { x: 30, y: 0 })]

    const camara = camaraDeEscena(
        frame,
        [
            { t: 0, cam: orbita({ x: -1500, y: 0, z: -200 }, PERSPECTIVA * 1.5, -30, 8) },
            { t: 20, cam: encuadreTelefono(corte, 1.0), curva: 'salida' },
            { t: m('tocarPromesa'), cam: encuadreTelefono(corte, 1.12, { x: 195, y: 440 }) },
            { t: m('vueloPromesa') + 18, cam: encuadreTelefono(promesa, 1.02) },
            { t: m('vueloCuenta'), cam: encuadreTelefono(promesa, 1.15, { x: 195, y: 330 }, { ry: 2 }) },
            { t: m('vueloCuenta') + 26, cam: encuadreEscritorio(cuenta, 0.95) },
            { t: m('tocarPdf') + 4, cam: encuadreEscritorio(cuenta, 1.3, { x: 600, y: 470 }) },
            { t: m('vueloPdf') + 22, cam: encuadreEscritorio(pdf, 1.0) },
            { t: m('salida'), cam: encuadreEscritorio(pdf, 1.25, { x: 680, y: 300 }, { ry: 3 }) },
            { t: fin, cam: encuadreEscritorio(pdf, 0.7, undefined, { ry: 30 }), curva: 'entrada' },
        ],
        undefined,
        0.7
    )

    return (
        <AbsoluteFill>
            <Escena3D camara={camara}>
                {PANTALLAS.map(({ id, panel }) => (
                    <Objeto3D key={id} x={panel.x} y={panel.y} z={panel.z} ry={panel.ry} nitidez={2} tamano={panel}>
                        <Panel capas={[{ captura: CAPTURAS[id], opacidad: 1 }]}>
                            {id === 'portalCorte' ? (
                                <>
                                    <Halo punto={C.monto} frame={frame} desde={m('monto')} hasta={m('vueloPromesa')} margen={6} />
                                    <EtiquetaNeon punto={C.monto} frame={frame} desde={m('monto') + 6} hasta={m('tocarPromesa') - 6} lado="izquierda" distancia={40} tamano={17}>
                                        {texto('etiquetaMonto')}
                                    </EtiquetaNeon>
                                    <Halo punto={C.promesa} frame={frame} desde={m('tocarPromesa')} hasta={m('vueloPromesa') + 10} color={COLOR.magenta} />
                                    <EtiquetaNeon punto={C.promesa} frame={frame} desde={m('tocarPromesa') + 4} hasta={m('vueloPromesa') + 10} lado="abajo" distancia={34} tamano={17} color={COLOR.magenta}>
                                        {texto('etiquetaPromesa')}
                                    </EtiquetaNeon>
                                    <CursorNeon ruta={rutaCorte} frame={frame} variante="dedo" hasta={m('vueloPromesa')} />
                                </>
                            ) : null}
                            {id === 'portalPromesa' ? (
                                <>
                                    <Halo punto={A.aprobada} frame={frame} desde={m('aprobada')} hasta={m('vueloCuenta') + 10} semilla="aprobada" />
                                    <EtiquetaNeon punto={A.aprobada} frame={frame} desde={m('aprobada') + 8} hasta={m('vueloCuenta') + 10} lado="derecha" distancia={40} tamano={17}>
                                        {texto('etiquetaAprobada')}
                                    </EtiquetaNeon>
                                </>
                            ) : null}
                            {id === 'portalCuenta' ? (
                                <>
                                    <Halo punto={K.saldo} frame={frame} desde={m('vueloCuenta') + 26} hasta={m('tocarPdf') - 6} margen={6} semilla="saldo" />
                                    <EtiquetaNeon punto={K.saldo} frame={frame} desde={m('vueloCuenta') + 32} hasta={m('tocarPdf') - 8} lado="derecha" distancia={40} tamano={17}>
                                        {K.saldo.texto}
                                    </EtiquetaNeon>
                                    <Halo punto={K.pdf} frame={frame} desde={m('tocarPdf')} hasta={m('vueloPdf') + 10} color={COLOR.magenta} />
                                    <EtiquetaNeon punto={K.pdf} frame={frame} desde={m('tocarPdf') + 4} hasta={m('vueloPdf') + 10} lado="derecha" distancia={40} tamano={16} color={COLOR.magenta}>
                                        {texto('etiquetaPdf')}
                                    </EtiquetaNeon>
                                    <CursorNeon ruta={rutaCuenta} frame={frame} hasta={m('vueloPdf')} />
                                </>
                            ) : null}
                            {id === 'portalPdf' ? (
                                <>
                                    <Halo punto={D.saldo} frame={frame} desde={m('saldo')} margen={6} color={COLOR.magenta} semilla="saldo-pdf" />
                                    <EtiquetaNeon punto={D.saldo} frame={frame} desde={m('saldo') + 8} lado="abajo" distancia={40} tamano={17} color={COLOR.magenta}>
                                        {texto('etiquetaSaldo')}
                                    </EtiquetaNeon>
                                </>
                            ) : null}
                        </Panel>
                    </Objeto3D>
                ))}
            </Escena3D>
            <TituloSeccion seccion={texto('seccion')} titulo={texto('titulo')} frame={frame} hasta={m('salida')} />
            {/* Leyenda solo con los teléfonos (que están a la derecha). */}
            <Leyenda texto={texto('leyenda')} frame={frame} desde={20} hasta={m('vueloCuenta')} anchoMaximo={820} />
        </AbsoluteFill>
    )
}
