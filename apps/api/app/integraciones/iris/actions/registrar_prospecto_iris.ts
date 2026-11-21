import { randomUUID } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Problema, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import {
    disponibilidadProspectos,
    verProspectoIris,
    type VistaProspectoIris,
} from '#integraciones/iris/prospectos'

export interface TelefonoProspecto {
    numero: string
    whatsapp: boolean
    principal: boolean
    nombre?: string | null
    relacion?: 'titular' | 'familiar' | 'otro' | null
}

export interface EntradaRegistrarProspecto {
    empresa_id?: number | null
    origen: 'oficina' | 'llamada' | 'whatsapp' | 'referido' | 'otro'
    nombre: string
    telefonos: TelefonoProspecto[]
    modo: 'residencial' | 'empresarial'
    direccion: string
    zona_id?: number | null
    coordenadas?: string | null
    plan_interes_id?: number | null
    comentario?: string | null
    cliente_id?: number | null
}

/**
 * `prospectos.registrar` (contrato Iris 0.10.0 §3.6, A44): una persona de Argos (oficina, caja o
 * soporte) registra en Iris a alguien interesado en un servicio.
 *
 * - Valida lo que el contrato exige (1 a 5 teléfonos E.164 sin repetir, exactamente un `principal`,
 *   `relacion: titular` solo en el principal) para no gastar un viaje a Iris: 422
 *   `telefonos_invalidos` con `errors[]` por posición y sin repetir el número.
 * - Con el conector apagado o un Iris < 0.10.0: 409 `iris_no_disponible` (el panel no ofrece el botón).
 * - Deja el pedido en la cola `integraciones.iris_prospectos` con `Idempotency-Key =
 *   argos:prospecto:<uuid>` y el cuerpo exacto; la ruta lo entrega al momento y, si Iris no responde,
 *   `iris:worker` reintenta con la misma clave.
 * - La bitácora guarda solo el vínculo: nombre, teléfonos, dirección, coordenadas y comentario se
 *   auditan como `***`, y el cuerpo se borra de la cola al terminar la entrega.
 */
export default class RegistrarProspectoIris extends DomainAction<
    EntradaRegistrarProspecto,
    VistaProspectoIris
> {
    readonly nombre = 'prospectos.registrar'

    protected readonly camposEntradaOcultos = [
        'nombre',
        'telefonos',
        'direccion',
        'coordenadas',
        'comentario',
    ] as const

    protected async handle(input: EntradaRegistrarProspecto, t: Transaccion): Promise<VistaProspectoIris> {
        const disponible = await disponibilidadProspectos()
        if (!disponible.disponible) {
            throw new Problema(
                409,
                'iris_no_disponible',
                'Iris no disponible',
                disponible.motivo ?? undefined,
            )
        }
        const usuario = usuarioDelActor(t.ctx.actor)
        if (usuario === null) {
            throw new Problema(403, 'actor_no_permitido', 'Solo una persona registra prospectos en Iris')
        }
        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        validarTelefonos(input.telefonos)
        if (input.cliente_id) {
            const cliente = await t.trx
                .from('core.clientes')
                .where('id', input.cliente_id)
                .select('id')
                .first()
            const empresas = (await t.trx
                .from('core.servicios')
                .where('cliente_id', input.cliente_id)
                .distinct('empresa_id')) as Array<{ empresa_id: number }>
            if (
                !cliente ||
                (empresas.length > 0 && !empresas.some((e) => Number(e.empresa_id) === empresaId))
            ) {
                throw new Problema(
                    422,
                    'cliente_no_valido',
                    'Cliente no válido',
                    'El cliente no es de esta empresa',
                    [
                        {
                            field: 'cliente_id',
                            message: 'El cliente no es de esta empresa',
                            rule: 'cliente_no_valido',
                        },
                    ],
                )
            }
        }

        const cuerpo = JSON.stringify({
            origen: input.origen,
            nombre: input.nombre.trim(),
            telefonos: input.telefonos.map((tel) => ({
                numero: tel.numero,
                whatsapp: tel.whatsapp,
                principal: tel.principal,
                ...(tel.nombre ? { nombre: tel.nombre.trim() } : {}),
                ...(tel.relacion ? { relacion: tel.relacion } : {}),
            })),
            modo: input.modo,
            direccion: input.direccion.trim(),
            zona_id: input.zona_id ?? null,
            coordenadas: input.coordenadas ?? null,
            plan_interes_id: input.plan_interes_id ?? null,
            comentario: input.comentario?.trim() || null,
            cliente_id: input.cliente_id ?? null,
        })
        const [fila] = (await t.trx
            .insertQuery()
            .table('integraciones.iris_prospectos')
            .insert({
                idempotency_key: `argos:prospecto:${randomUUID()}`,
                empresa_id: empresaId,
                cliente_id: input.cliente_id ?? null,
                registrado_por: usuario,
                origen: input.origen,
                telefonos: input.telefonos.length,
                cuerpo,
                request_id: t.ctx.requestId,
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('prospecto_iris', id)
        return (await verProspectoIris(id, t.trx))!
    }
}

/** Reglas de `telefonos[]` de §3.6; los mensajes nunca repiten el número. */
export function validarTelefonos(telefonos: TelefonoProspecto[]) {
    const errores: ErrorCampo[] = []
    if (telefonos.length < 1 || telefonos.length > 5) {
        errores.push({ field: 'telefonos', message: 'De 1 a 5 teléfonos', rule: 'telefonos_invalidos' })
    }
    const principales = telefonos.filter((t) => t.principal).length
    if (principales !== 1) {
        errores.push({
            field: 'telefonos',
            message: 'Exactamente un teléfono principal',
            rule: 'telefonos_invalidos',
        })
    }
    const vistos = new Set<string>()
    telefonos.forEach((tel, i) => {
        if (!/^\+[1-9]\d{7,14}$/.test(tel.numero)) {
            errores.push({
                field: `telefonos.${i}.numero`,
                message: 'Número en formato E.164',
                rule: 'telefonos_invalidos',
            })
        }
        if (vistos.has(tel.numero)) {
            errores.push({
                field: `telefonos.${i}.numero`,
                message: 'Número repetido',
                rule: 'telefonos_invalidos',
            })
        }
        vistos.add(tel.numero)
        if (tel.relacion === 'titular' && !tel.principal) {
            errores.push({
                field: `telefonos.${i}.relacion`,
                message: 'Solo el principal puede ser titular',
                rule: 'telefonos_invalidos',
            })
        }
        if (tel.principal && tel.relacion && tel.relacion !== 'titular') {
            errores.push({
                field: `telefonos.${i}.relacion`,
                message: 'El principal no lleva relación o es titular',
                rule: 'telefonos_invalidos',
            })
        }
    })
    if (errores.length > 0) {
        throw new Problema(422, 'telefonos_invalidos', 'Teléfonos inválidos', 'Revisa los teléfonos', errores)
    }
}
