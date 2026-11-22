import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generarIndiceAyuda, slug } from '../../herramientas/indiceAyuda.mjs'

/**
 * El índice de ayuda contextual (`app/utils/indiceAyuda.ts`) se genera del manual. Si alguien
 * cambia `docs/manual` o el archivo a mano, esta prueba lo dice: hay que correr
 * `pnpm --filter @argosisp/web ayuda:indice` y commitear el resultado.
 */
const WEB = [process.cwd(), resolve(process.cwd(), 'apps/web')].find(ruta => existsSync(join(ruta, 'app/pages'))) ?? process.cwd()

describe('índice de ayuda del manual', () => {
    it('está al día con docs/manual', () => {
        const actual = readFileSync(join(WEB, 'app/utils/indiceAyuda.ts'), 'utf8')
        expect(actual).toBe((generarIndiceAyuda as (web: string) => string)(WEB))
    })

    it('las anclas siguen el estilo del sitio (sin acentos, con guiones)', () => {
        expect((slug as (texto: string) => string)('Ficha del cliente')).toBe('ficha-del-cliente')
        expect((slug as (texto: string) => string)('Régimen de ISR')).toBe('regimen-de-isr')
    })

    it('cada pantalla del inicio y de clientes tiene su resumen', () => {
        expect(INDICE_AYUDA['/']?.titulo).toBe('Inicio')
        expect(INDICE_AYUDA['/clientes']?.resumen.length).toBeGreaterThan(40)
    })
})
