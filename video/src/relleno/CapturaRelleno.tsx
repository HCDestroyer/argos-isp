import { AbsoluteFill, random } from 'remotion'
import { CAPTURAS, type Captura, type IdCaptura, type PuntoInteres } from '../guion'
import { FUENTE } from '../estilo/tema'

/**
 * Captura de relleno: una pantalla falsa (clara, sin neón) con un título,
 * bloques grises y cada punto de interés dibujado en su posición, con su texto.
 * Sirve para probar encuadres y tiempos hasta tener las capturas reales.
 *
 * Se exporta a `public/capturas/<archivo>` con `pnpm capturas:relleno`.
 */
export function CapturaRelleno({ id }: { id: IdCaptura }) {
    const captura: Captura = CAPTURAS[id]
    const movil = captura.dispositivo === 'movil'
    return (
        <AbsoluteFill style={{ background: '#f4f6fa', fontFamily: FUENTE.cuerpo, color: '#0f172a' }}>
            {movil ? <EsqueletoMovil captura={captura} /> : <EsqueletoEscritorio captura={captura} />}
            {Object.entries(captura.puntos).map(([nombre, punto]) => (
                <Elemento key={nombre} punto={punto} />
            ))}
            <div
                style={{
                    position: 'absolute',
                    right: 12,
                    bottom: 8,
                    fontFamily: FUENTE.mono,
                    fontSize: 11,
                    color: '#94a3b8',
                }}
            >
                relleno · {captura.archivo}
            </div>
        </AbsoluteFill>
    )
}

function Barra({ x, y, ancho, alto = 10, tono = '#e2e8f0' }: { x: number; y: number; ancho: number; alto?: number; tono?: string }) {
    return <div style={{ position: 'absolute', left: x, top: y, width: ancho, height: alto, borderRadius: alto / 2, background: tono }} />
}

function EsqueletoEscritorio({ captura }: { captura: Captura }) {
    const filas = Array.from({ length: 9 }, (_, i) => i)
    return (
        <>
            {/* Barra lateral */}
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 200, background: '#0f172a' }}>
                <div style={{ position: 'absolute', left: 24, top: 26, fontFamily: FUENTE.titulo, fontSize: 22, fontWeight: 700, color: '#f8fafc' }}>
                    Argos<span style={{ fontWeight: 300, color: '#22d3ee' }}>Isp</span>
                </div>
                {Array.from({ length: 9 }, (_, i) => (
                    <Barra key={i} x={24} y={96 + i * 44} ancho={90 + random(`menu-${captura.archivo}-${i}`) * 60} tono={i === 1 ? '#334155' : '#1e293b'} />
                ))}
            </div>
            {/* Encabezado */}
            <div style={{ position: 'absolute', left: 200, right: 0, top: 0, height: 96, borderBottom: '1px solid #e2e8f0', background: '#ffffff' }}>
                <div style={{ position: 'absolute', left: 40, top: 28, fontSize: 30, fontWeight: 700, fontFamily: FUENTE.titulo }}>
                    {captura.titulo}
                </div>
                <div style={{ position: 'absolute', right: 32, top: 30, width: 36, height: 36, borderRadius: 18, background: '#cbd5e1' }} />
            </div>
            {/* Contenido de fondo: filas tenues */}
            {filas.map((i) => (
                <div key={i} style={{ position: 'absolute', left: 240, right: 40, top: 270 + i * 58, height: 1, background: '#e2e8f0' }}>
                    <Barra x={16} y={-28} ancho={120 + random(`fila-a-${captura.archivo}-${i}`) * 140} tono="#e7ebf1" />
                    <Barra x={360} y={-28} ancho={80 + random(`fila-b-${captura.archivo}-${i}`) * 120} tono="#e7ebf1" />
                    <Barra x={640} y={-28} ancho={60 + random(`fila-c-${captura.archivo}-${i}`) * 90} tono="#e7ebf1" />
                </div>
            ))}
        </>
    )
}

function EsqueletoMovil({ captura }: { captura: Captura }) {
    return (
        <>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 150, background: '#0f172a' }}>
                <div style={{ position: 'absolute', left: 24, top: 66, fontFamily: FUENTE.titulo, fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>
                    Argos<span style={{ fontWeight: 300, color: '#22d3ee' }}>Isp</span>
                </div>
            </div>
            <div style={{ position: 'absolute', left: 24, right: 24, top: 176, fontSize: 24, fontWeight: 700, fontFamily: FUENTE.titulo, lineHeight: 1.2 }}>
                {captura.titulo}
            </div>
            {Array.from({ length: 4 }, (_, i) => (
                <Barra key={i} x={24} y={236 + i * 22} ancho={200 + random(`movil-${captura.archivo}-${i}`) * 110} tono="#e2e8f0" />
            ))}
        </>
    )
}

const TONOS = {
    verde: { fondo: '#dcfce7', texto: '#166534', borde: '#86efac', solido: '#16a34a' },
    rojo: { fondo: '#fee2e2', texto: '#991b1b', borde: '#fca5a5', solido: '#dc2626' },
    ambar: { fondo: '#fef3c7', texto: '#92400e', borde: '#fcd34d', solido: '#d97706' },
    azul: { fondo: '#dbeafe', texto: '#1e40af', borde: '#93c5fd', solido: '#2563eb' },
    gris: { fondo: '#f1f5f9', texto: '#334155', borde: '#cbd5e1', solido: '#64748b' },
} as const

function Elemento({ punto }: { punto: PuntoInteres }) {
    const ancho = punto.ancho ?? 120
    const alto = punto.alto ?? 36
    const tono = TONOS[punto.tono ?? 'gris']
    const base = {
        position: 'absolute' as const,
        left: punto.x - ancho / 2,
        top: punto.y - alto / 2,
        width: ancho,
        height: alto,
        display: 'flex',
        alignItems: 'center',
        boxSizing: 'border-box' as const,
        whiteSpace: 'nowrap' as const,
        overflow: 'hidden',
    }
    switch (punto.tipo) {
        case 'chip':
        case 'badge':
            return (
                <div
                    style={{
                        ...base,
                        justifyContent: 'center',
                        borderRadius: alto / 2,
                        background: tono.fondo,
                        color: tono.texto,
                        border: `1px solid ${tono.borde}`,
                        fontSize: Math.min(15, alto * 0.45),
                        fontWeight: 600,
                    }}
                >
                    {punto.tipo === 'badge' ? <span style={{ width: 8, height: 8, borderRadius: 4, background: tono.solido, marginRight: 8 }} /> : null}
                    {punto.texto}
                </div>
            )
        case 'boton':
            return (
                <div
                    style={{
                        ...base,
                        justifyContent: 'center',
                        borderRadius: 8,
                        background: punto.tono === 'gris' ? '#ffffff' : tono.solido,
                        color: punto.tono === 'gris' ? '#334155' : '#ffffff',
                        border: punto.tono === 'gris' ? '1px solid #cbd5e1' : 'none',
                        fontSize: 16,
                        fontWeight: 600,
                    }}
                >
                    {punto.texto}
                </div>
            )
        case 'campo':
            return (
                <div
                    style={{
                        ...base,
                        padding: '0 14px',
                        borderRadius: 8,
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        color: '#64748b',
                        fontSize: 15,
                    }}
                >
                    <span style={{ width: 14, height: 14, borderRadius: 7, border: '2px solid #94a3b8', marginRight: 10 }} />
                    {punto.texto}
                </div>
            )
        case 'check':
            return (
                <div
                    style={{
                        ...base,
                        padding: '0 14px',
                        borderRadius: 8,
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        fontSize: 15,
                        fontWeight: 500,
                    }}
                >
                    <span style={{ width: 18, height: 18, borderRadius: 4, border: '2px solid #2563eb', marginRight: 12, background: '#eff6ff' }} />
                    {punto.texto}
                </div>
            )
        case 'fila':
            return (
                <div
                    style={{
                        ...base,
                        padding: '0 16px',
                        background: '#eff6ff',
                        borderLeft: '3px solid #2563eb',
                        fontFamily: FUENTE.mono,
                        fontSize: 14,
                    }}
                >
                    {punto.texto}
                </div>
            )
        default:
            return (
                <div
                    style={{
                        ...base,
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        justifyContent: 'flex-start',
                        padding: 16,
                        gap: 10,
                        borderRadius: 12,
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
                        whiteSpace: 'normal',
                    }}
                >
                    <span style={{ fontSize: alto > 80 ? 17 : 15, fontWeight: 600, fontFamily: alto > 80 ? FUENTE.cuerpo : FUENTE.mono }}>{punto.texto}</span>
                    {alto > 80
                        ? Array.from({ length: Math.min(8, Math.floor((alto - 50) / 30)) }, (_, i) => (
                              <span key={i} style={{ height: 10, borderRadius: 5, background: '#e2e8f0', width: `${55 + random(`b-${punto.texto}-${i}`) * 40}%` }} />
                          ))
                        : null}
                </div>
            )
    }
}
