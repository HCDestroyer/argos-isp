/** `herramientas/permisosContrato.ts`: catálogo de permisos derivado del OpenAPI de `packages/contracts`. */
declare module 'virtual:permisos-contrato' {
    import type { Schema } from '@argosisp/contracts'

    export const PERMISOS_CONTRATO: { nombre: Schema<'Permiso'>['nombre'], descripcion: string }[]
}
