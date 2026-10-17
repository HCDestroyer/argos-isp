import { DomainAction, type Transaccion } from '#shared/domain_action'
import { actualizarConVersion } from '#shared/version'
import { filaEmpresa, verEmpresaCompleta, type EmpresaCompleta } from '#core/empresas'
import { borrarArchivoLogo, guardarArchivoLogo, nuevaRutaLogo, prepararLogo } from '#core/logos'

export interface EntradaCambiarLogoEmpresa {
    id: number
    version: number
    /** contenido del archivo subido (se ignora con `quitar`) */
    contenido: Uint8Array
    /** quitar el logo actual */
    quitar?: boolean
}

/**
 * Sube o quita el logo de una empresa (`empresas.cambiar_logo`). Solo PNG o SVG saneado (sin
 * scripts, estilos ni referencias externas), hasta 512 KB (422 en `logo`). El archivo va al
 * almacenamiento de archivos (`#core/logos`); la fila guarda la ruta, el tipo y el ETag. El archivo
 * anterior se borra después del COMMIT; si la transacción falla, se borra el nuevo.
 */
export default class CambiarLogoEmpresa extends DomainAction<EntradaCambiarLogoEmpresa, EmpresaCompleta> {
    readonly nombre = 'empresas.cambiar_logo'

    protected async handle(input: EntradaCambiarLogoEmpresa, t: Transaccion): Promise<EmpresaCompleta> {
        t.fijarEntidad('empresa', input.id)
        t.fijarEmpresa(input.id)
        const antes = await filaEmpresa(input.id, t.trx, true)

        let cambios: { logo: string | null; logo_tipo: string | null; logo_etag: string | null } = {
            logo: null,
            logo_tipo: null,
            logo_etag: null,
        }
        let nueva: string | null = null
        if (!input.quitar) {
            const logo = prepararLogo(input.contenido)
            nueva = nuevaRutaLogo(input.id, logo.tipo)
            await guardarArchivoLogo(nueva, logo.contenido)
            cambios = { logo: nueva, logo_tipo: logo.tipo, logo_etag: logo.etag }
        }
        try {
            await actualizarConVersion(t.trx, 'core.empresas', input.id, input.version, cambios)
            const despues = await verEmpresaCompleta(input.id, t.trx)
            // el diff guarda la huella (ETag), nunca la ruta interna
            await t.registrarCambios(
                { tipo: 'empresa', id: input.id },
                { logo: antes.logo_etag, logo_tipo: antes.logo_tipo },
                { logo: cambios.logo_etag, logo_tipo: cambios.logo_tipo },
            )
            const previo = antes.logo
            if (previo && previo !== nueva) t.alConfirmar(() => borrarArchivoLogo(previo))
            return despues
        } catch (error) {
            if (nueva) await borrarArchivoLogo(nueva)
            throw error
        }
    }
}
