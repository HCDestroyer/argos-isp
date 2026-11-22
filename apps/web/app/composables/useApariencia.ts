import type { Schema, paths } from '@argosisp/contracts'

export type Apariencia = Schema<'Apariencia'>
export type AparienciaPublica = Schema<'AparienciaPublica'>
export type DatosApariencia = paths['/api/v1/apariencia']['put']['requestBody']['content']['application/json']

/**
 * Apariencia de la instalación (A6, `contratos/apariencia.md`): tema de color, modo predeterminado,
 * marca, eslogan y logo y fondo del inicio de sesión. `publica()` va sin sesión (login).
 */
export function useApariencia() {
    const api = useApi()

    function publica(): Promise<Resultado<AparienciaPublica>> {
        return resolver(api.GET('/api/v1/apariencia/publica'))
    }

    function ver(): Promise<Resultado<Apariencia>> {
        return resolver(api.GET('/api/v1/apariencia'))
    }

    function editar(datos: DatosApariencia, clave: string): Promise<Resultado<Apariencia>> {
        return resolver(api.PUT('/api/v1/apariencia', { body: datos, params: { header: { 'Idempotency-Key': clave } } }))
    }

    /** Sube el logo o el fondo del login (multipart `archivo` + `version`). */
    function subirArchivo(tipo: 'logo' | 'fondo', version: number, archivo: File): Promise<Resultado<Apariencia>> {
        const opciones = {
            body: { version, archivo: archivo.name },
            bodySerializer: () => {
                const formulario = new FormData()
                formulario.append('version', String(version))
                formulario.append('archivo', archivo, archivo.name)
                return formulario
            },
        }
        return tipo === 'logo'
            ? resolver(api.POST('/api/v1/apariencia/logo-login', opciones))
            : resolver(api.POST('/api/v1/apariencia/fondo-login', opciones))
    }

    function quitarArchivo(tipo: 'logo' | 'fondo', version: number): Promise<Resultado<Apariencia>> {
        return tipo === 'logo'
            ? resolver(api.POST('/api/v1/apariencia/logo-login/quitar', { body: { version } }))
            : resolver(api.POST('/api/v1/apariencia/fondo-login/quitar', { body: { version } }))
    }

    return { publica, ver, editar, subirArchivo, quitarArchivo }
}
