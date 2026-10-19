import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto } from '#shared/errores'
import { generarTokenNodo } from '#portal/nodo_portal'
import { verNodoPortal, type NodoPortalVista } from '#portal/nodos_portal'

export interface EntradaCrearNodoPortal {
    nombre: string
}

export interface SalidaCrearNodoPortal {
    /** valor en claro (`argn_...`); solo se devuelve aquí, nunca se audita */
    token: string
    datos: NodoPortalVista
}

/**
 * Da de alta un nodo portal remoto (contrato `nodo-portal.md`): genera su token, guarda solo el
 * sha256 y lo devuelve una única vez. Permiso de la ruta: `nodos_portal.administrar`.
 */
export default class CrearNodoPortal extends DomainAction<EntradaCrearNodoPortal, SalidaCrearNodoPortal> {
    readonly nombre = 'nodos_portal.crear'

    protected async handle(input: EntradaCrearNodoPortal, t: Transaccion): Promise<SalidaCrearNodoPortal> {
        const existe = await t.trx
            .from('core.nodos_portal')
            .where('nombre', input.nombre)
            .select('id')
            .first()
        if (existe) {
            throw new Conflicto(`Ya existe un nodo portal llamado ${input.nombre}`, 'nodo_portal_existe')
        }
        const { valor, hash } = generarTokenNodo()
        let fila: { id: number } | undefined
        try {
            ;[fila] = (await t.trx
                .insertQuery()
                .table('core.nodos_portal')
                .insert({ nombre: input.nombre, hash, creado_por: usuarioDelActor(t.ctx.actor) })
                .returning('id')) as Array<{ id: number }>
        } catch (error) {
            // dos altas simultáneas con el mismo nombre: la segunda choca con el UNIQUE
            if ((error as { code?: string }).code === '23505') {
                throw new Conflicto(`Ya existe un nodo portal llamado ${input.nombre}`, 'nodo_portal_existe')
            }
            throw error
        }
        const id = Number(fila!.id)
        t.fijarEntidad('nodo_portal', id)

        const datos = await verNodoPortal(id, t.trx)
        await t.registrarCambios({ tipo: 'nodo_portal', id }, null, { nombre: datos.nombre })
        return { token: valor, datos }
    }
}
