import { DomainAction, type Transaccion } from '#shared/domain_action'
import { verificarVersion } from '#shared/version'
import {
    aparienciaCompleta,
    borrarArchivoApariencia,
    filaApariencia,
    guardarArchivoApariencia,
    nuevaRutaArchivo,
    prepararImagen,
    type AparienciaCompleta,
    type ArchivoApariencia,
} from '#core/apariencia'

export interface EntradaArchivoApariencia {
    version: number
    /** contenido subido; se ignora al quitar */
    contenido?: Uint8Array
}

type Operacion = 'subir' | 'quitar'

/**
 * Sube o quita el logo o el fondo del inicio de sesión (contrato `apariencia.md` §6). Una clase,
 * cuatro acciones con su permiso: `apariencia.subir_logo_login`, `apariencia.quitar_logo_login`,
 * `apariencia.subir_fondo_login`, `apariencia.quitar_fondo_login`.
 *
 * El archivo nuevo se escribe antes de la fila; si la transacción falla se borra. El anterior se
 * borra después del COMMIT. El diff guarda la huella (sha256) y el tipo, nunca la ruta interna.
 */
export default class CambiarArchivoApariencia extends DomainAction<EntradaArchivoApariencia, AparienciaCompleta> {
    readonly nombre: string

    constructor(
        readonly archivo: ArchivoApariencia,
        readonly operacion: Operacion,
    ) {
        super()
        this.nombre = `apariencia.${operacion}_${archivo}`
    }

    /** El contenido del archivo no va a la auditoría (solo su huella, por el diff). */
    protected readonly camposEntradaOcultos = ['contenido'] as const

    protected async handle(input: EntradaArchivoApariencia, t: Transaccion): Promise<AparienciaCompleta> {
        t.fijarEntidad('apariencia', 1)
        const antes = await filaApariencia(t.trx, true)
        verificarVersion('core.apariencia', 1, antes.version, input.version)
        const a = this.archivo

        let cambios: Record<string, string | number | null> = {
            [a]: null,
            [`${a}_tipo`]: null,
            [`${a}_tamano`]: null,
            [`${a}_etag`]: null,
        }
        let nueva: string | null = null
        if (this.operacion === 'subir') {
            const imagen = prepararImagen(a, input.contenido ?? new Uint8Array())
            nueva = nuevaRutaArchivo(imagen.tipo)
            await guardarArchivoApariencia(nueva, imagen.contenido)
            cambios = {
                [a]: nueva,
                [`${a}_tipo`]: imagen.tipo,
                [`${a}_tamano`]: imagen.contenido.length,
                [`${a}_etag`]: imagen.etag,
            }
        } else if (!antes[a]) {
            // nada que quitar: sin cambios ni versión nueva
            return aparienciaCompleta(antes)
        }
        try {
            const [despues] = (await t.trx
                .from('core.apariencia')
                .where('id', 1)
                .update(
                    {
                        ...cambios,
                        version: t.trx.knexRawQuery('version + 1'),
                        updated_at: t.trx.knexRawQuery('now()'),
                    },
                    ['*'],
                )) as [typeof antes]
            await t.registrarCambios(
                { tipo: 'apariencia', id: 1 },
                { [a]: antes[`${a}_etag`], [`${a}_tipo`]: antes[`${a}_tipo`] },
                { [a]: cambios[`${a}_etag`], [`${a}_tipo`]: cambios[`${a}_tipo`] },
            )
            const previo = antes[a]
            if (previo && previo !== nueva) t.alConfirmar(() => borrarArchivoApariencia(previo))
            return aparienciaCompleta(despues)
        } catch (error) {
            if (nueva) await borrarArchivoApariencia(nueva)
            throw error
        }
    }
}
