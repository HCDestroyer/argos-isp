import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { usuarioDelActor } from '#shared/contexto'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import type { ClaveCategoriaEgreso } from '#ledger/plan_cuentas'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import type { MetodoEgreso } from '#ledger/egresos'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { bloquearCliente } from '#billing/cobros'
import { verPremio } from '#lealtad/premios'
import { camposAuditables, verCanje } from '#lealtad/canjes'
import { detalleSorteo, exigirEstado, ganadoresDe, verSorteo } from '#lealtad/sorteos'

/**
 * `sorteos.entregar` (`POST /lealtad/sorteos/:id/ganadores/:g/entregar`, permiso `sorteos.entregar`):
 * registra la entrega del premio de un titular (§7.4). El premio es un **gasto promocional** a
 * `5.1.03 Premios y promociones`; la contrapartida depende del tipo de premio (decisión del líder):
 *
 * - `efectivo`: sale de Caja o Bancos como un **egreso** (categoría `premios` → 5.1.03; método `caja`,
 *   `banco` o `cuenta_bancaria`, como `POST /egresos`) por lo que se paga.
 * - `bien`: asiento `sorteo` `5.1.03 / contrapartida`: `proveedor` (`2.1.03 Proveedores`, comprado a
 *   crédito) o `cuenta` (`cuenta_codigo`: la cuenta de activo de donde sale, p. ej. inventario).
 * - `servicio`: el crédito de la empresa reúsa el flujo del canje: un canje sin puntos
 *   (`sorteo_ganador_id`) del premio del catálogo (`descuento_factura` o `mes_gratis`) queda reservado
 *   para la próxima factura del servicio del ganador, que lleva la línea `descuento` (`5.1.01`).
 *
 * ISR (parametrizado en el premio: `retiene_isr`, `isr_pct`, 10 % por defecto) a `2.1.05 Retenciones de
 * ISR por pagar`: en `efectivo` se retiene de lo que se paga (egreso por `valor − ISR`, asiento `5.1.03 /
 * 2.1.05` por el ISR); en especie (`bien`, `servicio`) la empresa lo asume (`5.1.03 / 2.1.05`). Pendiente
 * del contador (`a3.md`). El ganador pasa a `entregado`; con todos los titulares entregados, el sorteo
 * queda `premios_entregados`. Evento `sorteo.premio_entregado`.
 */

export interface EntradaEntregarPremio {
    sorteo_id: number
    ganador_id: number
    metodo?: MetodoEgreso | null
    caja_id?: number | null
    banco_id?: number | null
    cuenta_bancaria_id?: number | null
    contrapartida?: 'proveedor' | 'cuenta' | null
    cuenta_codigo?: string | null
    nota?: string | null
}

const CATEGORIA_PREMIOS = 'premios'

/** Categoría de egreso `premios` (→ 5.1.03); se crea la primera vez (la cuenta llega con el paquete GT). */
async function asegurarCategoriaPremios(t: Transaccion): Promise<void> {
    const existe = await t.trx.from('ledger.egresos_categorias').where('clave', CATEGORIA_PREMIOS).first()
    if (existe) return
    const cuenta = await idCuenta(t, CUENTAS_GT.PREMIOS_PROMOCIONES)
    await t.trx
        .knexQuery()
        .table('ledger.egresos_categorias')
        .insert({ clave: CATEGORIA_PREMIOS, nombre: 'Premios y promociones', cuenta_id: cuenta })
        .onConflict('nombre')
        .ignore()
}

async function idCuenta(t: Transaccion, codigo: string): Promise<number> {
    const fila = (await t.trx.from('ledger.cuentas').where('codigo', codigo).select('id').first()) as {
        id: number
    } | null
    if (!fila) {
        throw new ReglaNegocio(
            `Falta la cuenta ${codigo} en el plan: instale la localización fiscal de la empresa`,
            'cuenta_faltante',
        )
    }
    return Number(fila.id)
}

export default class EntregarPremioSorteo extends DomainAction<
    EntradaEntregarPremio,
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.entregar'

    protected async handle(input: EntradaEntregarPremio, t: Transaccion) {
        t.fijarEntidad('sorteo', input.sorteo_id)
        const sorteo = await verSorteo(input.sorteo_id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        exigirEstado(sorteo, ['ejecutado'], 'entregar premios')
        const todos = await ganadoresDe(sorteo.id, t.trx)
        const ganador = todos.find((g) => g.id === input.ganador_id)
        if (!ganador) throw new NoEncontrado(`El ganador ${input.ganador_id} no es del sorteo ${sorteo.id}`)
        if (ganador.tipo !== 'titular') {
            throw new ReglaNegocio(
                'Solo se entrega el premio de un titular (los suplentes, en la segunda PR)',
                'no_titular',
            )
        }
        if (!['por_notificar', 'notificado'].includes(ganador.estado)) {
            throw new ReglaNegocio(
                `El premio del ganador ${ganador.id} está ${ganador.estado}`,
                'premio_entregado',
            )
        }
        const premio = sorteo.premios.find((p) => p.posicion === ganador.premio_posicion)!
        const valor = dec(premio.valor)
        const isr: Dec = premio.retiene_isr ? redondear(valor.times(premio.isr_pct).dividedBy(100)) : CERO
        const descripcion = `Premio ${premio.posicion} del sorteo ${sorteo.id} (${premio.nombre}) al ganador ${ganador.posicion} (${ganador.codigo_publico})`
        await bloquearCliente(t.trx, ganador.cliente_id)

        const cambios: Record<string, unknown> = {}
        const movimientos: LineaAsiento[] = []
        if (premio.tipo === 'efectivo') {
            if (!input.metodo) {
                throw new ValidacionFallida([
                    {
                        field: 'metodo',
                        message: 'Indica de dónde sale el efectivo: caja, banco o cuenta_bancaria',
                        rule: 'required',
                    },
                ])
            }
            await asegurarCategoriaPremios(t)
            const egreso = await new RegistrarEgreso().execute(
                {
                    categoria: CATEGORIA_PREMIOS as ClaveCategoriaEgreso,
                    monto: aTexto(valor.minus(isr)),
                    metodo: input.metodo,
                    caja_id: input.caja_id ?? null,
                    banco_id: input.banco_id ?? null,
                    cuenta_bancaria_id: input.cuenta_bancaria_id ?? null,
                    descripcion,
                },
                t.ctx,
                { trx: t.trx },
            )
            if (Number(egreso.empresa_id) !== sorteo.empresa_id) {
                throw new ValidacionFallida([
                    {
                        field: input.metodo,
                        message: 'La caja o la cuenta es de otra empresa',
                        rule: 'empresa',
                    },
                ])
            }
            Object.assign(cambios, { egreso_id: egreso.id, contrapartida: input.metodo })
            if (isr.gt(0)) {
                movimientos.push(
                    { cuenta: CUENTAS_GT.PREMIOS_PROMOCIONES, debe: aTexto(isr) },
                    { cuenta: CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR, haber: aTexto(isr) },
                )
            }
        } else if (premio.tipo === 'bien') {
            const errores: ErrorCampo[] = []
            if (!input.contrapartida) {
                errores.push({
                    field: 'contrapartida',
                    message: 'proveedor (2.1.03) o cuenta (cuenta_codigo)',
                    rule: 'required',
                })
            }
            let contra: string = CUENTAS_GT.PROVEEDORES
            if (input.contrapartida === 'cuenta') {
                const fila = input.cuenta_codigo
                    ? ((await t.trx
                          .from('ledger.cuentas')
                          .where('codigo', input.cuenta_codigo)
                          .select('tipo', 'imputable', 'empresa_id')
                          .first()) as { tipo: string; imputable: boolean; empresa_id: number | null } | null)
                    : null
                if (
                    !fila ||
                    fila.tipo !== 'activo' ||
                    !fila.imputable ||
                    (fila.empresa_id !== null && Number(fila.empresa_id) !== sorteo.empresa_id)
                ) {
                    errores.push({
                        field: 'cuenta_codigo',
                        message:
                            'La cuenta debe ser de activo, imputable y de la empresa (p. ej. inventario)',
                        rule: 'cuenta',
                    })
                }
                contra = input.cuenta_codigo ?? ''
            }
            if (errores.length > 0) throw new ValidacionFallida(errores)
            movimientos.push(
                { cuenta: CUENTAS_GT.PREMIOS_PROMOCIONES, debe: aTexto(valor.plus(isr)) },
                { cuenta: contra, haber: aTexto(valor) },
            )
            if (isr.gt(0)) {
                movimientos.push({ cuenta: CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR, haber: aTexto(isr) })
            }
            cambios.contrapartida = input.contrapartida === 'cuenta' ? `cuenta ${contra}` : 'proveedor'
        } else {
            // servicio: canje sin puntos del premio del catálogo, reservado para la próxima factura
            const catalogo = await verPremio(premio.premio_id!, t.trx)
            const servicio = (await t.trx
                .from('lealtad.sorteos_participantes as p')
                .join('core.servicios as s', 's.id', 'p.servicio_id')
                .where('p.id', ganador.participante_id)
                .whereNot('s.estado', 'retirado')
                .select('s.id')
                .first()) as { id: number } | null
            if (!servicio) {
                throw new ReglaNegocio(
                    'El ganador no tiene un servicio vigente en la empresa',
                    'servicio_no_valido',
                )
            }
            const [fila] = (await t.trx
                .insertQuery()
                .table('lealtad.canjes')
                .insert({
                    empresa_id: sorteo.empresa_id,
                    programa_id: catalogo.programa_id,
                    cliente_id: ganador.cliente_id,
                    servicio_id: Number(servicio.id),
                    premio_id: catalogo.id,
                    tipo: catalogo.tipo,
                    puntos: 0,
                    canal: 'panel',
                    sorteo_ganador_id: ganador.id,
                    motivo: descripcion,
                    creado_por: usuarioDelActor(t.ctx.actor),
                })
                .returning('id')) as Array<{ id: number }>
            const canje = await verCanje(Number(fila!.id), t.trx)
            await t.registrarCambios({ tipo: 'canje_lealtad', id: canje.id }, null, {
                premio_id: canje.premio_id,
                puntos: 0,
                ...camposAuditables(canje),
            })
            await t.emit('lealtad.canje_reservado', {
                canje_id: canje.id,
                empresa_id: canje.empresa_id,
                cliente_id: canje.cliente_id,
                servicio_id: canje.servicio_id,
                premio_id: canje.premio_id,
                tipo: canje.tipo,
                puntos: 0,
                factura_id: null,
            })
            Object.assign(cambios, { canje_id: canje.id, contrapartida: 'canje' })
            if (isr.gt(0)) {
                movimientos.push(
                    { cuenta: CUENTAS_GT.PREMIOS_PROMOCIONES, debe: aTexto(isr) },
                    { cuenta: CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR, haber: aTexto(isr) },
                )
            }
        }
        if (movimientos.length > 0) {
            const asiento = await new RegistrarAsiento().execute(
                {
                    empresa_id: sorteo.empresa_id,
                    fecha: hoyGuatemala(),
                    descripcion,
                    origen_tipo: 'sorteo',
                    origen_id: ganador.id,
                    movimientos,
                },
                t.ctx,
                { trx: t.trx },
            )
            cambios.asiento_id = asiento.id
        }
        await t.trx
            .from('lealtad.sorteos_ganadores')
            .where('id', ganador.id)
            .update({
                ...cambios,
                estado: 'entregado',
                retencion_isr: aTexto(isr),
                nota: input.nota?.trim() || null,
                entregado_en: t.trx.knexRawQuery('now()'),
                entregado_por: usuarioDelActor(t.ctx.actor),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'sorteo_ganador', id: ganador.id },
            { estado: ganador.estado },
            { estado: 'entregado', retencion_isr: aTexto(isr), ...cambios },
        )
        const despues = await ganadoresDe(sorteo.id, t.trx)
        const pendientes = despues.filter((g) => g.tipo === 'titular' && g.estado !== 'entregado')
        if (pendientes.length === 0) {
            await t.trx
                .from('lealtad.sorteos')
                .where('id', sorteo.id)
                .update({
                    estado: 'premios_entregados',
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.registrarCambios(
                { tipo: 'sorteo', id: sorteo.id },
                { estado: 'ejecutado' },
                { estado: 'premios_entregados' },
            )
        }
        t.fijarEntidad('sorteo', sorteo.id)
        await t.emit('sorteo.premio_entregado', {
            sorteo_id: sorteo.id,
            empresa_id: sorteo.empresa_id,
            cliente_id: ganador.cliente_id,
            posicion: ganador.posicion,
        })
        return detalleSorteo(sorteo.id, t.trx)
    }
}
