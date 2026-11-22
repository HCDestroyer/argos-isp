import { DomainAction, type Transaccion } from '#shared/domain_action'
import { envioDeClaveAviso } from '#notify/canales/whatsapp'
import { aplicarAcuseIris } from '#notify/acuses_iris'
import SincronizarCuadrilla from '#inventario/actions/sincronizar_cuadrilla'
import SincronizarVinculoTecnico from '#inventario/actions/sincronizar_vinculo_tecnico'
import { aplicarEstadoProspecto } from '#integraciones/iris/prospectos'

/** Eventos de Iris → Argos (contrato Iris 0.6.0 §6.6). */
export const EVENTOS_DE_IRIS = [
    'aviso.entregado',
    'aviso.fallido',
    'contacto.baja',
    // contrato 0.11.0 §3.9 (A47): membresía de la bodega de cuadrilla
    'cuadrilla.creada',
    'cuadrilla.actualizada',
    // contrato 0.14.0 §6.6 (R-10): vínculo de cada técnico con su usuario de Argos (solo inventario)
    'tecnico.argos_vinculado',
    'tecnico.argos_desvinculado',
    // 0.10.0 (A44, §3.6 y §6.6): solo de prospectos registrados desde Argos
    'prospecto.estado_cambiado',
    // 0.9.0 (A30 y A31, §6.6 y §11): tickets y solicitudes del cliente; notify avisa al cliente
    'ticket.estado_cambiado',
    'ticket.respondido',
    'solicitud_servicio.estado_cambiado',
] as const

/** Eventos de soporte de 0.9.0 (§6.6): se reemiten al bus como `soporte.*` para notify. */
const EVENTOS_SOPORTE = ['ticket.estado_cambiado', 'ticket.respondido', 'solicitud_servicio.estado_cambiado']

const CANALES_CONTACTO = ['whatsapp', 'telegram', 'correo'] as const
const ORIGENES_BAJA = ['cliente', 'agente'] as const

export interface EntradaRecibirWebhookIris {
    /** `X-Webhook-Id` (o `id` del cuerpo) */
    webhook_id: string
    evento: string
    ocurrido_en: string | null
    payload: Record<string, unknown>
    /** cuerpo completo tal como llegó (se guarda) */
    cuerpo: Record<string, unknown>
}

export interface ResultadoRecibirWebhookIris {
    duplicado: boolean
    estado: 'procesado' | 'ignorado'
    /**
     * `acuse_aplicado` | `sin_cambio` | `envio_no_encontrado` (aviso.*), `baja_registrada` |
     * `baja_anterior` (contacto.baja), `cliente_no_encontrado`, `evento_desconocido`, `payload_invalido`
     */
    resultado: string
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor !== '' ? valor : null
}

function entero(valor: unknown): number | null {
    const n = Number(valor)
    return valor !== null && valor !== undefined && valor !== '' && Number.isSafeInteger(n) && n > 0
        ? n
        : null
}

function instante(valor: unknown): string | null {
    const t = texto(valor)
    return t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null
}

function unoDe<T extends string>(valor: unknown, permitidos: readonly T[]): T | null {
    return typeof valor === 'string' && (permitidos as readonly string[]).includes(valor)
        ? (valor as T)
        : null
}

/**
 * Webhook firmado de Iris → Argos (contrato Iris 0.6.0 §6.6). La firma, el desfase y el conector
 * apagado los revisa la ruta (`receptor.ts`) antes de llamar aquí.
 *
 * - Deduplica por `X-Webhook-Id` (`integraciones.iris_recibidos`): repetido → `duplicado`, nada más.
 * - `aviso.entregado` / `aviso.fallido`: encuentra el envío de notify por `idempotency_key`
 *   (`argos:aviso:<plantilla>:<envio_id>`) y le aplica el acuse (`#notify/acuses_iris`): `enviado` o
 *   `fallido` con el motivo, y `notificacion.enviada`. Un acuse de un envío que ya no está en cola no
 *   cambia nada.
 * - `contacto.baja`: guarda la baja en `notify.contacto_iris` (si no hay una más nueva) y queda en la
 *   línea de tiempo del cliente (esta fila de auditoría, entidad `cliente`, y el diff en
 *   `audit.cambios`). Con canal `whatsapp`, notify deja de pedir avisos por WhatsApp a ese cliente;
 *   no apaga el correo ni el Telegram de Argos (§6.4).
 * - Eventos y campos desconocidos se registran como `ignorado`. Nunca cambia estados de servicios,
 *   facturas ni pagos.
 */
export default class RecibirWebhookIris extends DomainAction<
    EntradaRecibirWebhookIris,
    ResultadoRecibirWebhookIris
> {
    readonly nombre = 'iris.recibir_webhook'

    protected async handle(
        input: EntradaRecibirWebhookIris,
        t: Transaccion,
    ): Promise<ResultadoRecibirWebhookIris> {
        const conocido = (EVENTOS_DE_IRIS as readonly string[]).includes(input.evento)
        const ocurrido = instante(input.ocurrido_en)
        const filas = (await t.trx.rawQuery(
            `INSERT INTO integraciones.iris_recibidos (webhook_id, evento, ocurrido_en, estado, cuerpo)
             VALUES (?, ?, ?, ?, ?::jsonb)
             ON CONFLICT (webhook_id) DO NOTHING
             RETURNING id`,
            [
                input.webhook_id,
                input.evento,
                ocurrido,
                conocido ? 'procesado' : 'ignorado',
                JSON.stringify(input.cuerpo),
            ] as any[],
        )) as { rows: Array<{ id: number }> }
        const id = filas.rows[0]?.id
        if (!id) {
            return { duplicado: true, estado: conocido ? 'procesado' : 'ignorado', resultado: 'duplicado' }
        }
        t.fijarEntidad('webhook_iris', Number(id))
        t.fijarEmpresa(null)

        let salida: ResultadoRecibirWebhookIris
        let enlace: { empresa_id?: number | null; cliente_id?: number | null; envio_id?: number | null } = {}
        if (input.evento === 'aviso.entregado' || input.evento === 'aviso.fallido') {
            const clave = envioDeClaveAviso(input.payload.idempotency_key)
            if (!clave) {
                salida = { duplicado: false, estado: 'ignorado', resultado: 'payload_invalido' }
            } else {
                const acuse = await aplicarAcuseIris(t, {
                    envioId: clave.envioId,
                    tipo: input.evento === 'aviso.entregado' ? 'entregado' : 'fallido',
                    avisoId:
                        texto(input.payload.aviso_id) ?? entero(input.payload.aviso_id)?.toString() ?? null,
                    entregadoEn: texto(input.payload.entregado_en),
                    leidoEn: texto(input.payload.leido_en),
                    motivo: texto(input.payload.motivo),
                    detalle: texto(input.payload.detalle),
                })
                if (acuse.empresa_id !== null) t.fijarEmpresa(acuse.empresa_id)
                enlace = {
                    empresa_id: acuse.empresa_id,
                    cliente_id: acuse.cliente_id,
                    envio_id: clave.envioId,
                }
                salida = {
                    duplicado: false,
                    estado: acuse.encontrado ? 'procesado' : 'ignorado',
                    resultado: !acuse.encontrado
                        ? 'envio_no_encontrado'
                        : acuse.cambio
                          ? 'acuse_aplicado'
                          : 'sin_cambio',
                }
            }
        } else if (input.evento === 'contacto.baja') {
            const r = await this.baja(t, input, ocurrido)
            enlace = { empresa_id: r.empresaId, cliente_id: r.clienteId }
            salida = {
                duplicado: false,
                estado: r.procesado ? 'procesado' : 'ignorado',
                resultado: r.resultado,
            }
        } else if (input.evento === 'cuadrilla.creada' || input.evento === 'cuadrilla.actualizada') {
            const r = await this.cuadrilla(t, input.payload)
            enlace = { empresa_id: r.empresaId }
            salida = {
                duplicado: false,
                estado: r.aplicado ? 'procesado' : 'ignorado',
                resultado: r.resultado,
            }
        } else if (
            input.evento === 'tecnico.argos_vinculado' ||
            input.evento === 'tecnico.argos_desvinculado'
        ) {
            const r = await this.vinculo(t, input.evento === 'tecnico.argos_vinculado', input.payload)
            enlace = { empresa_id: r.empresaId }
            salida = {
                duplicado: false,
                estado: r.aplicado ? 'procesado' : 'ignorado',
                resultado: r.resultado,
            }
        } else if (input.evento === 'prospecto.estado_cambiado') {
            const prospectoId =
                texto(input.payload.prospecto_id) ?? entero(input.payload.prospecto_id)?.toString() ?? null
            const a = texto(input.payload.a)
            if (!prospectoId || !a) {
                salida = { duplicado: false, estado: 'ignorado', resultado: 'payload_invalido' }
            } else {
                const r = await aplicarEstadoProspecto(t.trx, {
                    prospecto_id: prospectoId,
                    empresa_id: entero(input.payload.empresa_id),
                    a,
                    motivo: texto(input.payload.motivo_codigo),
                    ocurrido: ocurrido ?? new Date().toISOString(),
                })
                if (r.encontrado) {
                    t.fijarEntidad('prospecto_iris', r.id!)
                    t.fijarEmpresa(r.empresa_id)
                    if (r.cambio) {
                        await t.registrarCambios(
                            { tipo: 'prospecto_iris', id: r.id! },
                            { estado_iris: r.antes },
                            { estado_iris: a },
                        )
                    }
                }
                enlace = { empresa_id: r.empresa_id, cliente_id: r.cliente_id }
                salida = {
                    duplicado: false,
                    estado: r.encontrado ? 'procesado' : 'ignorado',
                    resultado: !r.encontrado
                        ? 'prospecto_no_encontrado'
                        : r.cambio
                          ? 'estado_aplicado'
                          : 'sin_cambio',
                }
            }
        } else if (EVENTOS_SOPORTE.includes(input.evento)) {
            const r = await this.soporte(t, input)
            enlace = { empresa_id: r.empresaId, cliente_id: r.clienteId }
            salida = {
                duplicado: false,
                estado: r.procesado ? 'procesado' : 'ignorado',
                resultado: r.resultado,
            }
        } else {
            salida = { duplicado: false, estado: 'ignorado', resultado: 'evento_desconocido' }
        }

        await t.trx
            .from('integraciones.iris_recibidos')
            .where('id', id)
            .update({
                estado: salida.estado,
                resultado: salida.resultado,
                empresa_id: enlace.empresa_id ?? null,
                cliente_id: enlace.cliente_id ?? null,
                envio_id: enlace.envio_id ?? null,
            })
        return salida
    }

    /**
     * `ticket.estado_cambiado`, `ticket.respondido` y `solicitud_servicio.estado_cambiado` (0.9.0 §6.6):
     * el portal relee de Iris al abrir cada pantalla, así que aquí solo se valida el cliente y se
     * emite el evento `soporte.*` para que notify avise al cliente. Sin cuerpos de mensajes ni motivos.
     */
    private async soporte(
        t: Transaccion,
        input: EntradaRecibirWebhookIris,
    ): Promise<{
        procesado: boolean
        resultado: string
        clienteId: number | null
        empresaId: number | null
    }> {
        const p = input.payload
        const clienteId = entero(p.cliente_id)
        const id = (clave: string) => texto(p[clave]) ?? entero(p[clave])?.toString() ?? null
        const a = texto(p.a)
        const invalido = { procesado: false, resultado: 'payload_invalido', clienteId: null, empresaId: null }
        if (!clienteId) return invalido
        const cliente = await t.trx.from('core.clientes').where('id', clienteId).select('id').first()
        if (!cliente) {
            return { procesado: false, resultado: 'cliente_no_encontrado', clienteId: null, empresaId: null }
        }
        let empresaId = entero(p.empresa_id)
        if (empresaId && !(await t.trx.from('core.empresas').where('id', empresaId).select('id').first())) {
            empresaId = null
        }
        t.fijarEntidad('cliente', clienteId)
        t.fijarEmpresa(empresaId)
        const base = {
            numero: texto(p.numero),
            empresa_id: empresaId,
            cliente_id: clienteId,
            webhook_id: input.webhook_id,
        }
        if (input.evento === 'ticket.estado_cambiado') {
            const ticketId = id('ticket_id')
            if (!ticketId || !a) return invalido
            await t.emit('soporte.ticket_estado_cambiado', {
                ...base,
                ticket_id: ticketId,
                servicio_id: entero(p.servicio_id),
                origen: texto(p.origen),
                de: texto(p.de),
                a,
                puede_confirmar: a === 'resuelto' && p.puede_confirmar !== false,
            })
            return { procesado: true, resultado: 'aviso_emitido', clienteId, empresaId }
        }
        if (input.evento === 'ticket.respondido') {
            const ticketId = id('ticket_id')
            const autor = unoDe(p.autor_tipo, ['agente', 'sistema'] as const)
            if (!ticketId || !autor) return invalido
            await t.emit('soporte.ticket_respondido', {
                ...base,
                ticket_id: ticketId,
                mensaje_id: id('mensaje_id'),
                autor_tipo: autor,
                masivo: p.masivo === true,
                aviso_por_correo: p.aviso_por_correo === true,
            })
            return { procesado: true, resultado: 'aviso_emitido', clienteId, empresaId }
        }
        const solicitudId = id('solicitud_id')
        if (!solicitudId || !a) return invalido
        await t.emit('soporte.solicitud_estado_cambiado', {
            ...base,
            solicitud_id: solicitudId,
            tipo: texto(p.tipo),
            servicio_id: entero(p.servicio_id),
            de: texto(p.de),
            a,
        })
        return { procesado: true, resultado: 'aviso_emitido', clienteId, empresaId }
    }

    /**
     * `tecnico.argos_vinculado` / `tecnico.argos_desvinculado` (0.14.0 §6.6): los aplica el inventario
     * (`inventario.sincronizar_vinculo_tecnico`), solo con `version` mayor. Resultado `vinculo_aplicado`,
     * `vinculo_rechazado` o el motivo por el que se ignoró.
     */
    private async vinculo(
        t: Transaccion,
        vinculado: boolean,
        p: Record<string, unknown>,
    ): Promise<{ aplicado: boolean; resultado: string; empresaId: number | null }> {
        const empresaId = entero(p.empresa_id)
        const version = entero(p.version)
        const usuarioId = texto(p.usuario_id) ?? entero(p.usuario_id)?.toString() ?? null
        const idExterno = texto(p.id_externo) ?? entero(p.id_externo)?.toString() ?? null
        if (
            !empresaId ||
            !version ||
            !usuarioId ||
            !/^[A-Za-z0-9_-]{1,64}$/.test(usuarioId) ||
            (vinculado && !idExterno)
        ) {
            return { aplicado: false, resultado: 'payload_invalido', empresaId: null }
        }
        const r = await new SincronizarVinculoTecnico().execute(
            {
                empresa_id: empresaId,
                usuario_id: usuarioId,
                tecnico_id: texto(p.tecnico_id) ?? entero(p.tecnico_id)?.toString() ?? null,
                id_externo: idExterno,
                version,
                activo: vinculado,
                motivo: texto(p.motivo),
                origen: 'webhook',
            },
            t.ctx,
            { trx: t.trx },
        )
        return {
            aplicado: r.aplicado,
            resultado: !r.aplicado
                ? (r.ignorado ?? 'ignorado')
                : r.estado === 'rechazado'
                  ? 'vinculo_rechazado'
                  : r.estado === 'desvinculado'
                    ? 'vinculo_quitado'
                    : 'vinculo_aplicado',
            empresaId: r.aplicado ? empresaId : null,
        }
    }

    /** `cuadrilla.*` (0.11.0 §3.9): la aplica el inventario (`inventario.sincronizar_cuadrilla`). */
    private async cuadrilla(
        t: Transaccion,
        p: Record<string, unknown>,
    ): Promise<{ aplicado: boolean; resultado: string; empresaId: number | null }> {
        const empresaId = entero(p.empresa_id)
        const version = entero(p.version)
        const cuadrillaId = texto(p.cuadrilla_id) ?? entero(p.cuadrilla_id)?.toString() ?? null
        if (!empresaId || !version || !cuadrillaId || !Array.isArray(p.miembros)) {
            return { aplicado: false, resultado: 'payload_invalido', empresaId: null }
        }
        const r = await new SincronizarCuadrilla().execute(
            {
                cuadrilla_id: cuadrillaId,
                empresa_id: empresaId,
                version,
                nombre: texto(p.nombre),
                activa: typeof p.activa === 'boolean' ? p.activa : null,
                miembros: (p.miembros as Array<Record<string, unknown>>)
                    .filter((m) => m && typeof m === 'object')
                    .map((m) => ({
                        usuario_id: String(m.usuario_id ?? ''),
                        id_externo:
                            m.id_externo === null || m.id_externo === undefined ? null : String(m.id_externo),
                    })),
                jefe_usuario_id:
                    p.jefe_usuario_id === null || p.jefe_usuario_id === undefined
                        ? null
                        : String(p.jefe_usuario_id),
            },
            t.ctx,
            { trx: t.trx },
        )
        return {
            aplicado: r.aplicado,
            resultado: r.aplicado ? 'cuadrilla_aplicada' : (r.motivo ?? 'ignorado'),
            empresaId: r.aplicado ? empresaId : null,
        }
    }

    private async baja(
        t: Transaccion,
        input: EntradaRecibirWebhookIris,
        ocurridoWebhook: string | null,
    ): Promise<{
        procesado: boolean
        resultado: string
        clienteId: number | null
        empresaId: number | null
    }> {
        const p = input.payload
        const clienteId = entero(p.cliente_id)
        const canal = unoDe(p.canal, CANALES_CONTACTO)
        const ocurrido = instante(p.ocurrido_en) ?? ocurridoWebhook ?? new Date().toISOString()
        if (!clienteId || !canal) {
            return { procesado: false, resultado: 'payload_invalido', clienteId: null, empresaId: null }
        }
        const cliente = await t.trx.from('core.clientes').where('id', clienteId).select('id').first()
        if (!cliente) {
            return { procesado: false, resultado: 'cliente_no_encontrado', clienteId: null, empresaId: null }
        }
        let empresaId = entero(p.empresa_id)
        if (empresaId && !(await t.trx.from('core.empresas').where('id', empresaId).select('id').first())) {
            empresaId = null
        }
        t.fijarEntidad('cliente', clienteId)
        t.fijarEmpresa(empresaId)

        const antes = (await t.trx
            .from('notify.contacto_iris')
            .where('cliente_id', clienteId)
            .where('canal', canal)
            .forUpdate()
            .select('estado', 'ocurrido_en')
            .first()) as { estado: string; ocurrido_en: Date } | null
        if (antes && new Date(antes.ocurrido_en).getTime() > Date.parse(ocurrido)) {
            // Un alta más nueva (de Argos, ya enviada a Iris) manda sobre esta baja atrasada
            return { procesado: true, resultado: 'baja_anterior', clienteId, empresaId }
        }
        const origen = unoDe(p.origen, ORIGENES_BAJA) ?? 'cliente'
        await t.trx.rawQuery(
            `INSERT INTO notify.contacto_iris (cliente_id, canal, estado, ocurrido_en, origen, empresa_id, webhook_id)
             VALUES (?, ?, 'baja', ?, ?, ?, ?)
             ON CONFLICT (cliente_id, canal) DO UPDATE SET
                estado = 'baja', ocurrido_en = EXCLUDED.ocurrido_en, origen = EXCLUDED.origen,
                empresa_id = EXCLUDED.empresa_id, webhook_id = EXCLUDED.webhook_id, updated_at = now()`,
            [clienteId, canal, ocurrido, `iris_${origen}`, empresaId, input.webhook_id] as any[],
        )
        await t.registrarCambios(
            { tipo: 'cliente', id: clienteId },
            { [`avisos_${canal}_iris`]: antes?.estado ?? null },
            { [`avisos_${canal}_iris`]: 'baja' },
        )
        return { procesado: true, resultado: 'baja_registrada', clienteId, empresaId }
    }
}
