import { DomainAction, type Transaccion } from '#shared/domain_action'
import { alcanceDePermiso, permisosDeUsuario, type Alcance } from '#core/acl'
import { alcanceEmpresasDeUsuario } from '#core/alcance_empresas'
import { definicionReporte, motivoNoCompartible, type DefinicionReporte } from '#billing/reportes/catalogo'
import { TIPOS_CONTENIDO, exportarArchivo, nombreArchivo } from '#billing/reportes/exportar'
import { transporteReportes, type TransporteReportes } from '#billing/reportes/correo'
import { proximoEnvio, type Frecuencia, type ResultadoDestinatario } from '#billing/reportes/envios'
import type { EmpresasReporte } from '#billing/reportes/reportes'

export interface EntradaEjecutarEnvio {
    envio_id: number
    ahora?: Date
}

export interface ResultadoEjecucion {
    envio_id: number
    /** null si no tocaba (pausado, ya corrido o su hora no llegó) */
    corrida_id: number | null
    enviados: number
    omitidos: number
    fallidos: number
}

interface Receptor {
    usuarioId: number
    alcance: Alcance
    permisos: Set<string>
}

/**
 * `reportes.ejecutar_envio` (sistema; cron `reportes` del worker de billing): manda la corrida que
 * toca de un envío programado (`contratos/reportes.md` §5).
 *
 * - Una corrida por envío y hora programada (`programado_para` único): repetir el cron no repite el
 *   correo. Después la próxima hora se calcula desde ahora (las horas perdidas no se mandan).
 * - Cada destinatario se evalúa **en cada envío**, con el ACL y la empresa de ese momento: un usuario
 *   inactivo, sin el permiso del reporte, con alcance parcial en un reporte de toda la empresa, o sin
 *   acceso a la empresa (o al consolidado) se omite con su motivo. El reporte se genera con **su**
 *   alcance y sus permisos (p. ej. el efectivo solo con `libro.ver`).
 * - Un correo externo debe seguir en la lista aprobada y el reporte debe ser compartible con esos
 *   filtros (decisión 6); se genera con el alcance de quien programó el envío, que debe seguir
 *   pudiendo verlo (si no, `sin_responsable`).
 * - El correo sale dentro de la transacción: si el COMMIT fallara después de enviar, la corrida se
 *   repetiría (al menos una vez). Un fallo del SMTP queda como `fallido` en la corrida, sin reintento.
 */
export default class EjecutarEnvioReporte extends DomainAction<EntradaEjecutarEnvio, ResultadoEjecucion> {
    readonly nombre = 'reportes.ejecutar_envio'

    protected auditarExito(salida: ResultadoEjecucion): boolean {
        return salida.corrida_id !== null
    }

    protected async handle(input: EntradaEjecutarEnvio, t: Transaccion): Promise<ResultadoEjecucion> {
        const ahora = input.ahora ?? new Date()
        const vacio = { envio_id: input.envio_id, corrida_id: null, enviados: 0, omitidos: 0, fallidos: 0 }
        const envio = (await t.trx
            .from('billing.reportes_envios')
            .where('id', input.envio_id)
            .forUpdate()
            .first()) as Record<string, unknown> | null
        if (!envio || !envio.activo || new Date(envio.proximo_en as string) > ahora) return vacio
        const empresaId = envio.empresa_id === null ? null : Number(envio.empresa_id)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('envio_reporte', input.envio_id)
        const programado = new Date(envio.proximo_en as string)
        const siguiente = proximoEnvio(
            envio.frecuencia as Frecuencia,
            envio.dia as number | null,
            Number(envio.hora),
            ahora,
        )

        const [corrida] = (await t.trx
            .knexQuery()
            .table('billing.reportes_envios_corridas')
            .insert({ envio_id: input.envio_id, programado_para: programado })
            .onConflict(['envio_id', 'programado_para'])
            .ignore()
            .returning('id')) as Array<{ id: number }>
        if (!corrida) {
            await t.trx
                .from('billing.reportes_envios')
                .where('id', input.envio_id)
                .update({ proximo_en: siguiente })
            return vacio
        }
        const corridaId = Number(corrida.id)

        const destinatarios = (await t.trx
            .from('billing.reportes_envios_destinatarios as d')
            .leftJoin('core.usuarios as u', 'u.id', 'd.usuario_id')
            .leftJoin('billing.reportes_correos_externos as x', 'x.id', 'd.correo_externo_id')
            .where('d.envio_id', input.envio_id)
            .orderBy('d.id', 'asc')
            .select(
                'd.id',
                'd.usuario_id',
                'd.correo_externo_id',
                'u.nombre as usuario_nombre',
                'u.email as usuario_email',
                'u.activo as usuario_activo',
                'x.correo as externo_correo',
                'x.nombre as externo_nombre',
                'x.activo as externo_activo',
            )) as Array<Record<string, unknown>>

        const def = definicionReporte(String(envio.reporte))
        let filtros: Record<string, unknown> | null = null
        let errorFiltros: string | null = null
        if (def) {
            try {
                filtros = await def.validar((envio.filtros as Record<string, unknown>) ?? {})
            } catch (error) {
                errorFiltros = error instanceof Error ? error.message : String(error)
            }
        }
        const op: EmpresasReporte =
            empresaId === null
                ? { empresas: null, consolidado: true }
                : { empresas: [empresaId], consolidado: false }

        let transporte: TransporteReportes | null = null
        let errorSmtp: string | null = null
        try {
            transporte = await transporteReportes(empresaId)
        } catch (error) {
            errorSmtp = error instanceof Error ? error.message : String(error)
        }
        const empresaNombre = await nombreDeEmpresa(t, empresaId)
        const resultados: ResultadoDestinatario[] = []

        for (const d of destinatarios) {
            const base = {
                destinatario_id: Number(d.id),
                tipo: (d.usuario_id ? 'usuario' : 'correo_externo') as ResultadoDestinatario['tipo'],
                usuario_id: d.usuario_id ? Number(d.usuario_id) : null,
                correo_externo_id: d.correo_externo_id ? Number(d.correo_externo_id) : null,
            }
            const omitir = (motivo: string, detalle: string | null = null) =>
                resultados.push({ ...base, estado: 'omitido', motivo, detalle })
            if (!def || !filtros) {
                omitir(
                    'filtros_invalidos',
                    def ? errorFiltros : `El reporte ${String(envio.reporte)} ya no existe`,
                )
                continue
            }
            let receptor: Receptor | { motivo: string } | null
            let correo: string | null
            let nombre: string | null
            if (d.usuario_id) {
                correo = (d.usuario_email as string | null) ?? null
                nombre = (d.usuario_nombre as string | null) ?? null
                if (!d.usuario_activo) {
                    omitir('usuario_inactivo')
                    continue
                }
                receptor = await evaluarUsuario(Number(d.usuario_id), def, empresaId)
            } else {
                correo = (d.externo_correo as string | null) ?? null
                nombre = (d.externo_nombre as string | null) ?? null
                if (!d.externo_activo) {
                    omitir('correo_retirado')
                    continue
                }
                const motivo = motivoNoCompartible(def, filtros)
                if (motivo) {
                    omitir('no_compartible', motivo)
                    continue
                }
                const autor = envio.creado_por ? Number(envio.creado_por) : null
                receptor =
                    autor === null
                        ? { motivo: 'sin_responsable' }
                        : await evaluarUsuario(autor, def, empresaId)
                if ('motivo' in receptor) receptor = { motivo: 'sin_responsable' }
            }
            if ('motivo' in receptor!) {
                omitir(receptor!.motivo)
                continue
            }
            if (!correo) {
                omitir('sin_correo')
                continue
            }
            if (!transporte) {
                resultados.push({ ...base, estado: 'fallido', motivo: 'sin_smtp', detalle: errorSmtp })
                continue
            }
            try {
                const r = receptor as Receptor
                const reporte = await def.generar(filtros, {
                    alcance: r.alcance,
                    op,
                    permisos: r.permisos,
                    ahora,
                })
                const formato = envio.formato as 'pdf' | 'xlsx' | 'csv'
                const archivo = await exportarArchivo(reporte, formato, {
                    empresas: op.empresas,
                    generado_en: ahora,
                    generado_para: nombre,
                })
                await transporte.enviar({
                    para: correo,
                    asunto: `${String(envio.nombre)} · ${empresaNombre}`,
                    texto:
                        `Hola${nombre ? ` ${nombre}` : ''}:\n\n` +
                        `Adjuntamos el reporte «${reporte.titulo}» de ${empresaNombre}, generado el ` +
                        `${ahora.toISOString().slice(0, 10)}.\n\n` +
                        `Este envío lo programó el equipo de ${empresaNombre} en ArgosIsp. Si ya no debe recibirlo, ` +
                        `pida que lo quiten de la lista.\n`,
                    remitenteNombre: empresaNombre,
                    adjunto: {
                        nombre: nombreArchivo(reporte, formato, ahora),
                        contenido: archivo,
                        tipo: TIPOS_CONTENIDO[formato],
                    },
                })
                resultados.push({ ...base, estado: 'enviado', motivo: null, detalle: null })
            } catch (error) {
                resultados.push({
                    ...base,
                    estado: 'fallido',
                    motivo: 'error_envio',
                    detalle:
                        error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
                })
            }
        }

        const cuenta = (estado: ResultadoDestinatario['estado']) =>
            resultados.filter((r) => r.estado === estado).length
        const salida = {
            envio_id: input.envio_id,
            corrida_id: corridaId,
            enviados: cuenta('enviado'),
            omitidos: cuenta('omitido'),
            fallidos: cuenta('fallido'),
        }
        await t.trx
            .from('billing.reportes_envios_corridas')
            .where('id', corridaId)
            .update({
                enviados: salida.enviados,
                omitidos: salida.omitidos,
                fallidos: salida.fallidos,
                resultados: JSON.stringify(resultados),
            })
        await t.trx
            .from('billing.reportes_envios')
            .where('id', input.envio_id)
            .update({ proximo_en: siguiente, ultimo_envio_en: ahora })
        t.anotarAuditoria({
            corrida_id: corridaId,
            enviados: salida.enviados,
            omitidos: salida.omitidos,
            fallidos: salida.fallidos,
        })
        await t.emit('reportes.envio_ejecutado', {
            envio_id: input.envio_id,
            corrida_id: corridaId,
            empresa_id: empresaId,
            reporte: String(envio.reporte),
            formato: envio.formato as 'pdf' | 'xlsx' | 'csv',
            programado_para: programado.toISOString(),
            enviados: salida.enviados,
            omitidos: salida.omitidos,
            fallidos: salida.fallidos,
        })
        return salida
    }
}

/** ACL y empresa del usuario hoy: el alcance con que recibe el reporte, o el motivo para omitirlo. */
async function evaluarUsuario(
    usuarioId: number,
    def: DefinicionReporte,
    empresaId: number | null,
): Promise<Receptor | { motivo: string }> {
    const alcance = await alcanceDePermiso(usuarioId, def.permiso)
    if (!alcance) return { motivo: 'sin_permiso' }
    if (def.alcanceTotal && alcance.rol !== null) return { motivo: 'alcance_parcial' }
    const empresas = await alcanceEmpresasDeUsuario(usuarioId)
    if (empresaId === null ? !empresas.alcanceGlobal : !empresas.empresas.includes(empresaId)) {
        return { motivo: 'sin_acceso_empresa' }
    }
    return { usuarioId, alcance, permisos: new Set(await permisosDeUsuario(usuarioId)) }
}

async function nombreDeEmpresa(t: Transaccion, empresaId: number | null): Promise<string> {
    if (empresaId === null) return 'todas las empresas'
    const fila = (await t.trx
        .from('core.empresas')
        .where('id', empresaId)
        .select('nombre_comercial')
        .first()) as {
        nombre_comercial: string
    } | null
    return fila?.nombre_comercial ?? `la empresa ${empresaId}`
}
