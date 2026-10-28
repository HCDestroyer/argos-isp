import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import { verRouter } from '#network/consultas/routers'
import { filaConexion, verConexion, type ConexionVista } from '#network/conexion/consultas'
import { aplicarRegistro } from '#network/conexion/registro'

export interface EntradaConexionClave {
    router_id: number
    public_key: string
}

/**
 * `routers.conexion_clave`: pegar a mano la clave pública que imprimió el script, cuando el router
 * no pudo registrarse por internet. Mismo efecto que el registro por token (y lo consume). Exige que
 * antes se haya generado un script (422 `script_no_generado`): la clave de la API vive en ese script.
 */
export default class ConexionClave extends DomainAction<EntradaConexionClave, ConexionVista> {
    readonly nombre = 'routers.conexion_clave'

    protected async handle(input: EntradaConexionClave, t: Transaccion): Promise<ConexionVista> {
        t.fijarEntidad('router', input.router_id)
        await verRouter(input.router_id, t.trx)
        const conexion = await filaConexion(input.router_id, t.trx, true)
        if (!conexion) {
            throw new ReglaNegocio(
                'Primero genera el script de conexión del router: la clave pública se pega después de ejecutarlo',
                'script_no_generado',
            )
        }
        await aplicarRegistro(t, conexion, input.public_key)
        return verConexion(input.router_id, t.trx)
    }
}
