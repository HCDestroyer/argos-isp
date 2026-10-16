import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill } from 'remotion'
import { type Camara, PERSPECTIVA, transformacionMundo } from './camara'

/**
 * Espacio 3D con cámara virtual. Los hijos se colocan con `<Objeto3D>` en
 * coordenadas del mundo (origen en el centro del cuadro, y hacia abajo).
 */
export function Escena3D({
    camara,
    children,
    perspectiva = PERSPECTIVA,
    estilo,
}: {
    camara: Camara
    children: ReactNode
    perspectiva?: number
    estilo?: CSSProperties
}) {
    return (
        <AbsoluteFill
            style={{
                perspective: perspectiva,
                perspectiveOrigin: '50% 50%',
                overflow: 'hidden',
                ...estilo,
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: 0,
                    height: 0,
                    transformStyle: 'preserve-3d',
                    transform: transformacionMundo(camara, perspectiva),
                }}
            >
                {children}
            </div>
        </AbsoluteFill>
    )
}

/** Un objeto en el mundo, centrado en (x, y, z) y girado en grados. */
export function Objeto3D({
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    escala = 1,
    opacidad = 1,
    nitidez = 1,
    tamano,
    children,
    estilo,
}: {
    x?: number
    y?: number
    z?: number
    rx?: number
    ry?: number
    rz?: number
    escala?: number
    opacidad?: number
    /**
     * Factor de sobremuestreo. Chromium rasteriza las capas 3D a su tamaño CSS
     * y luego las escala, así que al acercar la cámara se verían borrosas. Con
     * `nitidez = 2` el contenido se maqueta al doble (`zoom: 2`) y se reduce a la
     * mitad en la transformación: se ve igual, pero nítido hasta un zoom de 2×.
     */
    nitidez?: number
    /**
     * Tamaño del contenido (px). Obligatorio con `nitidez` > 1: Chromium no
     * calcula bien el ancho "shrink-to-fit" de un hijo con `zoom`.
     */
    tamano?: { ancho: number; alto: number }
    children: ReactNode
    estilo?: CSSProperties
}) {
    // Con tamaño conocido se centra en px (más robusto que % con `zoom`).
    const centrado = tamano
        ? `translate(${(-tamano.ancho * nitidez) / 2}px, ${(-tamano.alto * nitidez) / 2}px)`
        : 'translate(-50%, -50%)'
    return (
        <div
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: tamano ? tamano.ancho * nitidez : undefined,
                height: tamano ? tamano.alto * nitidez : undefined,
                transformStyle: 'preserve-3d',
                // Origen en la esquina: así (x, y, z) es exactamente el centro del contenido
                // aunque haya giro o escala (con el origen al 50 % se desplazaría).
                transformOrigin: '0 0',
                transform: `translate3d(${x}px, ${y}px, ${z}px) rotateY(${ry}deg) rotateX(${rx}deg) rotateZ(${rz}deg) scale(${escala / nitidez}) ${centrado}`,
                opacity: opacidad,
                ...estilo,
            }}
        >
            {nitidez === 1 ? children : <div style={{ zoom: nitidez }}>{children}</div>}
        </div>
    )
}
