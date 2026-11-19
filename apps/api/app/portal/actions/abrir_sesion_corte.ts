import { isIP } from 'node:net'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import { nombreParcial } from '#portal/consultas'
import { identificarOrigen, type OrigenPortal } from '#portal/identificacion'
import { empresaDelServicio, marcaDeEmpresa } from '#portal/marca'
import { abrirSesionPortal, configContrasenas } from '#portal/acceso/contrasenas'
import type { ResultadoVerificacion } from '#portal/actions/verificar_codigo'

/**
 * «Ver mi cuenta» en `/corte` (`POST /portal/corte/sesion`, pedido del PM: «Sí, directo»).
 *
 * Si la página de corte identificó el servicio, abre la sesión del portal de su cliente sin pedir
 * nada más. La identificación se rehace aquí, en el momento, con la misma precedencia que `/corte`
 * (`identificarOrigen`) y una condición más:
 *
 * - **por código de corte:** el código resuelve ahora (abierto o dentro de la gracia de
 *   `PORTAL_CODIGO_CORTE_GRACIA_MIN`, la misma vigencia que el resto de la página);
 * - **por IP:** además de no ser de infraestructura, la IP debe estar en una **sesión PPPoE vigente**
 *   (`network.sesiones.fin IS NULL`) de ese servicio. Una asignación estática sin sesión no basta.
 *
 * La sesión es corta (`PORTAL_SESION_CORTE_MAX_S`, 15 min por defecto, sin pasar de la inactividad
 * normal), tiene alcance al cliente del servicio, `origen = corte` y guarda el `servicio_id`. La IP
 * no autentica a nadie más allá de esto: el actor de la acción es `sistema` hasta abrir la sesión,
 * y la fila de auditoría queda como `cliente` (canal `portal`), como el acceso por código.
 */
export default class AbrirSesionCorte extends DomainAction<OrigenPortal, ResultadoVerificacion> {
    readonly nombre = 'portal.abrir_sesion_corte'
    protected readonly camposEntradaOcultos = ['codigo']

    protected async handle(origen: OrigenPortal, t: Transaccion): Promise<ResultadoVerificacion> {
        const identificado = await identificarOrigen(origen, t.trx)
        const servicioId = identificado.servicioId
        if (servicioId === null || identificado.por === null) throw new SinIdentificar()
        if (identificado.por === 'ip' && !(await ipEnSesionVigente(t, servicioId, origen.ip))) {
            throw new SinIdentificar()
        }

        const servicio = (await t.trx
            .from('core.servicios as s')
            .join('core.clientes as c', 'c.id', 's.cliente_id')
            .where('s.id', servicioId)
            .select('s.cliente_id', 'c.nombre')
            .first()) as { cliente_id: number | string; nombre: string }
        const clienteId = Number(servicio.cliente_id)
        const empresaId = await empresaDelServicio(servicioId, t.trx)
        t.fijarEntidad('cliente', clienteId)
        t.fijarEmpresa(empresaId)
        t.anotarAuditoria({ servicio_id: servicioId, por: identificado.por })
        t.identificarActor({ tipo: 'cliente', id: clienteId })

        const sesion = await abrirSesionPortal(t.trx, {
            clienteId,
            origen: 'corte',
            ip: origen.ip,
            servicioId,
            maxS: configContrasenas().sesionCorteMaxS,
        })
        return {
            token: sesion.token,
            sesion: {
                cliente: { nombre_parcial: nombreParcial(servicio.nombre) },
                expira_en: sesion.expiraEn.toISO()!,
                empresa_principal: await marcaDeEmpresa(empresaId ?? 1, t.trx),
                origen: 'corte',
                debe_cambiar_contrasena: false,
            },
        }
    }
}

/** ¿La IP está en una sesión PPPoE abierta de ese servicio (IPv4 exacta o dentro de sus prefijos v6)? */
async function ipEnSesionVigente(t: Transaccion, servicioId: number, ip: string): Promise<boolean> {
    const v4 = isIP(ip) === 4
    const resultado = await t.trx.rawQuery(
        `SELECT EXISTS (
             SELECT 1 FROM network.sesiones se
              WHERE se.servicio_id = ? AND se.fin IS NULL
                AND (${v4 ? 'se.ipv4 = ?::inet' : 'se.prefijo_enlace_v6 >>= ?::inet OR se.prefijo_delegado_v6 >>= ?::inet'})
         ) AS vigente`,
        v4 ? [servicioId, ip] : [servicioId, ip, ip],
    )
    return (resultado.rows[0] as { vigente: boolean }).vigente === true
}

/** 422: la página de corte no identifica ahora el servicio (o la IP no está en una sesión vigente). */
export class SinIdentificar extends ReglaNegocio {
    constructor() {
        super(
            'No pudimos confirmar tu conexión. Entra con tu documento y contraseña o pide un código.',
            'no_identificado',
        )
    }
}
