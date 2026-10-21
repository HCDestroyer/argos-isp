import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import {
    detalleSorteo,
    exigirEstado,
    exigirRequisitos,
    ganadoresDe,
    requisitosVigentes,
    verSorteo,
} from '#lealtad/sorteos'
import { prepararArchivo, registrarArchivo } from '#lealtad/sorteos_archivos'
import { cerrarSiTodoResuelto } from '#lealtad/sorteos_entrega'
import { actaPdf } from '#lealtad/acta_pdf'

/**
 * `sorteos.cerrar_acta` (`POST /lealtad/sorteos/:id/cerrar-acta`, permiso `sorteos.ejecutar`; §7.3
 * punto 6): `ejecutado → acta_cerrada`. Exige `publicacion_resultados` (§8; 422 `requisito_pendiente`)
 * y una `constancia` (firma o constancia del notario o del delegado). Genera el PDF del acta una sola
 * vez, lo guarda (`lealtad.sorteos_archivos`, uso `acta`) con su SHA-256 en `acta_hash` y lo congela
 * (trigger). Si ya no queda ningún premio pendiente, el sorteo pasa a `premios_entregados`. Evento
 * `sorteo.acta_cerrada`. El PDF se descarga en `GET /lealtad/sorteos/:id/acta.pdf`.
 */

export interface EntradaCerrarActa {
    id: number
    constancia: string
}

export default class CerrarActaSorteo extends DomainAction<
    EntradaCerrarActa,
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.cerrar_acta'

    protected async handle(input: EntradaCerrarActa, t: Transaccion) {
        t.fijarEntidad('sorteo', input.id)
        const constancia = input.constancia?.trim() ?? ''
        if (constancia.length < 3) {
            throw new ValidacionFallida([
                {
                    field: 'constancia',
                    message: 'Registra la firma o constancia del notario o del delegado',
                    rule: 'required',
                },
            ])
        }
        const sorteo = await verSorteo(input.id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        exigirEstado(sorteo, ['ejecutado'], 'cerrar el acta')
        await exigirRequisitos(t.trx, sorteo.id, ['publicacion_resultados'], 'cerrar el acta')

        const empresa = (await t.trx
            .from('core.empresas')
            .where('id', sorteo.empresa_id)
            .select('nombre_comercial', 'razon_social', 'nit')
            .firstOrFail()) as { nombre_comercial: string; razon_social: string | null; nit: string | null }
        const extra = (await t.trx
            .from('lealtad.sorteos')
            .where('id', sorteo.id)
            .select('asistentes')
            .firstOrFail()) as { asistentes: Array<{ nombre: string; rol?: string | null }> | null }
        const ganadores = await ganadoresDe(sorteo.id, t.trx)
        const nombres = (await t.trx
            .from('core.clientes')
            .whereIn(
                'id',
                ganadores.map((g) => g.cliente_id),
            )
            .select('id', 'nombre')) as Array<{ id: number; nombre: string }>
        const participantes = (await t.trx
            .from('lealtad.sorteos_participantes')
            .where('sorteo_id', sorteo.id)
            .select(t.trx.raw('count(*)::int as n'), t.trx.raw('coalesce(sum(boletos), 0)::int as boletos'))
            .first()) as { n: number; boletos: number }
        const cerradaEn = new Date()
        const pdf = await actaPdf({
            sorteo,
            empresa: { nombre: empresa.razon_social ?? empresa.nombre_comercial, nit: empresa.nit },
            requisitos: await requisitosVigentes(sorteo.id, t.trx),
            ganadores: ganadores.map((g) => ({
                ...g,
                nombre_cliente:
                    nombres.find((c) => Number(c.id) === g.cliente_id)?.nombre ?? `Cliente ${g.cliente_id}`,
            })),
            participantes: Number(participantes.n),
            boletos: Number(participantes.boletos),
            asistentes: extra.asistentes ?? [],
            constancia,
            cerrada_en: cerradaEn,
        })
        const archivo = await registrarArchivo(
            t,
            sorteo,
            'acta',
            `acta-sorteo-${sorteo.id}.pdf`,
            prepararArchivo(pdf, 'acta'),
        )
        await t.trx
            .from('lealtad.sorteos')
            .where('id', sorteo.id)
            .update({
                estado: 'acta_cerrada',
                acta_archivo_id: archivo.id,
                acta_hash: archivo.sha256,
                acta_constancia: constancia,
                acta_cerrada_en: cerradaEn,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'sorteo', id: sorteo.id },
            { estado: sorteo.estado },
            { estado: 'acta_cerrada', acta_hash: archivo.sha256, acta_constancia: constancia },
        )
        await t.emit('sorteo.acta_cerrada', {
            sorteo_id: sorteo.id,
            empresa_id: sorteo.empresa_id,
            acta_hash: archivo.sha256,
        })
        await cerrarSiTodoResuelto(t, { id: sorteo.id, estado: 'acta_cerrada' }, ganadores)
        return detalleSorteo(sorteo.id, t.trx)
    }
}
