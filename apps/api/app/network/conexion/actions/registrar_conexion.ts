import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import { filaConexion, hashToken, type FilaConexion } from '#network/conexion/consultas'
import { aplicarRegistro, type RespuestaRegistro } from '#network/conexion/registro'

export interface EntradaRegistrarConexion {
    token: string
    public_key: string
}

/** Token desconocido, vencido o ya usado (contrato §1: 410). */
export class TokenRegistroInvalido extends Problema {
    constructor(detalle: string) {
        super(410, 'token_invalido', 'Token de registro inválido', detalle)
    }
}

/**
 * `routers.registrar_conexion`: el router, sin sesión, manda `{ token, public_key }` desde el script
 * (`POST /routers/conexion/registrar`). El token es de un solo uso, del último script generado y
 * vale 24 h; si no, 410 `token_invalido` (la fila se bloquea: dos registros con el mismo token no
 * pasan los dos). La auditoría guarda el token como `***`.
 */
export default class RegistrarConexion extends DomainAction<EntradaRegistrarConexion, RespuestaRegistro> {
    readonly nombre = 'routers.registrar_conexion'

    protected async handle(input: EntradaRegistrarConexion, t: Transaccion): Promise<RespuestaRegistro> {
        const fila = (await t.trx
            .from('network.routers_conexion')
            .where('token_hash', hashToken(input.token))
            .forUpdate()
            .select('router_id')
            .first()) as Pick<FilaConexion, 'router_id'> | null
        if (!fila) {
            throw new TokenRegistroInvalido('El token no existe o fue reemplazado por un script más nuevo')
        }
        t.fijarEntidad('router', fila.router_id)
        const conexion = (await filaConexion(fila.router_id, t.trx))!
        if (conexion.token_usado_en) {
            throw new TokenRegistroInvalido('El token ya se usó; genera un script nuevo')
        }
        if (!conexion.token_vence || new Date(conexion.token_vence).getTime() <= Date.now()) {
            throw new TokenRegistroInvalido('El token venció; genera un script nuevo')
        }
        return aplicarRegistro(t, conexion, input.public_key)
    }
}
