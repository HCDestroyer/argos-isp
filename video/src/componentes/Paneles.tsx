import type { ReactNode } from 'react'
import { Img, staticFile } from 'remotion'
import type { Captura } from '../guion'
import { COLOR, FUENTE } from '../estilo/tema'

/** Ruta pública de una captura. */
export const rutaCaptura = (captura: Captura) => staticFile(`capturas/${captura.archivo}`)

export interface Capa {
    captura: Captura
    opacidad: number
}

/**
 * Captura en una ventana mínima: bordes redondeados, sombra suave y una barra
 * con la URL. Sin neón: el producto se ve limpio. El área de contenido mide
 * exactamente `ancho × alto` px lógicos, y los hijos (cursor, halos) se
 * posicionan en esas coordenadas.
 */
export function PanelVentana({ capas, children }: { capas: Capa[]; children?: ReactNode }) {
    const base = capas[0].captura
    const barra = 40
    return (
        <div
            style={{
                position: 'relative',
                width: base.ancho,
                height: base.alto,
                borderRadius: '0 0 14px 14px',
                background: '#ffffff',
                boxShadow: '0 40px 90px rgba(0, 0, 0, 0.55), 0 12px 30px rgba(0, 0, 0, 0.35)',
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: '100%',
                    height: barra,
                    borderRadius: '14px 14px 0 0',
                    background: '#151925',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 16px',
                    gap: 8,
                }}
            >
                {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
                    <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.85 }} />
                ))}
                <div
                    style={{
                        marginLeft: 18,
                        flex: 1,
                        maxWidth: 520,
                        height: 24,
                        borderRadius: 7,
                        background: '#0c0f17',
                        color: COLOR.textoSuave,
                        fontFamily: FUENTE.mono,
                        fontSize: 13,
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 12px',
                    }}
                >
                    {base.url}
                </div>
            </div>
            <Contenido capas={capas} radio="0 0 14px 14px" />
            {children}
        </div>
    )
}

/** Teléfono con marco mínimo: bisel oscuro, isla y esquinas redondeadas. */
export function PanelMovil({ capas, children }: { capas: Capa[]; children?: ReactNode }) {
    const base = capas[0].captura
    const bisel = 14
    return (
        <div
            style={{
                position: 'relative',
                width: base.ancho,
                height: base.alto,
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    left: -bisel,
                    top: -bisel,
                    right: -bisel,
                    bottom: -bisel,
                    borderRadius: 58,
                    background: 'linear-gradient(145deg, #23283a, #0d0f16 60%)',
                    boxShadow: '0 40px 90px rgba(0, 0, 0, 0.6), inset 0 0 0 1.5px rgba(255,255,255,0.10)',
                }}
            />
            <Contenido capas={capas} radio="46px" />
            <div
                style={{
                    position: 'absolute',
                    top: 12,
                    left: '50%',
                    width: 110,
                    height: 32,
                    marginLeft: -55,
                    borderRadius: 16,
                    background: '#05060a',
                }}
            />
            {children}
        </div>
    )
}

function Contenido({ capas, radio }: { capas: Capa[]; radio: string }) {
    return (
        <div style={{ position: 'absolute', inset: 0, borderRadius: radio, overflow: 'hidden', background: '#f4f6fa' }}>
            {capas.map(({ captura, opacidad }) =>
                opacidad > 0 ? (
                    <Img
                        key={captura.archivo}
                        src={rutaCaptura(captura)}
                        style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            objectPosition: 'top center',
                            opacity: opacidad,
                        }}
                    />
                ) : null
            )}
        </div>
    )
}

/** Panel de escritorio o móvil según la captura. */
export function Panel({ capas, children }: { capas: Capa[]; children?: ReactNode }) {
    return capas[0].captura.dispositivo === 'movil' ? (
        <PanelMovil capas={capas}>{children}</PanelMovil>
    ) : (
        <PanelVentana capas={capas}>{children}</PanelVentana>
    )
}
