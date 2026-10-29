import { DomainAction, type Transaccion } from '#shared/domain_action'
import { verRouter } from '#network/consultas/routers'
import { auditableConexion, filaConexion } from '#network/conexion/consultas'
import GenerarScript, {
    type EntradaGenerarScript,
    type ScriptConexion,
} from '#network/conexion/actions/generar_script'

/**
 * `routers.rotar_conexion`: invalida el peer del router (borra su clave pública, vuelve a
 * `pendiente` y emite `router.conexion_rotada` para que `wireguard` lo quite) y genera un script
 * nuevo (`routers.generar_script`, anidada: token y clave de API nuevos). La IP del túnel no cambia.
 * Sin conexión previa equivale a generar el script.
 */
export default class RotarConexion extends DomainAction<EntradaGenerarScript, ScriptConexion> {
    readonly nombre = 'routers.rotar_conexion'

    protected async handle(input: EntradaGenerarScript, t: Transaccion): Promise<ScriptConexion> {
        t.fijarEntidad('router', input.router_id)
        const router = await verRouter(input.router_id, t.trx)
        t.fijarEmpresa(router.empresa_sugerida_id)
        const antes = await filaConexion(input.router_id, t.trx, true)
        if (antes) {
            await t.trx
                .from('network.routers_conexion')
                .where('router_id', input.router_id)
                .update({
                    public_key: null,
                    estado: 'pendiente',
                    ultimo_handshake: null,
                    registrado_en: null,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
            await t.registrarCambios(
                { tipo: 'router_conexion', id: input.router_id },
                auditableConexion(antes),
                auditableConexion(await filaConexion(input.router_id, t.trx)),
            )
            await t.emit('router.conexion_rotada', {
                router_id: input.router_id,
                empresa_id: router.empresa_sugerida_id,
                ip_tunel: antes.ip_tunel,
            })
        }
        return new GenerarScript().execute(input, t.ctx, { trx: t.trx })
    }
}
