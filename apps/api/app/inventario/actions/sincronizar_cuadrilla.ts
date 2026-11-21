import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { usuarioIris } from '#core/integraciones_iris'
import { alcanceEmpresasDeUsuario } from '#core/alcance_empresas'
import { bodegasDelUsuario } from '#inventario/tecnicos'

/**
 * `inventario.sincronizar_cuadrilla`: aplica un `cuadrilla.creada` / `cuadrilla.actualizada` de Iris
 * (contrato Iris 0.11.0 §3.9, A47; §10.6 c, d, h, l). Lo llama el receptor de webhooks de Iris (y la
 * conciliación con `GET <iris>/integraciones/argosisp/cuadrillas/:id`) con el actor `sistema`.
 *
 * - Una bodega `cuadrilla` por cuadrilla y empresa (`cuadrilla_id_iris`, `empresa_id` obligatorio); se
 *   crea con el primer evento.
 * - Solo aplica una `version` **mayor** que la última aplicada (`ignorado: version_vieja`); nunca mira
 *   `ocurrido_en`.
 * - Miembros: solo acepta un `id_externo` de un usuario **activo**, técnico de la empresa (bodega `tecnico`
 *   o rol `tecnico`) y con la empresa en su alcance; los demás quedan `aceptado = false` con su motivo
 *   (`miembro_rechazado` en el panel). Un miembro sin vínculo I1 (`id_externo: null`) queda registrado
 *   sin usuario y no consume. Cada vínculo lleva su historial (`desde`, `hasta`).
 * - Jefe: debe estar en `miembros[]` con `id_externo` aceptado; si no, la cuadrilla queda **sin jefe**
 *   (y los traslados esperan). El historial del jefe sirve a la recepción (§3.9, «jefe al recibir»).
 * - `activa: false`: cierra todos los vínculos y el jefe (la bodega y su existencia quedan).
 * - Fuera del alcance de empresas del usuario técnico Iris: `ignorado: fuera_de_alcance`.
 *
 * Audita el diff (`audit.cambios` de la bodega: `version`, `jefe_id`, `miembros`).
 */

export interface MiembroCuadrillaIris {
    usuario_id: string | number
    id_externo?: string | number | null
}

export interface EntradaSincronizarCuadrilla {
    cuadrilla_id: string | number
    empresa_id: number
    version: number
    nombre?: string | null
    activa?: boolean | null
    miembros: MiembroCuadrillaIris[]
    jefe_usuario_id?: string | number | null
}

export interface ResultadoSincronizarCuadrilla {
    bodega_id: number | null
    aplicado: boolean
    /** sin aplicar: `version_vieja`, `fuera_de_alcance`, `empresa_inexistente` */
    motivo: string | null
    miembros: Array<{
        usuario_id: string
        id_externo: string | null
        aceptado: boolean
        motivo: string | null
    }>
    jefe_id: number | null
}

const ID_IRIS = /^[A-Za-z0-9_-]{1,64}$/
const ID_CUADRILLA = /^[A-Za-z0-9._:-]{1,100}$/

function textoId(valor: unknown): string | null {
    if (valor === null || valor === undefined) return null
    const t = String(valor).trim()
    return t === '' ? null : t
}

export default class SincronizarCuadrilla extends DomainAction<
    EntradaSincronizarCuadrilla,
    ResultadoSincronizarCuadrilla
> {
    readonly nombre = 'inventario.sincronizar_cuadrilla'

    protected async handle(
        input: EntradaSincronizarCuadrilla,
        t: Transaccion,
    ): Promise<ResultadoSincronizarCuadrilla> {
        const cuadrillaId = textoId(input.cuadrilla_id)
        if (!cuadrillaId || !ID_CUADRILLA.test(cuadrillaId)) {
            throw new ValidacionFallida([{ field: 'cuadrilla_id', message: 'Id inválido', rule: 'formato' }])
        }
        if (!Number.isSafeInteger(input.version) || input.version < 1) {
            throw new ValidacionFallida([{ field: 'version', message: 'Entero ≥ 1', rule: 'version' }])
        }
        const empresaId = Number(input.empresa_id)
        t.fijarEmpresa(empresaId)
        const vacio = (motivo: string, bodegaId: number | null = null): ResultadoSincronizarCuadrilla => ({
            bodega_id: bodegaId,
            aplicado: false,
            motivo,
            miembros: [],
            jefe_id: null,
        })
        const empresa = await t.trx.from('core.empresas').where('id', empresaId).select('id').first()
        if (!empresa) return vacio('empresa_inexistente')
        const iris = await usuarioIris(t.trx)
        if (iris) {
            const alcance = await alcanceEmpresasDeUsuario(iris, t.trx)
            if (!alcance.alcanceGlobal && !alcance.empresas.includes(empresaId)) {
                return vacio('fuera_de_alcance')
            }
        }

        // la bodega (con lock): una por cuadrilla y empresa
        let bodega = (await t.trx
            .from('inventario.bodegas')
            .where({ empresa_id: empresaId, tipo: 'cuadrilla', cuadrilla_id_iris: cuadrillaId })
            .forUpdate()
            .select('id', 'cuadrilla_version', 'jefe_id', 'nombre')
            .first()) as {
            id: number
            cuadrilla_version: number | null
            jefe_id: number | null
            nombre: string
        } | null
        if (!bodega) {
            const base = `Cuadrilla ${input.nombre?.trim() || cuadrillaId}`.slice(0, 120)
            const repetido = await t.trx
                .from('inventario.bodegas')
                .where('empresa_id', empresaId)
                .whereRaw('lower(nombre) = lower(?)', [base])
                .select('id')
                .first()
            const [fila] = (await t.trx
                .insertQuery()
                .table('inventario.bodegas')
                .insert({
                    empresa_id: empresaId,
                    nombre: repetido ? `${base} (${cuadrillaId})` : base,
                    tipo: 'cuadrilla',
                    cuadrilla_id_iris: cuadrillaId,
                })
                .returning(['id', 'nombre'])) as Array<{ id: number; nombre: string }>
            bodega = { id: Number(fila!.id), cuadrilla_version: null, jefe_id: null, nombre: fila!.nombre }
        }
        const bodegaId = Number(bodega.id)
        t.fijarEntidad('bodega', bodegaId)
        if (bodega.cuadrilla_version !== null && input.version <= Number(bodega.cuadrilla_version)) {
            return vacio('version_vieja', bodegaId)
        }

        // miembros que llegan, con su validación
        const activa = input.activa !== false
        const llegan = new Map<
            string,
            { id_externo: string | null; usuarioId: number | null; motivo: string | null }
        >()
        for (const m of activa ? (input.miembros ?? []) : []) {
            const idIris = textoId(m.usuario_id)
            if (!idIris || !ID_IRIS.test(idIris) || llegan.has(idIris)) continue
            const idExterno = textoId(m.id_externo)
            llegan.set(idIris, {
                id_externo: idExterno,
                ...(await this.validarMiembro(t, idExterno, empresaId)),
            })
        }

        const antes = (await t.trx
            .from('inventario.cuadrilla_miembros')
            .where('bodega_id', bodegaId)
            .whereNull('hasta')
            .forUpdate()
            .select('id', 'iris_usuario_id', 'usuario_id', 'aceptado', 'motivo')) as Array<{
            id: number
            iris_usuario_id: string
            usuario_id: number | null
            aceptado: boolean
            motivo: string | null
        }>
        const ahora = t.trx.knexRawQuery('now()')
        // un vínculo que sigue igual se conserva (su `desde` no cambia); el que cambió se cierra y se abre otro
        const vigentes = new Set<string>()
        for (const fila of antes) {
            const nuevo = llegan.get(fila.iris_usuario_id)
            const usuarioAntes = fila.usuario_id === null ? null : Number(fila.usuario_id)
            if (nuevo && nuevo.usuarioId === usuarioAntes && nuevo.motivo === fila.motivo) {
                vigentes.add(fila.iris_usuario_id)
            } else {
                await t.trx
                    .from('inventario.cuadrilla_miembros')
                    .where('id', fila.id)
                    .update({ hasta: ahora })
            }
        }
        for (const [idIris, m] of llegan) {
            if (vigentes.has(idIris)) continue
            await t.trx
                .insertQuery()
                .table('inventario.cuadrilla_miembros')
                .insert({
                    bodega_id: bodegaId,
                    iris_usuario_id: idIris,
                    usuario_id: m.usuarioId,
                    aceptado: m.motivo === null,
                    motivo: m.motivo,
                    version: input.version,
                })
        }

        // jefe: miembro aceptado con id_externo; si no, sin jefe
        const idJefe = textoId(input.jefe_usuario_id)
        const candidato = idJefe ? llegan.get(idJefe) : undefined
        const jefe =
            activa && idJefe && candidato && candidato.motivo === null && candidato.usuarioId
                ? { usuarioId: candidato.usuarioId, idIris: idJefe }
                : null
        const jefeAntes = (await t.trx
            .from('inventario.cuadrilla_jefes')
            .where('bodega_id', bodegaId)
            .whereNull('hasta')
            .forUpdate()
            .select('id', 'usuario_id', 'iris_usuario_id')
            .first()) as { id: number; usuario_id: number; iris_usuario_id: string } | null
        const mismoJefe =
            jefeAntes &&
            jefe &&
            Number(jefeAntes.usuario_id) === jefe.usuarioId &&
            jefeAntes.iris_usuario_id === jefe.idIris
        if (jefeAntes && !mismoJefe) {
            await t.trx.from('inventario.cuadrilla_jefes').where('id', jefeAntes.id).update({ hasta: ahora })
        }
        if (jefe && !mismoJefe) {
            await t.trx.insertQuery().table('inventario.cuadrilla_jefes').insert({
                bodega_id: bodegaId,
                usuario_id: jefe.usuarioId,
                iris_usuario_id: jefe.idIris,
                version: input.version,
            })
        }

        const miembrosAntes = antes
            .map((f) => `${f.iris_usuario_id}:${f.usuario_id ?? '-'}:${f.aceptado ? 'ok' : (f.motivo ?? '')}`)
            .toSorted()
        const miembros = [...llegan.entries()].map(([idIris, m]) => ({
            usuario_id: idIris,
            id_externo: m.id_externo,
            aceptado: m.motivo === null,
            motivo: m.motivo,
        }))
        const miembrosDespues = [...llegan.entries()]
            .map(([idIris, m]) => `${idIris}:${m.usuarioId ?? '-'}:${m.motivo === null ? 'ok' : m.motivo}`)
            .toSorted()
        await t.trx
            .from('inventario.bodegas')
            .where('id', bodegaId)
            .update({
                cuadrilla_version: input.version,
                jefe_id: jefe?.usuarioId ?? null,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: ahora,
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'bodega', id: bodegaId },
            {
                cuadrilla_version: bodega.cuadrilla_version,
                jefe_id: bodega.jefe_id === null ? null : Number(bodega.jefe_id),
                miembros: miembrosAntes,
            },
            { cuadrilla_version: input.version, jefe_id: jefe?.usuarioId ?? null, miembros: miembrosDespues },
        )
        return {
            bodega_id: bodegaId,
            aplicado: true,
            motivo: null,
            miembros,
            jefe_id: jefe?.usuarioId ?? null,
        }
    }

    /** Usuario de Argos aceptable como miembro (§10.6 c); `motivo` si no. */
    private async validarMiembro(
        t: Transaccion,
        idExterno: string | null,
        empresaId: number,
    ): Promise<{ usuarioId: number | null; motivo: string | null }> {
        if (idExterno === null) return { usuarioId: null, motivo: 'sin_vinculo' }
        if (!/^\d{1,18}$/.test(idExterno)) return { usuarioId: null, motivo: 'usuario_inexistente' }
        const usuarioId = Number(idExterno)
        const usuario = await t.trx.from('core.usuarios').where('id', usuarioId).select('activo').first()
        if (!usuario) return { usuarioId: null, motivo: 'usuario_inexistente' }
        if (!usuario.activo) return { usuarioId, motivo: 'usuario_inactivo' }
        // técnico de la empresa: con bodega de técnico en ella, o con el rol `tecnico` y la empresa en su alcance
        const propias = await bodegasDelUsuario(t.trx, usuarioId, [empresaId])
        if (propias.length > 0) {
            return { usuarioId, motivo: null }
        }
        const rol = await t.trx
            .from('core.usuarios_roles as ur')
            .join('core.roles as r', 'r.id', 'ur.role_id')
            .where('ur.usuario_id', usuarioId)
            .where('r.nombre', 'tecnico')
            .select('ur.usuario_id')
            .first()
        if (!rol) return { usuarioId, motivo: 'no_es_tecnico' }
        const alcance = await alcanceEmpresasDeUsuario(usuarioId, t.trx)
        if (!alcance.alcanceGlobal && !alcance.empresas.includes(empresaId)) {
            return { usuarioId, motivo: 'fuera_de_la_empresa' }
        }
        return { usuarioId, motivo: null }
    }
}
