import { AbsoluteFill } from 'remotion'
import { Escena3D, Objeto3D } from '../camara/Escena3D'
import { CursorNeon, EtiquetaNeon, Halo, paso } from '../camara/Seguimiento'
import { type Colocacion, PERSPECTIVA, enfocar, orbita } from '../camara/camara'
import { Panel } from '../componentes/Paneles'
import { Leyenda, TituloSeccion } from '../componentes/Textos'
import { COLOR } from '../estilo/tema'
import { CAPTURAS, type IdCaptura } from '../guion'
import { type PropsEscena, camaraDeEscena, colocar, useEscena } from './comun'

const IDS: IdCaptura[] = ['portalCorte', 'portalCuenta', 'portalPdf']
const telefonos: Colocacion[] = IDS.map((id, i) => colocar(id, { x: (i - 1) * 640, y: 0, z: -Math.abs(i - 1) * 160, ry: -(i - 1) * 14 }))
const C = CAPTURAS.portalCorte.puntos
const K = CAPTURAS.portalCuenta.puntos
const D = CAPTURAS.portalPdf.puntos

/**
 * Encuadre de un teléfono a la derecha del cuadro (el texto va a la izquierda):
 * se apunta a un punto a la izquierda del teléfono.
 */
function encuadreTelefono(i: number, zoom: number, punto = { x: 195, y: 422 }, desvio = {}) {
    const corrimiento = 300 / zoom
    return enfocar(telefonos[i], { x: punto.x - corrimiento, y: punto.y }, zoom, desvio)
}

/** 7. Portal del cliente: página de corte en un teléfono, código, PDF del aviso y promesa aprobada. */
export function Portal({ escena }: PropsEscena) {
    const { frame, m, texto, fin } = useEscena(escena)

    const rutaCorte = [
        { t: 14, x: 230, y: 700 },
        paso(m('tocarCodigo'), C.codigo, true),
        paso(m('tocarEntrar'), C.entrar, true),
    ]
    const rutaCuenta = [
        { t: m('vueloCuenta') + 26, x: 250, y: 760 },
        paso(m('tocarSolicitar'), K.solicitar, true),
        paso(m('tocarPdf'), K.pdf, true),
    ]

    const camara = camaraDeEscena(
        frame,
        [
            { t: 0, cam: orbita({ x: -300, y: 0, z: 0 }, PERSPECTIVA * 1.5, -30, 8) },
            { t: 24, cam: encuadreTelefono(0, 0.98), curva: 'salida' },
            { t: m('tocarCodigo'), cam: encuadreTelefono(0, 1.2, { x: 195, y: 500 }) },
            { t: m('vueloCuenta'), cam: encuadreTelefono(0, 1.2, { x: 195, y: 510 }, { ry: 2 }) },
            { t: m('vueloCuenta') + 24, cam: encuadreTelefono(1, 0.98) },
            { t: m('promesa') + 6, cam: encuadreTelefono(1, 1.25, { x: 195, y: 420 }) },
            { t: m('vueloPdf'), cam: encuadreTelefono(1, 1.2, { x: 195, y: 500 }, { ry: -2 }) },
            { t: m('vueloPdf') + 24, cam: encuadreTelefono(2, 0.98) },
            { t: m('salida'), cam: encuadreTelefono(2, 1.04, undefined, { ry: 3 }) },
            { t: fin, cam: encuadreTelefono(2, 0.7, undefined, { ry: 30 }), curva: 'entrada' },
        ],
        undefined,
        0.7
    )

    return (
        <AbsoluteFill>
            <Escena3D camara={camara}>
                {telefonos.map((t, i) => (
                    <Objeto3D key={IDS[i]} x={t.x} y={t.y} z={t.z} ry={t.ry} nitidez={2} tamano={t}>
                        <Panel capas={[{ captura: CAPTURAS[IDS[i]], opacidad: 1 }]}>
                            {i === 0 ? (
                                <>
                                    <Halo punto={C.codigo} frame={frame} desde={m('tocarCodigo')} hasta={m('vueloCuenta')} />
                                    <EtiquetaNeon punto={C.codigo} frame={frame} desde={m('tocarCodigo') + 6} hasta={m('vueloCuenta')} lado="arriba" distancia={40} tamano={18}>
                                        {texto('etiquetaCodigo')}
                                    </EtiquetaNeon>
                                    <CursorNeon ruta={rutaCorte} frame={frame} variante="dedo" hasta={m('vueloCuenta')} />
                                </>
                            ) : null}
                            {i === 1 ? (
                                <>
                                    <Halo punto={K.promesa} frame={frame} desde={m('promesa')} hasta={m('vueloPdf')} radio={18} semilla="promesa" />
                                    <EtiquetaNeon punto={K.promesa} frame={frame} desde={m('promesa') + 8} hasta={m('tocarPdf') - 4} lado="arriba" distancia={44} tamano={17}>
                                        {texto('etiquetaPromesa')}
                                    </EtiquetaNeon>
                                    <Halo punto={K.pdf} frame={frame} desde={m('tocarPdf')} hasta={m('vueloPdf') + 10} color={COLOR.magenta} />
                                    <CursorNeon ruta={rutaCuenta} frame={frame} variante="dedo" hasta={m('vueloPdf')} />
                                </>
                            ) : null}
                            {i === 2 ? (
                                <EtiquetaNeon punto={D.documento} frame={frame} desde={m('vueloPdf') + 20} lado="arriba" distancia={34} tamano={20} color={COLOR.magenta}>
                                    {texto('etiquetaPdf')}
                                </EtiquetaNeon>
                            ) : null}
                        </Panel>
                    </Objeto3D>
                ))}
            </Escena3D>
            <TituloSeccion seccion={texto('seccion')} titulo={texto('titulo')} frame={frame} hasta={m('salida')} />
            {/* La leyenda ocupa solo la mitad izquierda: el teléfono está a la derecha. */}
            <Leyenda texto={texto('leyenda')} frame={frame} desde={20} hasta={m('salida')} anchoMaximo={820} />
        </AbsoluteFill>
    )
}

