import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Módulo virtual `virtual:permisos-contrato`: el catálogo de permisos del ACL leído del OpenAPI
 * de `packages/contracts` (el enum de `permisos` de `POST /roles`), con la descripción del primer
 * endpoint que lo pide (`x-permiso` → `summary`). Lo usan los fixtures (`GET /permisos`, el rol
 * admin y la sesión del admin): cuando el backend agrega un permiso y se corre
 * `pnpm contracts:build`, los fixtures lo traen sin copiar nada a mano.
 */

const ID = 'virtual:permisos-contrato'
const RESUELTO = `\0${ID}`
/** `packages/contracts/openapi.json` desde este archivo (solo en Node: config de Nuxt y Vite). */
function rutaOpenapi(): string {
    return fileURLToPath(new URL('../../../packages/contracts/openapi.json', import.meta.url))
}

interface Operacion {
    'summary'?: string
    'x-permiso'?: string
    'requestBody'?: { content?: { 'application/json'?: { schema?: { properties?: { permisos?: { items?: { enum?: string[] } } } } } } }
}

export function permisosDelContrato(ruta: string): { nombre: string, descripcion: string }[] {
    const spec = JSON.parse(readFileSync(ruta, 'utf8')) as { paths: Record<string, Record<string, Operacion>> }
    const nombres = spec.paths['/api/v1/roles']?.post?.requestBody?.content?.['application/json']?.schema?.properties?.permisos?.items?.enum
    if (!nombres?.length) {
        throw new Error(`${ruta}: falta el enum de permisos de POST /api/v1/roles`)
    }
    const resumenes = new Map<string, string>()
    for (const operaciones of Object.values(spec.paths)) {
        for (const operacion of Object.values(operaciones)) {
            const permiso = operacion['x-permiso']
            if (permiso && operacion.summary && !resumenes.has(permiso)) {
                resumenes.set(permiso, operacion.summary)
            }
        }
    }
    return [...nombres].sort().map(nombre => ({ nombre, descripcion: resumenes.get(nombre) ?? nombre }))
}

/** Plugin de Vite (dev, build, Vitest y Playwright pasan por él). */
export function permisosContrato() {
    return {
        name: 'argosisp:permisos-contrato',
        resolveId(id: string) {
            return id === ID ? RESUELTO : null
        },
        load(this: { addWatchFile: (archivo: string) => void }, id: string) {
            if (id !== RESUELTO) {
                return null
            }
            const ruta = rutaOpenapi()
            this.addWatchFile(ruta)
            return `export const PERMISOS_CONTRATO = ${JSON.stringify(permisosDelContrato(ruta))}\n`
        },
    }
}
