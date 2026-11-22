import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { NoEncontrado, Problema, ValidacionFallida } from '#shared/errores'
import { resolverEmpresaActiva } from '#core/empresas'
import {
    GESTION_DIAS_ATRAS,
    GESTION_MINUTOS_ADELANTE,
    NOTA_GESTION_MAXIMO,
    ORIGENES_GESTION,
    ORIGENES_SOLO_ARGOS,
    RESULTADOS_GESTION,
    TIPOS_GESTION,
    TIPOS_SOLO_ARGOS,
    verGestionCobro,
    type GestionCobroVista,
    type OrigenGestion,
    type ResultadoGestion,
    type TipoGestion,
} from '#billing/gestiones_cobro'

/**
 * `gestiones_cobro.registrar` (`POST /clientes/:id/gestiones-cobro`, decisión del PM 8, contrato Iris
 * 0.13.0): anota un intento de cobro (llamada, mensaje, visita, promesa verbal o carta) y su resultado.
 * Es evidencia para el castigo de cartera. **Solo informativa:** no cambia el servicio, las facturas ni
 * las promesas (no llama `evaluarEstadoServicio`).
 *
 * - Empresa: la del servicio si viene `servicio_id` (debe ser del cliente: 422 `servicio_de_otro_cliente`);
 *   si no, la activa del contexto (o la única). El cliente debe tener servicios en ella o no tener
 *   ninguno (422 `cliente_de_otra_empresa`); fuera del alcance → 403 `empresa_no_permitida`.
 * - `ocurrido_en` entre ahora − 7 días y ahora + 5 minutos (422 `fuera_de_ventana`).
 * - Desde Iris (`iris_gestion_id`, lo fija la ruta a partir de `Idempotency-Key = iris:gestion:<uuid v7>`):
 *   ni `carta` ni `origen_tipo: panel` (422 `solo_argos`), sin `nota` (422 `nota_no_permitida`) y con
 *   `origen_id`. El mismo `iris_gestion_id` dos veces devuelve la gestión ya registrada si es igual, o
 *   422 `idempotency_key_reutilizada` si cambió algo (igual que el middleware de idempotencia).
 * - Desde el panel: `origen_tipo` por defecto `panel`, nota corta opcional (hasta 280).
 * - `contacto_id`: el contacto validado de `X-Iris-Contacto` (la ruta lo valida con
 *   `exigirPermisoDeContacto`).
 *
 * Evento `gestion_cobro.registrada` (sin la nota).
 */

export interface EntradaRegistrarGestionCobro {
    cliente_id: number
    servicio_id?: number | null
    tipo: TipoGestion
    resultado: ResultadoGestion
    ocurrido_en: string | Date
    origen_tipo?: OrigenGestion | null
    origen_id?: string | null
    nota?: string | null
    /** lo fija la ruta (contacto de `X-Iris-Contacto`); nunca viene del cuerpo */
    contacto_id?: number | null
    /** lo fija la ruta con el token de Iris (UUID v7 de `Idempotency-Key`) */
    iris_gestion_id?: string | null
    /** instante de referencia (pruebas); por defecto ahora */
    ahora?: Date
}

export interface ResultadoRegistrarGestionCobro extends GestionCobroVista {
    /** true si ya existía con el mismo `iris_gestion_id` y los mismos datos (no se repitió) */
    repetida: boolean
}

function regla(campo: string, codigo: string, mensaje: string): ValidacionFallida {
    return new ValidacionFallida([{ field: campo, message: mensaje, rule: codigo }])
}

export default class RegistrarGestionCobro extends DomainAction<
    EntradaRegistrarGestionCobro,
    ResultadoRegistrarGestionCobro
> {
    readonly nombre = 'gestiones_cobro.registrar'

    protected async handle(
        input: EntradaRegistrarGestionCobro,
        t: Transaccion,
    ): Promise<ResultadoRegistrarGestionCobro> {
        const ahora = input.ahora ?? new Date()
        const desdeIris = Boolean(input.iris_gestion_id)
        if (!(TIPOS_GESTION as readonly string[]).includes(input.tipo)) {
            throw regla('tipo', 'enum', `Se acepta ${TIPOS_GESTION.join(', ')}`)
        }
        if (!(RESULTADOS_GESTION as readonly string[]).includes(input.resultado)) {
            throw regla('resultado', 'enum', `Se acepta ${RESULTADOS_GESTION.join(', ')}`)
        }
        const origenTipo: OrigenGestion = input.origen_tipo ?? (desdeIris ? 'conversacion' : 'panel')
        if (!(ORIGENES_GESTION as readonly string[]).includes(origenTipo)) {
            throw regla('origen_tipo', 'enum', `Se acepta ${ORIGENES_GESTION.join(', ')}`)
        }
        const origenId = input.origen_id?.trim() || null
        const nota = input.nota?.trim() || null
        if (desdeIris) {
            if (TIPOS_SOLO_ARGOS.includes(input.tipo)) {
                throw regla('tipo', 'solo_argos', 'Una carta solo se registra desde el panel de Argos')
            }
            if (ORIGENES_SOLO_ARGOS.includes(origenTipo)) {
                throw regla('origen_tipo', 'solo_argos', 'El origen panel solo se usa desde Argos')
            }
            if (nota !== null) {
                throw regla('nota', 'nota_no_permitida', 'Iris no envía texto libre en una gestión de cobro')
            }
            if (origenId === null) {
                throw regla('origen_id', 'required', 'Indica la conversación, orden o llamada de Iris')
            }
        }
        if (nota !== null && nota.length > NOTA_GESTION_MAXIMO) {
            throw regla('nota', 'maxLength', `La nota tiene hasta ${NOTA_GESTION_MAXIMO} caracteres`)
        }

        const ocurrido = input.ocurrido_en instanceof Date ? input.ocurrido_en : new Date(input.ocurrido_en)
        if (Number.isNaN(ocurrido.getTime())) {
            throw regla('ocurrido_en', 'date', 'Fecha y hora ISO 8601')
        }
        const minimo = DateTime.fromJSDate(ahora).minus({ days: GESTION_DIAS_ATRAS }).toJSDate()
        const maximo = DateTime.fromJSDate(ahora).plus({ minutes: GESTION_MINUTOS_ADELANTE }).toJSDate()
        if (ocurrido < minimo || ocurrido > maximo) {
            throw regla(
                'ocurrido_en',
                'fuera_de_ventana',
                `La gestión debe haber ocurrido en los últimos ${GESTION_DIAS_ATRAS} días (y no más de ${GESTION_MINUTOS_ADELANTE} minutos adelante)`,
            )
        }

        const cliente = await t.trx.from('core.clientes').where('id', input.cliente_id).select('id').first()
        if (!cliente) throw new NoEncontrado(`El cliente ${input.cliente_id} no existe`)
        t.fijarEntidad('cliente', input.cliente_id)

        let empresaId: number
        const servicioId = input.servicio_id ?? null
        if (servicioId !== null) {
            const servicio = (await t.trx
                .from('core.servicios')
                .where('id', servicioId)
                .select('cliente_id', 'empresa_id')
                .first()) as { cliente_id: number; empresa_id: number } | null
            if (!servicio || Number(servicio.cliente_id) !== input.cliente_id) {
                throw regla(
                    'servicio_id',
                    'servicio_de_otro_cliente',
                    `El servicio ${servicioId} no es del cliente ${input.cliente_id}`,
                )
            }
            empresaId = Number(servicio.empresa_id)
        } else {
            empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
            const empresas = (await t.trx
                .from('core.servicios')
                .where('cliente_id', input.cliente_id)
                .distinct('empresa_id')) as Array<{ empresa_id: number }>
            if (empresas.length > 0 && !empresas.some((e) => Number(e.empresa_id) === empresaId)) {
                throw new Problema(
                    422,
                    'cliente_de_otra_empresa',
                    'Cliente de otra empresa',
                    `El cliente ${input.cliente_id} no tiene servicios en la empresa ${empresaId}`,
                )
            }
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const datos = {
            empresa_id: empresaId,
            cliente_id: input.cliente_id,
            servicio_id: servicioId,
            contacto_id: input.contacto_id ?? null,
            tipo: input.tipo,
            resultado: input.resultado,
            ocurrido_en: ocurrido,
            origen_tipo: origenTipo,
            origen_id: origenId,
            sistema_origen: desdeIris ? ('iris' as const) : null,
            iris_gestion_id: input.iris_gestion_id ?? null,
            iris_actor: t.ctx.iris?.actor ?? null,
            nota,
            registrado_por: usuarioDelActor(t.ctx.actor),
        }

        if (desdeIris) {
            // reintento de Iris con la misma clave (p. ej. después de que expiró la del middleware)
            await t.trx.rawQuery('SELECT pg_advisory_xact_lock(hashtext(?))', [
                `gestion:${input.iris_gestion_id}`,
            ])
            const previa = (await t.trx
                .from('billing.gestiones_cobro')
                .where('iris_gestion_id', input.iris_gestion_id!)
                .select('*')
                .first()) as Record<string, unknown> | null
            if (previa) {
                const igual =
                    Number(previa.cliente_id) === datos.cliente_id &&
                    (previa.servicio_id === null ? null : Number(previa.servicio_id)) === datos.servicio_id &&
                    (previa.contacto_id === null ? null : Number(previa.contacto_id)) === datos.contacto_id &&
                    previa.tipo === datos.tipo &&
                    previa.resultado === datos.resultado &&
                    new Date(previa.ocurrido_en as string).getTime() === ocurrido.getTime() &&
                    previa.origen_tipo === datos.origen_tipo &&
                    previa.origen_id === datos.origen_id
                if (!igual) {
                    throw new Problema(
                        422,
                        'idempotency_key_reutilizada',
                        'Idempotency-Key reutilizada',
                        'La clave ya se usó con otra ruta o con otro cuerpo',
                    )
                }
                t.fijarEntidad('gestion_cobro', Number(previa.id))
                return { ...(await verGestionCobro(Number(previa.id), t.trx)), repetida: true }
            }
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.gestiones_cobro')
            .insert(datos)
            .returning('id')) as Array<{ id: number }>
        const gestionId = Number(fila!.id)
        t.fijarEntidad('gestion_cobro', gestionId)
        await t.emit('gestion_cobro.registrada', {
            gestion_id: gestionId,
            empresa_id: empresaId,
            cliente_id: input.cliente_id,
            servicio_id: servicioId,
            contacto_id: datos.contacto_id,
            tipo: input.tipo,
            resultado: input.resultado,
            ocurrido_en: ocurrido.toISOString(),
            origen_tipo: origenTipo,
            origen_id: origenId,
            origen: desdeIris ? 'iris' : null,
            iris_gestion_id: datos.iris_gestion_id,
        })
        return { ...(await verGestionCobro(gestionId, t.trx)), repetida: false }
    }
}
