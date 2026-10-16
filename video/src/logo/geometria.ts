/**
 * Geometría del logo de ArgosIsp: Argos Panoptes, el gigante de los cien ojos
 * que todo lo ve. Un ojo estilizado cuya pupila es un nodo de red, con arcos
 * de señal que salen de la pupila.
 *
 * Todo son trazos (para animarlos con stroke-dashoffset) sobre una grilla de
 * 64×64, con grosor pensado para leerse a 32 px. Monocromo: el color y el
 * neón se aplican por estilo.
 *
 * Este archivo no importa nada: lo usan los componentes de React y también
 * `scripts/exportar-logo.mjs` para escribir `public/logo-argos.svg`.
 */

export type Trazo =
    | { tipo: 'path'; d: string; orden: number }
    | { tipo: 'circle'; cx: number; cy: number; r: number; orden: number }

export interface DefinicionLogo {
    id: string
    nombre: string
    descripcion: string
    viewBox: string
    grosor: number
    trazos: Trazo[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Arco de circunferencia centrado en (cx, cy) entre dos ángulos (grados, 0 = derecha, -90 = arriba). */
export function arco(cx: number, cy: number, r: number, desde: number, hasta: number): string {
    const a = (desde * Math.PI) / 180
    const b = (hasta * Math.PI) / 180
    const x1 = r2(cx + r * Math.cos(a))
    const y1 = r2(cy + r * Math.sin(a))
    const x2 = r2(cx + r * Math.cos(b))
    const y2 = r2(cy + r * Math.sin(b))
    const grande = Math.abs(hasta - desde) > 180 ? 1 : 0
    const barrido = hasta > desde ? 1 : 0
    return `M${x1} ${y1} A${r} ${r} 0 ${grande} ${barrido} ${x2} ${y2}`
}

/** Variante elegida: ojo almendrado, pupila-nodo y tres arcos de señal. */
export const OJO_SENAL: DefinicionLogo = (() => {
    const cy = 42
    return {
        id: 'ojo-senal',
        nombre: 'Ojo con señal',
        descripcion: 'Ojo almendrado, pupila como nodo de red y tres arcos de señal que salen de ella.',
        viewBox: '0 0 64 64',
        grosor: 3.6,
        trazos: [
            { tipo: 'path', d: `M5 ${cy} C14.5 ${cy - 15} 49.5 ${cy - 15} 59 ${cy} C49.5 ${cy + 15} 14.5 ${cy + 15} 5 ${cy} Z`, orden: 0 },
            { tipo: 'circle', cx: 32, cy, r: 6.4, orden: 1 },
            { tipo: 'circle', cx: 32, cy, r: 1.2, orden: 2 },
            { tipo: 'path', d: arco(32, cy, 18.5, -90 - 30, -90 + 30), orden: 3 },
            { tipo: 'path', d: arco(32, cy, 25, -90 - 31, -90 + 31), orden: 4 },
            { tipo: 'path', d: arco(32, cy, 31.5, -90 - 32, -90 + 32), orden: 5 },
        ],
    }
})()

/** Variante: pupila hexagonal con conexiones que atraviesan el párpado hacia tres nodos. */
export const OJO_NODOS: DefinicionLogo = (() => {
    const cy = 36
    const hex = Array.from({ length: 6 }, (_, i) => {
        const a = ((60 * i - 90) * Math.PI) / 180
        return `${r2(32 + 7 * Math.cos(a))} ${r2(cy + 7 * Math.sin(a))}`
    })
    return {
        id: 'ojo-nodos',
        nombre: 'Ojo con nodos',
        descripcion: 'Pupila hexagonal (nodo) unida a tres nodos externos que asoman sobre el ojo.',
        viewBox: '0 0 64 64',
        grosor: 3.4,
        trazos: [
            { tipo: 'path', d: `M5 ${cy} C14.5 ${cy - 15} 49.5 ${cy - 15} 59 ${cy} C49.5 ${cy + 15} 14.5 ${cy + 15} 5 ${cy} Z`, orden: 0 },
            { tipo: 'path', d: `M${hex.join(' L')} Z`, orden: 1 },
            { tipo: 'path', d: `M32 ${cy - 7} L32 9`, orden: 2 },
            { tipo: 'path', d: `M26 ${cy - 3.5} L13 15`, orden: 2 },
            { tipo: 'path', d: `M38 ${cy - 3.5} L51 15`, orden: 2 },
            { tipo: 'circle', cx: 32, cy: 6, r: 3, orden: 3 },
            { tipo: 'circle', cx: 11.5, cy: 12.5, r: 3, orden: 3 },
            { tipo: 'circle', cx: 52.5, cy: 12.5, r: 3, orden: 3 },
        ],
    }
})()

/** Variante: iris circular con ondas de radio a ambos lados, "((•))" dentro de un ojo. */
export const IRIS_ONDAS: DefinicionLogo = (() => {
    const cy = 32
    return {
        id: 'iris-ondas',
        nombre: 'Iris con ondas',
        descripcion: 'Iris circular con nodo central y ondas de radio a cada lado, enmarcado por párpados.',
        viewBox: '0 0 64 64',
        grosor: 3.4,
        trazos: [
            { tipo: 'path', d: `M3 ${cy} C13 ${cy - 22} 51 ${cy - 22} 61 ${cy}`, orden: 0 },
            { tipo: 'path', d: `M3 ${cy} C13 ${cy + 22} 51 ${cy + 22} 61 ${cy}`, orden: 0 },
            { tipo: 'circle', cx: 32, cy, r: 4.5, orden: 1 },
            { tipo: 'path', d: arco(32, cy, 10, 180 - 40, 180 + 40), orden: 2 },
            { tipo: 'path', d: arco(32, cy, 10, -40, 40), orden: 2 },
            { tipo: 'path', d: arco(32, cy, 16.5, 180 - 36, 180 + 36), orden: 3 },
            { tipo: 'path', d: arco(32, cy, 16.5, -36, 36), orden: 3 },
        ],
    }
})()

export const LOGO_ELEGIDO = OJO_SENAL
export const VARIANTES = [OJO_SENAL, OJO_NODOS, IRIS_ONDAS]

/** SVG estático (monocromo, `currentColor`) para exportar o usar fuera de Remotion. */
export function svgEstatico(def: DefinicionLogo, { color = 'currentColor', tamano = 64 } = {}): string {
    const elementos = def.trazos
        .map((t) =>
            t.tipo === 'path' ? `  <path d="${t.d}"/>` : `  <circle cx="${t.cx}" cy="${t.cy}" r="${t.r}"/>`
        )
        .join('\n')
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${def.viewBox}" width="${tamano}" height="${tamano}" fill="none" stroke="${color}" stroke-width="${def.grosor}" stroke-linecap="round" stroke-linejoin="round">`,
        `  <title>ArgosIsp</title>`,
        elementos,
        `</svg>`,
        '',
    ].join('\n')
}
