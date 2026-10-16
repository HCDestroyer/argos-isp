#!/usr/bin/env node
/**
 * Descarga una sola vez las fuentes del video (Space Grotesk, Inter y
 * JetBrains Mono, licencia OFL) desde Google Fonts, usando las URLs y rangos
 * Unicode que publica @remotion/google-fonts, y las deja en public/fuentes/.
 * Genera src/estilo/fuentes-locales.ts con la lista para cargarlas.
 *
 * ¿Por qué? Así el render no depende de la red: en entornos con proxy TLS el
 * Chromium de render rechaza el certificado (ERR_CERT_AUTHORITY_INVALID) y
 * no queremos desactivar la verificación TLS. Se descarga con curl, que sí usa
 * la CA del sistema y el proxy (HTTPS_PROXY).
 *
 * Uso: node scripts/descargar-fuentes.mjs   (o pnpm fuentes)
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const DESTINO = join(RAIZ, 'public', 'fuentes')
const SUBSETS = ['latin', 'latin-ext']

const FAMILIAS = [
    { modulo: '@remotion/google-fonts/SpaceGrotesk', pesos: ['300', '400', '500', '600', '700'] },
    { modulo: '@remotion/google-fonts/Inter', pesos: ['400', '500', '600'] },
    { modulo: '@remotion/google-fonts/JetBrainsMono', pesos: ['400', '500'] },
]

mkdirSync(DESTINO, { recursive: true })
const entradas = []
for (const { modulo, pesos } of FAMILIAS) {
    const { getInfo } = await import(modulo)
    const info = getInfo()
    // Las tres son fuentes variables: varios pesos comparten archivo.
    const porUrl = new Map()
    for (const peso of pesos) {
        for (const subset of SUBSETS) {
            const url = info.fonts.normal?.[peso]?.[subset]
            if (!url) continue
            const actual = porUrl.get(url) ?? { subset, pesos: [] }
            actual.pesos.push(Number(peso))
            porUrl.set(url, actual)
        }
    }
    for (const [url, { subset, pesos: lista }] of porUrl) {
        const archivo = `${info.importName}-${subset}.woff2`
        execFileSync('curl', ['-sSfL', '--retry', '3', '-o', join(DESTINO, archivo), url], { stdio: 'inherit' })
        entradas.push({
            familia: info.fontFamily,
            archivo,
            peso: `${Math.min(...lista)} ${Math.max(...lista)}`,
            rango: info.unicodeRanges[subset],
        })
        console.log(`✓ ${archivo} (${info.fontFamily} ${Math.min(...lista)}–${Math.max(...lista)})`)
    }
}

const ts = `// Generado por scripts/descargar-fuentes.mjs. No editar a mano.
// Fuentes de Google Fonts (licencia SIL Open Font License) servidas desde public/fuentes/.

export interface FuenteLocal {
    familia: string
    archivo: string
    peso: string
    rango: string
}

export const FUENTES_LOCALES: FuenteLocal[] = ${JSON.stringify(entradas, null, 4)}
`
writeFileSync(join(RAIZ, 'src', 'estilo', 'fuentes-locales.ts'), ts)
console.log(`fuentes listas en ${DESTINO}`)
