import type { Schema, paths } from '@argosisp/contracts'

export type EmpresaGrupo = Schema<'EmpresaGrupo'>
export type DatosEmpresaNueva = paths['/api/v1/empresas']['post']['requestBody']['content']['application/json']
export type CambiosEmpresaGrupo = paths['/api/v1/empresas/{id}']['put']['requestBody']['content']['application/json']
export type PaisLocalizacion = Schema<'PaisLocalizacion'>

/** Límites del logo que impone la API (`contratos/multiempresa.md`): PNG o SVG, hasta 512 KB. */
export const LOGO_TIPOS = ['image/png', 'image/svg+xml'] as const
export const LOGO_MAX_BYTES = 512 * 1024

/** Error local del logo antes de subirlo (el mismo texto que la API daría con su `rule`). */
export function errorLogo(archivo: Pick<File, 'type' | 'size'>): string | null {
    if (!(LOGO_TIPOS as readonly string[]).includes(archivo.type)) {
        return 'Solo PNG o SVG'
    }
    if (archivo.size > LOGO_MAX_BYTES) {
        return 'El logo pasa de 512 KB'
    }
    return null
}

/**
 * Empresas (NIT) de la instalación (multiempresa, A1): lista, alta, edición con `version` (409),
 * desactivar con motivo y logo por multipart.
 */
export function useEmpresas() {
    const api = useApi()

    /** `GET /empresas` (`empresas.ver`): solo las del alcance del usuario; la principal primero. */
    function listar(activas = false): Promise<Resultado<EmpresaGrupo[]>> {
        return resolver(api.GET('/api/v1/empresas', { params: { query: activas ? { activas: true } : {} } }))
    }

    function ver(id: number): Promise<Resultado<EmpresaGrupo>> {
        return resolver(api.GET('/api/v1/empresas/{id}', { params: { path: { id } } }))
    }

    /** `POST /empresas` (`empresas.crear`); 409 `nit_duplicado`. */
    function crear(datos: DatosEmpresaNueva, clave: string): Promise<Resultado<EmpresaGrupo>> {
        return resolver(api.POST('/api/v1/empresas', { params: { header: { 'Idempotency-Key': clave } }, body: datos }))
    }

    /** `PUT /empresas/:id` (`empresas.editar`) con la `version` leída. */
    function editar(id: number, cambios: CambiosEmpresaGrupo): Promise<Resultado<EmpresaGrupo>> {
        return resolver(api.PUT('/api/v1/empresas/{id}', { params: { path: { id } }, body: cambios }))
    }

    /** `POST /empresas/:id/desactivar` (`empresas.desactivar`); 422 `empresa_principal`, `empresa_con_servicios`. */
    function desactivar(id: number, version: number, motivo: string, clave: string): Promise<Resultado<EmpresaGrupo>> {
        return resolver(api.POST('/api/v1/empresas/{id}/desactivar', {
            params: { path: { id }, header: { 'Idempotency-Key': clave } },
            body: { version, motivo },
        }))
    }

    /**
     * `POST /empresas/:id/logo` (`empresas.cambiar_logo`), multipart. Sin `archivo` quita el logo.
     * El OpenAPI tipa el archivo como `string` (binario): en el cuerpo va su nombre y
     * `bodySerializer` arma el `FormData` con el `File` real.
     */
    function cambiarLogo(id: number, version: number, archivo: File | null): Promise<Resultado<EmpresaGrupo>> {
        return resolver(api.POST('/api/v1/empresas/{id}/logo', {
            params: { path: { id } },
            body: archivo ? { version, logo: archivo.name } : { version, quitar: true },
            bodySerializer: () => {
                const formulario = new FormData()
                formulario.append('version', String(version))
                if (archivo) {
                    formulario.append('logo', archivo, archivo.name)
                }
                else {
                    formulario.append('quitar', 'true')
                }
                return formulario
            },
        }))
    }

    /** `GET /empresas/paises` (`empresas.ver`): países con paquete de localización fiscal. */
    function paises(): Promise<Resultado<PaisLocalizacion[]>> {
        return resolver(api.GET('/api/v1/empresas/paises'))
    }

    /**
     * `POST /empresas/:id/cambiar-pais` (`empresas.cambiar_pais`): reinstala la localización del país
     * nuevo. 422 `pais_no_soportado`, 409 `empresa_con_documentos` o si cambió la `version`.
     */
    function cambiarPais(id: number, pais: string, version: number, clave: string): Promise<Resultado<EmpresaGrupo>> {
        return resolver(api.POST('/api/v1/empresas/{id}/cambiar-pais', {
            params: { path: { id }, header: { 'Idempotency-Key': clave } },
            body: { pais, version },
        }))
    }

    return { listar, ver, crear, editar, desactivar, cambiarLogo, paises, cambiarPais }
}
