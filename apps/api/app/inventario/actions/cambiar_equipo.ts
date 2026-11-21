import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { normalizarMac, normalizarSerie } from '#inventario/unidades'
import { servicioDe, empresaDeLaUnidad } from '#inventario/comodato'
import { columnasOrigenExterno, origenExternoDe, type OrigenExternoTipo } from '#inventario/origen_externo'
import {
    bodegaDeUnidadDelTecnico,
    fechaKardexDe,
    idIrisDelActor,
    momentoDeLaOperacion,
} from '#inventario/cuadrillas'
import { bodegaDelTecnico, resolverTecnico, type TecnicoExterno } from '#inventario/tecnicos'
import { estadoEquipo, motivoDelEstado, type EstadoEquipo } from '#inventario/equipos'
import { fijarActorTecnico } from '#inventario/actor_tecnico'
import DevolverComodato from '#inventario/actions/devolver_comodato'
import AsignarComodato from '#inventario/actions/asignar_comodato'

/**
 * `servicios.cambiar_equipo` (`POST /servicios/:id/equipos/cambiar`, contrato Iris 0.12.0 §3.10, A48):
 * sale una unidad en comodato del servicio y entra otra, **en una sola transacción**.
 *
 * - `motivo`: `danado`, `actualizacion`, `garantia`, `otro`; `destino_sale`: `funciona` (vuelve
 *   `disponible`, usada), `revision` o `danado` (queda en revisión), `garantia` (queda en garantía, sin
 *   enviar todavía: el RMA lo registra el personal). `funciona` con `danado` o `garantia`: 422.
 * - **La que sale** debe estar `en_comodato` en ese servicio (409 `unidad_no_es_del_servicio`; si ya no está
 *   en comodato, 409 `estado_unidad_cambiado`). Vuelve a la **bodega de donde sale la que entra**, con la
 *   devolución de siempre (baja del activo sin resultado, a su valor en libros). Nunca se da de baja aquí.
 * - **La que entra** (`unidad_id`, `serie` o `mac`) sigue la regla de A47: la personal del técnico o una
 *   cuadrilla de la que es miembro, comprobado antes de mirar su estado (403 `no_es_miembro`, 409
 *   `unidad_en_otra_bodega`), y `disponible` (409 `estado_unidad_cambiado`). Se presta con el comodato de
 *   siempre (alta del activo). El técnico es `tecnico` o, con el token de Iris, el miembro de cuadrilla
 *   vinculado a `X-Iris-Actor`; desde el panel puede faltar (la unidad sale de donde esté).
 * - `cobro_propuesto` (sin monto) entra en la cola de cobros de equipo, que decide una persona con
 *   `inventario.cobrar_equipo`. `nota` (≤ 500) no va en eventos ni en logs.
 * - Emite `inventario.comodato_devuelto`, `inventario.comodato_asignado`, `inventario.equipo_cambiado` y
 *   `inventario.unidad_estado_cambiado` de cada unidad.
 */

export const MOTIVOS_CAMBIO = ['danado', 'actualizacion', 'garantia', 'otro'] as const
export const DESTINOS_SALE = ['funciona', 'revision', 'garantia', 'danado'] as const

export interface EntradaCambiarEquipo {
    servicio_id: number
    sale: { unidad_id: number }
    entra: { unidad_id?: number | null; serie?: string | null; mac?: string | null }
    motivo: (typeof MOTIVOS_CAMBIO)[number]
    destino_sale: (typeof DESTINOS_SALE)[number]
    cobro_propuesto?: { motivo: string; nota?: string | null } | null
    nota?: string | null
    fecha?: string | null
    recibido_en_iris?: string | null
    tecnico?: TecnicoExterno | null
    /** `X-Iris-Actor` (de la cabecera) */
    iris_actor?: string | null
    origen_tipo?: OrigenExternoTipo | null
    origen_id?: string | null
}

export interface ResultadoCambiarEquipo {
    cambio_id: number
    sale: { unidad_id: number; estado: EstadoEquipo }
    entra: { unidad_id: number; estado: EstadoEquipo }
    cobro_propuesto_id: number | null
}

export default class CambiarEquipo extends DomainAction<EntradaCambiarEquipo, ResultadoCambiarEquipo> {
    readonly nombre = 'servicios.cambiar_equipo'

    protected async handle(input: EntradaCambiarEquipo, t: Transaccion): Promise<ResultadoCambiarEquipo> {
        const origenExterno = origenExternoDe(input)
        if ((input.motivo === 'danado' || input.motivo === 'garantia') && input.destino_sale === 'funciona') {
            throw new ValidacionFallida([
                {
                    field: 'destino_sale',
                    message: `Un equipo que sale por ${input.motivo === 'danado' ? 'dañado' : 'garantía'} no vuelve como «funciona»`,
                    rule: 'destino_sale',
                },
            ])
        }
        const momento =
            input.recibido_en_iris || input.fecha ? momentoDeLaOperacion(input) : { ocurridoEn: null }
        t.fijarEntidad('servicio', input.servicio_id)

        // la que sale: en comodato en este servicio
        const empresaId = await empresaDeLaUnidad(t, input.sale.unidad_id)
        t.fijarEmpresa(empresaId)
        const servicio = await servicioDe(t, input.servicio_id, empresaId)
        const sale = (await t.trx
            .from('inventario.unidades')
            .where('id', input.sale.unidad_id)
            .select('id', 'estado', 'servicio_id')
            .first()) as { id: number; estado: string; servicio_id: number | null }
        if (sale.servicio_id === null || Number(sale.servicio_id) !== servicio.id) {
            throw new Conflicto(
                `La unidad ${sale.id} no está en comodato en el servicio ${servicio.id}`,
                'unidad_no_es_del_servicio',
                'La unidad no es del servicio',
            )
        }
        if (sale.estado !== 'en_comodato') throw estadoCambiado(sale.id, sale.estado)

        // la que entra: por id, serie o MAC en la empresa del servicio
        const entraId = await this.unidadQueEntra(t, input.entra, empresaId)
        if (entraId === sale.id) {
            throw new ValidacionFallida([
                { field: 'entra', message: 'La unidad que entra es la misma que sale', rule: 'distinta' },
            ])
        }
        // bodega de la que entra (A47: antes de mirar su estado)
        let bodegaId: number
        const tecnico = input.tecnico ?? (await this.tecnicoDelActor(t, input.iris_actor, empresaId))
        if (tecnico) {
            const r = await bodegaDeUnidadDelTecnico(
                t,
                entraId,
                { ...input, tecnico, bodega_id: null },
                empresaId,
                resolverTecnico,
                (u) => bodegaDelTecnico(t.trx, u, empresaId),
            )
            bodegaId = r.bodegaId
        } else {
            const idIris = idIrisDelActor(input.iris_actor)
            fijarActorTecnico(t, {
                actor: idIris ? `usuario:${idIris}` : null,
                usuarioId: null,
                ocurridoEn: momento.ocurridoEn,
            })
            const fila = await t.trx
                .from('inventario.unidades')
                .where('id', entraId)
                .select('bodega_id')
                .first()
            if (!fila?.bodega_id) {
                const estado = await t.trx
                    .from('inventario.unidades')
                    .where('id', entraId)
                    .select('estado')
                    .first()
                throw estadoCambiado(entraId, String(estado?.estado))
            }
            bodegaId = Number(fila.bodega_id)
        }
        const entra = (await t.trx
            .from('inventario.unidades')
            .where('id', entraId)
            .select('estado', 'bodega_id')
            .first()) as { estado: string; bodega_id: number | null }
        if (entra.bodega_id === null || Number(entra.bodega_id) !== bodegaId) {
            throw new Conflicto(
                `La unidad ${entraId} no está en la bodega del técnico ni en la de su cuadrilla`,
                'unidad_en_otra_bodega',
                'Unidad en otra bodega',
            )
        }
        if (entra.estado !== 'disponible') throw estadoCambiado(entraId, entra.estado)

        const fecha = fechaKardexDe(input)
        motivoDelEstado(t, { motivo: 'cambio_equipo', origenExterno })
        // a garantía: la garantía queda abierta (sin enviar) antes de devolverla, así pasa directo a `garantia`
        if (input.destino_sale === 'garantia') {
            await t.trx
                .insertQuery()
                .table('inventario.garantias')
                .insert({
                    empresa_id: empresaId,
                    unidad_id: sale.id,
                    origen: 'cambio_equipo',
                    abierta_por: usuarioDelActor(t.ctx.actor),
                })
        }
        await new DevolverComodato().execute(
            {
                servicio_id: servicio.id,
                unidad_id: sale.id,
                bodega_id: bodegaId,
                condicion: 'usado',
                en_reparacion: input.destino_sale !== 'funciona',
                fecha,
                motivo: `cambio de equipo (${input.motivo}) del servicio ${servicio.id}`,
                origen_tipo: input.origen_tipo,
                origen_id: input.origen_id,
            },
            t.ctx,
            { trx: t.trx },
        )
        await new AsignarComodato().execute(
            {
                servicio_id: servicio.id,
                unidad_id: entraId,
                bodega_id: bodegaId,
                fecha,
                origen_tipo: input.origen_tipo,
                origen_id: input.origen_id,
            },
            t.ctx,
            { trx: t.trx },
        )
        const estadoSale = (await estadoEquipo(sale.id, t.trx))!
        const estadoEntra = (await estadoEquipo(entraId, t.trx))!
        const tecnicoId = tecnico ? await resolverTecnico(t, tecnico) : null
        const nota = input.nota?.trim() || null
        const [cambio] = (await t.trx
            .insertQuery()
            .table('inventario.cambios_equipo')
            .insert({
                empresa_id: empresaId,
                servicio_id: servicio.id,
                sale_unidad_id: sale.id,
                entra_unidad_id: entraId,
                motivo: input.motivo,
                destino_sale: input.destino_sale,
                estado_sale: estadoSale,
                nota,
                fecha: momento.ocurridoEn,
                recibido_en_iris: input.recibido_en_iris ?? null,
                actor_tecnico: idIrisDelActor(input.iris_actor)
                    ? `usuario:${idIrisDelActor(input.iris_actor)}`
                    : null,
                actor_tecnico_id: tecnicoId,
                ...columnasOrigenExterno(origenExterno),
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const cambioId = Number(cambio!.id)
        let cobroId: number | null = null
        if (input.cobro_propuesto) {
            const [cobro] = (await t.trx
                .insertQuery()
                .table('inventario.cobros_equipo')
                .insert({
                    empresa_id: empresaId,
                    unidad_id: sale.id,
                    servicio_id: servicio.id,
                    cliente_id: servicio.cliente_id,
                    origen: 'cambio_equipo',
                    cambio_id: cambioId,
                    motivo: input.cobro_propuesto.motivo.trim(),
                    nota: input.cobro_propuesto.nota?.trim() || null,
                    estado: 'propuesto',
                })
                .returning('id')) as Array<{ id: number }>
            cobroId = Number(cobro!.id)
        }
        await t.emit('inventario.equipo_cambiado', {
            cambio_id: cambioId,
            empresa_id: empresaId,
            servicio_id: servicio.id,
            cliente_id: servicio.cliente_id,
            sale: { unidad_id: sale.id, estado: estadoSale },
            entra: { unidad_id: entraId, estado: estadoEntra },
            motivo: input.motivo,
            destino_sale: input.destino_sale,
            cobro_propuesto: cobroId !== null,
            ...columnasOrigenExterno(origenExterno),
        })
        t.fijarEntidad('cambio_equipo', cambioId)
        return {
            cambio_id: cambioId,
            sale: { unidad_id: Number(sale.id), estado: estadoSale },
            entra: { unidad_id: entraId, estado: estadoEntra },
            cobro_propuesto_id: cobroId,
        }
    }

    /** La unidad que entra, por `unidad_id`, `serie` o `mac` (exactamente uno), en la empresa (404). */
    private async unidadQueEntra(
        t: Transaccion,
        entra: EntradaCambiarEquipo['entra'],
        empresaId: number,
    ): Promise<number> {
        const serie = normalizarSerie(entra.serie)
        const mac = entra.mac ? normalizarMac(entra.mac) : null
        const dados = [entra.unidad_id ? 1 : 0, serie ? 1 : 0, mac ? 1 : 0].reduce((a, b) => a + b, 0)
        if (dados !== 1) {
            throw new ValidacionFallida([
                {
                    field: 'entra',
                    message: 'Indica unidad_id, serie o mac (solo uno)',
                    rule: 'unidad_o_serie',
                },
            ])
        }
        const q = t.trx
            .from('inventario.unidades')
            .where('empresa_id', empresaId)
            .whereNotIn('estado', ['anulada', 'devuelta_proveedor'])
            .select('id')
        if (entra.unidad_id) q.where('id', entra.unidad_id)
        else if (serie) q.whereRaw('upper(serie) = ?', [serie])
        else q.where('mac', mac!)
        const fila = (await q.first()) as { id: number } | null
        if (!fila) throw new NoEncontrado('La unidad que entra no existe en la empresa del servicio')
        return Number(fila.id)
    }

    /** Con el token de Iris sin `tecnico`: el miembro de cuadrilla vinculado a `X-Iris-Actor` en la empresa. */
    private async tecnicoDelActor(
        t: Transaccion,
        actor: string | null | undefined,
        empresaId: number,
    ): Promise<TecnicoExterno | null> {
        const idIris = idIrisDelActor(actor)
        if (!idIris) return null
        const fila = (await t.trx
            .from('inventario.cuadrilla_miembros as m')
            .join('inventario.bodegas as b', 'b.id', 'm.bodega_id')
            .where('b.empresa_id', empresaId)
            .where('m.iris_usuario_id', idIris)
            .where('m.aceptado', true)
            .whereNull('m.hasta')
            .select('m.usuario_id')
            .first()) as { usuario_id: number } | null
        return fila ? { id_externo: String(fila.usuario_id) } : null
    }
}

function estadoCambiado(unidadId: number, estado: string): Conflicto {
    return new Conflicto(
        `La unidad ${unidadId} está ${estado.replaceAll('_', ' ')}: su estado cambió`,
        'estado_unidad_cambiado',
        'El estado de la unidad cambió',
    )
}
