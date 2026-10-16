import { Easing, interpolate, spring } from 'remotion'
import { FPS } from '../guion'

/**
 * Cámara virtual para escenas 3D con CSS.
 *
 * El "mundo" es un div con `transform-style: preserve-3d` cuyo origen está en
 * el centro del cuadro. La cámara mira hacia -z; con `z = PERSPECTIVA` y sin
 * rotación, lo que está en z = 0 se ve a escala 1. Acercarse (dolly) es bajar
 * z; `zoom = PERSPECTIVA / distancia`.
 *
 * Al mundo se le aplica la transformación inversa de la cámara:
 *   translateZ(P) rotateZ(-rz) rotateX(-rx) rotateY(-ry) translate3d(-x, -y, -z)
 */
export const PERSPECTIVA = 1400

export interface Camara {
    x: number
    y: number
    z: number
    /** Cabeceo en grados (positivo mira hacia abajo). */
    rx: number
    /** Guiñada en grados. */
    ry: number
    /** Alabeo en grados. */
    rz: number
}

export interface Punto3D {
    x: number
    y: number
    z: number
}

export type Curva = 'suave' | 'resorte' | 'lineal' | 'salida' | 'entrada'

export interface Clave {
    /** Frame (relativo a la escena) en el que la cámara llega a esta pose. */
    t: number
    cam: Camara
    /** Curva del tramo que termina en esta clave. */
    curva?: Curva
    /** 0..1: cuánto sigue la cámara al objetivo dinámico (p. ej. el cursor) en x/y. */
    seguir?: number
}

export const CAMARA_INICIAL: Camara = { x: 0, y: 0, z: PERSPECTIVA, rx: 0, ry: 0, rz: 0 }

const SUAVE = Easing.bezier(0.65, 0, 0.35, 1)
const SALIDA = Easing.bezier(0.16, 1, 0.3, 1)
const ENTRADA = Easing.bezier(0.7, 0, 0.84, 0)

function progresoTramo(frame: number, desde: number, hasta: number, curva: Curva): number {
    const duracion = Math.max(1, hasta - desde)
    if (curva === 'resorte') {
        return spring({
            frame: frame - desde,
            fps: FPS,
            durationInFrames: duracion,
            config: { damping: 200, mass: 0.9 },
        })
    }
    const lineal = interpolate(frame, [desde, hasta], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    })
    if (curva === 'lineal') return lineal
    if (curva === 'salida') return SALIDA(lineal)
    if (curva === 'entrada') return ENTRADA(lineal)
    return SUAVE(lineal)
}

const mezclar = (a: number, b: number, p: number) => a + (b - a) * p

export function mezclarCamaras(a: Camara, b: Camara, p: number): Camara {
    return {
        x: mezclar(a.x, b.x, p),
        y: mezclar(a.y, b.y, p),
        z: mezclar(a.z, b.z, p),
        rx: mezclar(a.rx, b.rx, p),
        ry: mezclar(a.ry, b.ry, p),
        rz: mezclar(a.rz, b.rz, p),
    }
}

/** Interpola la pose de la cámara entre claves ordenadas por `t`. */
export function animarCamara(frame: number, claves: Clave[]): { cam: Camara; seguir: number } {
    if (claves.length === 0) return { cam: CAMARA_INICIAL, seguir: 0 }
    const primera = claves[0]
    if (frame <= primera.t) return { cam: primera.cam, seguir: primera.seguir ?? 0 }
    for (let i = 1; i < claves.length; i++) {
        const anterior = claves[i - 1]
        const actual = claves[i]
        if (frame <= actual.t) {
            const p = progresoTramo(frame, anterior.t, actual.t, actual.curva ?? 'suave')
            return {
                cam: mezclarCamaras(anterior.cam, actual.cam, p),
                seguir: mezclar(anterior.seguir ?? 0, actual.seguir ?? 0, p),
            }
        }
    }
    const ultima = claves[claves.length - 1]
    return { cam: ultima.cam, seguir: ultima.seguir ?? 0 }
}

/** Cámara frontal que encuadra el punto (x, y) del plano z = 0 con un zoom dado. */
export function vista({
    x = 0,
    y = 0,
    zoom = 1,
    rx = 0,
    ry = 0,
    rz = 0,
}: Partial<{ x: number; y: number; zoom: number; rx: number; ry: number; rz: number }> = {}): Camara {
    return { x, y, z: PERSPECTIVA / zoom, rx, ry, rz }
}

const RAD = Math.PI / 180

/**
 * Cámara en órbita alrededor de `objetivo`, a `distancia`, con guiñada `ry` y
 * cabeceo `rx` (grados), siempre mirando al objetivo.
 */
export function orbita(objetivo: Punto3D, distancia: number, ry: number, rx = 0, rz = 0): Camara {
    const a = ry * RAD
    const b = rx * RAD
    return {
        x: objetivo.x + distancia * Math.cos(b) * Math.sin(a),
        y: objetivo.y - distancia * Math.sin(b),
        z: objetivo.z + distancia * Math.cos(b) * Math.cos(a),
        rx,
        ry,
        rz,
    }
}

/** Dónde está y cómo está girado un panel (captura) en el mundo. */
export interface Colocacion {
    /** Centro del área de contenido de la captura, en coordenadas del mundo. */
    x: number
    y: number
    z: number
    /** Giro sobre el eje vertical, en grados. */
    ry: number
    /** Píxeles del mundo por píxel lógico de la captura. */
    escala: number
    /** Tamaño lógico de la captura. */
    ancho: number
    alto: number
}

/** Convierte un punto de la captura (px lógicos) a coordenadas del mundo. */
export function puntoEnMundo(panel: Colocacion, punto: { x: number; y: number }): Punto3D {
    const lx = (punto.x - panel.ancho / 2) * panel.escala
    const ly = (punto.y - panel.alto / 2) * panel.escala
    const a = panel.ry * RAD
    return { x: panel.x + lx * Math.cos(a), y: panel.y + ly, z: panel.z - lx * Math.sin(a) }
}

/**
 * Holgura (px de pantalla) que se permite ver más allá del borde de una
 * captura al acercarse: un poco de fondo alrededor se ve como una ventana; más
 * se ve como un encuadre fallido.
 */
export const HOLGURA_BORDE = 150

/**
 * Acota el punto al que mira la cámara para que, con ese zoom, la captura
 * llene el cuadro salvo `holgura` px. Si la captura es más chica que el cuadro
 * en un eje, se centra en ese eje. El punto de interés sigue a la vista, solo
 * que no necesariamente en el centro.
 */
export function acotarAlPanel(
    panel: Colocacion,
    punto: { x: number; y: number },
    zoom: number,
    holgura = HOLGURA_BORDE
): { x: number; y: number } {
    const acotar = (valor: number, tamano: number, mitadPantalla: number) => {
        const mitad = (mitadPantalla - holgura) / (zoom * panel.escala)
        if (mitad * 2 >= tamano) return tamano / 2
        return Math.min(Math.max(valor, mitad), tamano - mitad)
    }
    return { x: acotar(punto.x, panel.ancho, ANCHO_CUADRO / 2), y: acotar(punto.y, panel.alto, ALTO_CUADRO / 2) }
}

const ANCHO_CUADRO = 1920
const ALTO_CUADRO = 1080

/**
 * Cámara que mira de frente un punto de la captura con un zoom dado (dolly).
 * Con zoom > 1 el punto se acota (`acotarAlPanel`) para no mostrar vacío;
 * `libre: true` lo desactiva.
 */
export function enfocar(
    panel: Colocacion,
    punto: { x: number; y: number },
    zoom: number,
    desvio: { ry?: number; rx?: number; rz?: number; libre?: boolean } = {}
): Camara {
    const objetivo = puntoEnMundo(panel, zoom > 1 && !desvio.libre ? acotarAlPanel(panel, punto, zoom) : punto)
    return orbita(objetivo, PERSPECTIVA / zoom, panel.ry + (desvio.ry ?? 0), desvio.rx ?? 0, desvio.rz ?? 0)
}

/** Igual que `enfocar` pero con el centro de la captura. */
export function encuadrar(panel: Colocacion, zoom: number, desvio: { ry?: number; rx?: number; rz?: number } = {}) {
    return enfocar(panel, { x: panel.ancho / 2, y: panel.alto / 2 }, zoom, desvio)
}

/** Pequeño movimiento "a mano" determinista para que la cámara no se vea congelada. */
export function deriva(frame: number, amplitud = 1): Camara {
    return {
        x: Math.sin(frame / 53) * 4 * amplitud,
        y: Math.cos(frame / 71) * 3 * amplitud,
        z: 0,
        rx: Math.sin(frame / 89) * 0.25 * amplitud,
        ry: Math.cos(frame / 97) * 0.35 * amplitud,
        rz: 0,
    }
}

export function sumarCamaras(a: Camara, b: Camara): Camara {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z, rx: a.rx + b.rx, ry: a.ry + b.ry, rz: a.rz + b.rz }
}

export function transformacionMundo(cam: Camara, perspectiva = PERSPECTIVA): string {
    return [
        `translateZ(${perspectiva}px)`,
        `rotateZ(${-cam.rz}deg)`,
        `rotateX(${-cam.rx}deg)`,
        `rotateY(${-cam.ry}deg)`,
        `translate3d(${-cam.x}px, ${-cam.y}px, ${-cam.z}px)`,
    ].join(' ')
}

/** Segundos de la escena a frames. */
export const s = (segundos: number) => Math.round(segundos * FPS)
