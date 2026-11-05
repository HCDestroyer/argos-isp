import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ReglaNegocio } from '#shared/errores'
import { actualizarConVersion, verificarVersion } from '#shared/version'
import {
    servidorParaAuditoria,
    verServidorPppoe,
    verVlan,
    vlanParaAuditoria,
    type ServidorPppoeVista,
    type VlanVista,
} from '#network/red_acceso/consultas'
import { calcularDiffTomarControl, type DiffTomarControl } from '#network/red_acceso/inventario'
import { campo, emitirRedAcceso, exigirVisible } from '#network/red_acceso/reglas'

export type EntidadTomarControl = 'vlan' | 'servidor_pppoe'

export interface EntradaTomarControl {
    entidad: EntidadTomarControl
    id: number
    version: number
    /** `huella` de la vista previa: si el router cambió desde entonces → 409 `router_cambio` */
    huella: string
}

export interface VistaPreviaTomarControl extends DiffTomarControl {
    entidad: EntidadTomarControl
    id: number
    router_id: number
    version: number
    estado: 'administrado' | 'adoptado'
    /** requisitos de Argos que faltan (p. ej. `red_requerida`); con alguno, tomar control da 422 */
    faltan: Array<{ field: string; rule: string; message: string }>
}

async function leer(entidad: EntidadTomarControl, id: number, t?: Transaccion) {
    return entidad === 'vlan' ? verVlan(id, t?.trx) : verServidorPppoe(id, t?.trx)
}

function faltantes(entidad: EntidadTomarControl, fila: VlanVista | ServidorPppoeVista) {
    if (entidad === 'servidor_pppoe' && (fila as ServidorPppoeVista).red_ipv4_id === null) {
        return [
            {
                field: 'red_ipv4_id',
                rule: 'red_requerida',
                message:
                    'Asigna la red IPv4 del servidor antes de administrarlo: de ella sale el local-address',
            },
        ]
    }
    return []
}

/**
 * Vista previa de «tomar control» (`contratos/red-acceso.md` §4.1): lo que Argos cambiaría en el
 * router al administrar el objeto adoptado. El diff lo calcula A2 leyendo el router
 * (`vistaPreviaTomarControl`); mientras no exista, 501. No escribe nada.
 */
export async function vistaPreviaTomarControl(
    entidad: EntidadTomarControl,
    id: number,
    requestId: string,
): Promise<VistaPreviaTomarControl> {
    const fila = await leer(entidad, id)
    const diff = await calcularDiffTomarControl(
        { router_id: fila.router_id, entidad, id, ros_id: fila.ros_id },
        requestId,
    )
    return {
        entidad,
        id,
        router_id: fila.router_id,
        version: fila.version,
        estado: fila.estado,
        faltan: faltantes(entidad, fila),
        ...diff,
    }
}

/**
 * `red_acceso.tomar_control`: pasa una VLAN o un servidor PPPoE `adoptado` a `administrado`. Vuelve
 * a pedir el diff a A2 y lo compara con la `huella` de la vista previa (409 `router_cambio`); la
 * fila lleva `version` (409). Emite `red_acceso.cambiada` con `accion: 'tomar_control'`: A2 escribe
 * el comment de Argos, el perfil `argosisp-pppoe-<id>` y lo deja como dice Argos.
 */
export default class TomarControlRedAcceso extends DomainAction<
    EntradaTomarControl,
    VlanVista | ServidorPppoeVista
> {
    readonly nombre = 'red_acceso.tomar_control'

    protected async handle(
        input: EntradaTomarControl,
        t: Transaccion,
    ): Promise<VlanVista | ServidorPppoeVista> {
        t.fijarEntidad(input.entidad, input.id)
        const tabla = input.entidad === 'vlan' ? 'network.vlans' : 'network.servidores_pppoe'
        await t.trx.from(tabla).where('id', input.id).forUpdate().first()
        const antes = await leer(input.entidad, input.id, t)
        exigirVisible(t.ctx, antes.empresa_id)
        t.fijarEmpresa(antes.empresa_id ?? t.ctx.empresaId ?? null)
        verificarVersion(tabla, input.id, antes.version, input.version)
        if (antes.estado === 'administrado') {
            throw new ReglaNegocio('Ya lo administra Argos', 'ya_administrado')
        }
        const falta = faltantes(input.entidad, antes)[0]
        if (falta) throw campo(falta.field, falta.message, falta.rule)
        const diff = await calcularDiffTomarControl(
            { router_id: antes.router_id, entidad: input.entidad, id: input.id, ros_id: antes.ros_id },
            t.ctx.requestId,
        )
        if (diff.huella !== input.huella) {
            throw new Conflicto(
                'El router cambió desde la vista previa: vuelve a pedirla antes de tomar control',
                'router_cambio',
            )
        }
        t.anotarAuditoria({ cambios_router: diff.cambios.length, huella: diff.huella })
        await actualizarConVersion(t.trx, tabla, input.id, input.version, { estado: 'administrado' })
        const despues = await leer(input.entidad, input.id, t)
        if (input.entidad === 'vlan') {
            await t.registrarCambios(
                { tipo: 'vlan', id: input.id },
                vlanParaAuditoria(antes as VlanVista),
                vlanParaAuditoria(despues as VlanVista),
            )
        } else {
            await t.registrarCambios(
                { tipo: 'servidor_pppoe', id: input.id },
                servidorParaAuditoria(antes as ServidorPppoeVista),
                servidorParaAuditoria(despues as ServidorPppoeVista),
            )
        }
        await emitirRedAcceso(t, {
            router_id: despues.router_id,
            empresa_id: despues.empresa_id,
            entidad: input.entidad,
            entidad_id: input.id,
            accion: 'tomar_control',
            estado: 'administrado',
            campos: ['estado'],
        })
        return despues
    }
}
