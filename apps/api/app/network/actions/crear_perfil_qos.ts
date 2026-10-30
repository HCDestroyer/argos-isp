import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { exigirEmpresaActiva } from '#core/empresas'
import { ACCION_QOS, exigirEscrituraPerfil, filaClase } from '#network/actions/qos_comun'
import { clasesDePerfil, verPerfil, type PerfilQosVista } from '#network/consultas/qos'

export interface EntradaCrearPerfilQos {
    nombre: string
    descripcion?: string | null
    /** null o ausente = común a todas las empresas (solo con alcance global) */
    empresa_id?: number | null
    /** perfil del que se copian las clases; por defecto el predeterminado */
    copiar_de?: number
}

/**
 * Crea un perfil de QoS por clases (`contratos/qos.md` §4) copiando las clases de otro (por defecto, el
 * predeterminado), así nace válido (con su `resto`). Ningún router lo usa todavía: no emite evento.
 * 409 `qos_nombre_duplicado` si ya hay un perfil con ese nombre en la empresa (o entre los comunes).
 */
export default class CrearPerfilQos extends DomainAction<EntradaCrearPerfilQos, PerfilQosVista> {
    readonly nombre = ACCION_QOS

    protected async handle(input: EntradaCrearPerfilQos, t: Transaccion): Promise<PerfilQosVista> {
        const empresaId = input.empresa_id ?? null
        if (empresaId !== null) await exigirEmpresaActiva(t.trx, empresaId)
        exigirEscrituraPerfil(t, { empresa_id: empresaId })

        const origen = input.copiar_de
            ? ((await t.trx
                  .from('network.qos_perfiles')
                  .where('id', input.copiar_de)
                  .select('id', 'empresa_id')
                  .first()) as { id: number; empresa_id: number | null } | null)
            : ((await t.trx
                  .from('network.qos_perfiles')
                  .where('predeterminado', true)
                  .select('id', 'empresa_id')
                  .first()) as { id: number; empresa_id: number | null } | null)
        if (!origen) {
            throw new NoEncontrado(`El perfil de QoS ${input.copiar_de ?? 'predeterminado'} no existe`)
        }
        if (origen.empresa_id !== null && Number(origen.empresa_id) !== empresaId) {
            throw new NoEncontrado(`El perfil de QoS ${origen.id} no existe`)
        }

        const repetido = await t.trx
            .from('network.qos_perfiles')
            .whereRaw('lower(nombre) = lower(?)', [input.nombre.trim()])
            .where((q) => (empresaId === null ? q.whereNull('empresa_id') : q.where('empresa_id', empresaId)))
            .first()
        if (repetido) {
            throw new Conflicto(`Ya existe el perfil de QoS «${input.nombre}»`, 'qos_nombre_duplicado')
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('network.qos_perfiles')
            .insert({
                nombre: input.nombre.trim(),
                descripcion: input.descripcion ?? null,
                empresa_id: empresaId,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('qos_perfil', id)

        // Copia de las clases activas con los ids de `reclasifica_de` traducidos.
        const todas = await clasesDePerfil(Number(origen.id), t.trx)
        const clases = todas.filter((c) => c.activa)
        const nuevos = new Map<number, number>()
        for (const c of clases) {
            const [nueva] = (await t.trx
                .insertQuery()
                .table('network.qos_clases')
                .insert({ ...filaClase({ ...c, reclasifica_de: [] }), perfil_id: id })
                .returning('id')) as Array<{ id: number }>
            nuevos.set(c.id, Number(nueva!.id))
        }
        for (const c of clases) {
            if (c.reclasifica_de.length === 0) continue
            await t.trx
                .from('network.qos_clases')
                .where('id', nuevos.get(c.id)!)
                .update({
                    reclasifica_de: c.reclasifica_de.map((o) => nuevos.get(o)).filter((o) => o !== undefined),
                })
        }
        const perfil = await verPerfil(id, t.trx)
        const { advertencias, ...auditable } = perfil
        void advertencias
        await t.registrarCambios({ tipo: 'qos_perfil', id }, null, auditable)
        return perfil
    }
}
