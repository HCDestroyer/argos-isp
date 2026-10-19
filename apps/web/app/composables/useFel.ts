import type { paths } from '@argosisp/contracts'

export type DatosConfigurarFel = paths['/api/v1/fel/configuracion']['put']['requestBody']['content']['application/json']
export type DatosCredencialesFel = paths['/api/v1/fel/credenciales/{ambiente}']['put']['requestBody']['content']['application/json']

/** Lo que el aviso global del panel necesita saber de la FEL de la empresa activa. */
interface EstadoFelEmpresa {
    empresaId: number
    modo: ModoFel
    contingenciaActiva: boolean
    contingenciaDesde: string | null
}

/**
 * Configuración FEL de una empresa (A3, fase 3; contrato §8 y §11.1): proveedor, ambiente, modo,
 * credenciales de solo escritura y contingencia. Sin `empresa_id` usa la empresa activa
 * (`X-Empresa-Id`). La última configuración leída de la empresa activa se comparte con el aviso
 * global del panel (`AvisoFel`) para no pedirla en cada página.
 */
export function useFel() {
    const api = useApi()
    const estado = useState<EstadoFelEmpresa | null>('fel:estado', () => null)

    function recordar(configuracion: ConfiguracionFel): ConfiguracionFel {
        estado.value = {
            empresaId: configuracion.empresa_id,
            modo: configuracion.modo,
            contingenciaActiva: configuracion.contingencia_activa,
            contingenciaDesde: configuracion.contingencia_desde,
        }
        return configuracion
    }

    async function conRecuerdo(peticion: Promise<Resultado<ConfiguracionFel>>): Promise<Resultado<ConfiguracionFel>> {
        const resultado = await peticion
        if (resultado.ok) {
            recordar(resultado.data)
        }
        return resultado
    }

    /** `GET /fel/configuracion` (`fel.ver`): sin configuración, `desactivada` con `version` 0. */
    function configuracion(empresaId?: number): Promise<Resultado<ConfiguracionFel>> {
        return conRecuerdo(resolver(api.GET('/api/v1/fel/configuracion', { params: { query: empresaId ? { empresa_id: empresaId } : {} } })))
    }

    /**
     * `PUT /fel/configuracion` (`fel.configurar`) con la `version` leída: 409 `conflicto_version`;
     * 422 `certificar_al_incompatible` (obligatoria con servicios en `nunca`) y
     * `avisos_por_certificar` (desactivar con avisos vivos sin DTE).
     */
    function configurar(datos: DatosConfigurarFel, clave: string): Promise<Resultado<ConfiguracionFel>> {
        return conRecuerdo(resolver(api.PUT('/api/v1/fel/configuracion', {
            params: { header: { 'Idempotency-Key': clave } },
            body: datos,
        })))
    }

    /** `PUT /fel/credenciales/:ambiente`: se guardan cifradas; la respuesta solo trae los campos visibles. */
    function guardarCredenciales(ambiente: AmbienteFel, datos: DatosCredencialesFel, clave: string): Promise<Resultado<CredencialesFel>> {
        return resolver(api.PUT('/api/v1/fel/credenciales/{ambiente}', {
            params: { path: { ambiente }, header: { 'Idempotency-Key': clave } },
            body: datos,
        }))
    }

    /** `POST /fel/credenciales/:ambiente/probar`: no certifica; 422 `fel_no_configurada`, 503 sin certificador. */
    function probarCredenciales(ambiente: AmbienteFel, empresaId?: number): Promise<Resultado<CredencialesFel>> {
        return resolver(api.POST('/api/v1/fel/credenciales/{ambiente}/probar', {
            params: { path: { ambiente }, query: empresaId ? { empresa_id: empresaId } : {} },
        }))
    }

    /** `POST /fel/activar-contingencia` o `/fel/desactivar-contingencia` (`fel.contingencia`) con motivo; 409 `contingencia_sin_cambio`. */
    function cambiarContingencia(activar: boolean, motivo: string, clave: string, empresaId?: number): Promise<Resultado<ConfiguracionFel>> {
        const opciones = {
            params: { header: { 'Idempotency-Key': clave } },
            body: { motivo, ...(empresaId ? { empresa_id: empresaId } : {}) },
        }
        return conRecuerdo(resolver(activar
            ? api.POST('/api/v1/fel/activar-contingencia', opciones)
            : api.POST('/api/v1/fel/desactivar-contingencia', opciones)))
    }

    /** `GET /fel/proveedores` (`fel.ver`): certificadores con sus campos de credenciales y ambientes. */
    function proveedores(): Promise<Resultado<ProveedorFelCatalogo[]>> {
        return resolver(api.GET('/api/v1/fel/proveedores'))
    }

    /** Estado FEL de la empresa activa para el aviso global; lo vuelve a leer si cambió de empresa. */
    async function estadoDe(empresaId: number): Promise<EstadoFelEmpresa | null> {
        if (estado.value?.empresaId === empresaId) {
            return estado.value
        }
        const resultado = await configuracion(empresaId)
        return resultado.ok ? estado.value : null
    }

    return { estado, proveedores, configuracion, configurar, guardarCredenciales, probarCredenciales, cambiarContingencia, estadoDe }
}
