import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema, Prohibido } from '#shared/errores'
import { usuarioHorus } from '#core/integraciones_horus'
import { usuarioIris } from '#core/integraciones_iris'
import {
    VIGENCIA_TICKET_S,
    generarSecretoSso,
    urlPanel,
    type ConectorSso,
    type TipoDestinoSso,
} from '#core/sso'

/** Lo que distingue a cada sistema que pide tickets: su usuario técnico y la fila de su conector. */
const CONECTORES: Record<
    ConectorSso,
    { nombre: string; usuario: typeof usuarioHorus; tabla: string; apagado: () => Problema }
> = {
    horus: {
        nombre: 'Horus',
        usuario: usuarioHorus,
        tabla: 'integraciones.horus_conector',
        apagado: () => new ConectorHorusApagado(),
    },
    iris: {
        nombre: 'Iris',
        usuario: usuarioIris,
        tabla: 'integraciones.iris_conector',
        apagado: () => new ConectorIrisApagado(),
    },
}

export interface EntradaEmitirTicketSso {
    /** sistema que pide el ticket (lo fija la ruta: `/integraciones/<conector>/sso/tickets`) */
    conector: ConectorSso
    usuario: { id_externo: string; correo?: string | null; nombre?: string | null }
    destino: { tipo: TipoDestinoSso; id_externo: string }
    /** id (`core.tokens_api.id`) del token de integración que hizo la petición; el ticket queda ligado a él. No se llama `token_*` para que la auditoría no lo enmascare */
    atk_id: number
}

export interface SalidaEmitirTicketSso {
    /** `https://<panel>/sso/entrar#<ticket>`: el ticket va en el fragmento */
    url: string
    expira_en: string
}

/**
 * Paso 1 del autologin (contrato Horus §1.5; Iris §1.3): el servidor de Horus o de Iris, con su
 * token `atk_` y el permiso `sso.emitir`, pide un ticket para que uno de sus usuarios abra un
 * recurso de Argos. El `conector` lo fija la ruta y las reglas son las mismas para los dos.
 *
 * - Solo un token del usuario técnico de ese conector puede pedirlo (403 para cualquier otro token o sesión,
 *   aunque tenga `sso.emitir` por ser admin): el ticket queda ligado a ese token (el conector).
 * - Si el conector se preparó con un enlace (§1.4), solo el `atk_` de ese canje (403 con otro
 *   token del usuario técnico) y con el conector encendido (409 `horus_apagado` / `iris_apagado`).
 * - Destino `cliente` o `servicio` (ids de Argos); `router` y `hallazgo` son ids de Horus → 422.
 * - Se guarda solo el sha256; vence a los 60 s y sirve una vez. El valor nunca llega a la auditoría
 *   (que registra quién lo pidió, para qué usuario externo y qué recurso).
 * - No da privilegios: el canje abre la sesión del usuario local vinculado, con sus permisos.
 */
export default class EmitirTicketSso extends DomainAction<EntradaEmitirTicketSso, SalidaEmitirTicketSso> {
    readonly nombre = 'sso.emitir'

    protected async handle(input: EntradaEmitirTicketSso, t: Transaccion): Promise<SalidaEmitirTicketSso> {
        const conector = input.conector
        const definicion = CONECTORES[conector]
        const tecnico = await definicion.usuario(t.trx)
        const token = (await t.trx
            .from('core.tokens_api')
            .where('id', input.atk_id)
            .whereNull('revocado_en')
            .select('usuario_id')
            .first()) as { usuario_id: number } | null
        if (tecnico === null || !token || Number(token.usuario_id) !== tecnico) {
            throw new Prohibido(
                `Solo el token de la integración ${definicion.nombre} puede pedir tickets de autologin`,
            )
        }
        // Conector preparado con un enlace (§1.4): solo vale el token de ese canje y con el conector
        // encendido (contrato 1.5.0 y 1.7.0).
        const enlazado = (await t.trx
            .from(definicion.tabla)
            .where('id', 1)
            .select('activo', 'token_argos_id', 'conectado_por_enlace_en')
            .first()) as {
            activo: boolean
            token_argos_id: number | null
            conectado_por_enlace_en: Date | null
        } | null
        if (enlazado?.conectado_por_enlace_en) {
            if (Number(enlazado.token_argos_id) !== Number(input.atk_id)) {
                throw new Prohibido('El conector se preparó con un enlace: solo vale el token de ese canje')
            }
            if (!enlazado.activo) throw definicion.apagado()
        }

        const base = urlPanel()
        const { valor, hash } = generarSecretoSso()
        const expiraEn = new Date(Date.now() + VIGENCIA_TICKET_S * 1000)
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.sso_tickets')
            .insert({
                hash,
                conector,
                token_api_id: input.atk_id,
                usuario_id_externo: input.usuario.id_externo,
                usuario_correo: input.usuario.correo ?? null,
                usuario_nombre: input.usuario.nombre ?? null,
                destino_tipo: input.destino.tipo,
                destino_id_externo: input.destino.id_externo,
                expira_en: expiraEn,
            })
            .returning('id')) as Array<{ id: number }>
        t.fijarEntidad('sso_ticket', fila!.id)
        return { url: `${base}/sso/entrar#${valor}`, expira_en: expiraEn.toISOString() }
    }
}

/** 409: el conector preparado con un enlace sigue apagado; no se aceptan tickets todavía. */
export class ConectorHorusApagado extends Problema {
    constructor() {
        super(
            409,
            'horus_apagado',
            'Conector Horus apagado',
            'Un administrador de Argos debe encender el conector con Horus antes de usar el autologin',
        )
    }
}

/** 409: el conector Iris preparado con un enlace sigue apagado; no se aceptan tickets todavía. */
export class ConectorIrisApagado extends Problema {
    constructor() {
        super(
            409,
            'iris_apagado',
            'Conector Iris apagado',
            'Un administrador de Argos debe encender el conector con Iris antes de usar el autologin',
        )
    }
}
