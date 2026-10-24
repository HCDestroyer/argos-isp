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
import { CUENTAS_DEL_KARDEX, esCuentaDelKardex, CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { bloquearCliente } from '#billing/cobros'
import { verPremio } from '#lealtad/premios'
import { camposAuditables, verCanje } from '#lealtad/canjes'
import { detalleSorteo, exigirEstado, ganadoresDe, verSorteo } from '#lealtad/sorteos'
import { verArchivo } from '#lealtad/sorteos_archivos'
import { cerrarSiTodoResuelto } from '#lealtad/sorteos_entrega'

/**
 * `sorteos.entregar` (`POST /lealtad/sorteos/:id/ganadores/:g/entregar`, permiso `sorteos.entregar`):
 * registra la entrega del premio de un titular (§7.4). El premio es un **gasto promocional** a
 * `5.1.03 Premios y promociones`; la contrapartida depende del tipo de premio (decisión del líder):
 *
 * - `efectivo`: sale de Caja o Bancos como un **egreso** (categoría `premios` → 5.1.03; método `caja`,
 *   `banco` o `cuenta_bancaria`, como `POST /egresos`) por lo que se paga.
 * - `bien`: asiento `sorteo` `5.1.03 / contrapartida`: `compra` (decisión del PM, 19 oct: el bien se
 *   compró con factura, una compra registrada; su IVA ya es crédito fiscal y el premio es gasto deducible
 *   `5.1.03` por la base sin IVA de la línea, contra la cuenta de esa línea; si la línea ya fue a
 *   `5.1.03`, solo se liga); `proveedor` ya no (422 `contrapartida_proveedor`: 2.1.03 solo con una compra)
 *   y `cuenta` (`cuenta_codigo`: un activo fuera de las cuentas control, H25, p. ej. un inventario).
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
    contrapartida?: 'proveedor' | 'cuenta' | 'compra' | null
    cuenta_codigo?: string | null
    /** con `compra`: la línea de la compra registrada con la que se compró el bien (decisión del PM) */
    compra_linea_id?: number | null
    /** constancia firmada de la entrega (`POST /lealtad/sorteos/:id/archivos`, uso `constancia`) */
    constancia_archivo_id?: number | null
    /** con `compra`: unidades de la línea que se entregan (1 por defecto) */
    unidades?: number | null
    nota?: string | null
}

const CATEGORIA_PREMIOS = 'premios'

interface CuentaContrapartida {
    codigo: string
    tipo: string
    imputable: boolean
    empresa_id: number | null
    contracuenta: boolean
    auxiliar_cliente: boolean
}

/**
 * H25: cuentas control del plan que nunca son la contrapartida de un bien entregado (tienen su propio
 * documento): cajas y bancos, CxC, impuestos (1.1.04–1.1.09), cobros por liquidar, fondos en tránsito,
 * estimación de incobrables, gastos anticipados y el activo no corriente (un activo fijo sale con su
 * baja, `activos.dar_de_baja`).
 */
const CONTROL_NO_PERMITIDAS = [
    '1.1.01',
    '1.1.02',
    '1.1.03',
    '1.1.04',
    '1.1.05',
    '1.1.06',
    '1.1.07',
    '1.1.08',
    '1.1.09',
    '1.1.10',
    '1.1.11',
    '1.1.12',
    '1.1.13',
    // H39: la cuenta del kardex (1.1.14) solo la mueve el inventario
    ...CUENTAS_DEL_KARDEX,
    '1.2',
]

/**
 * Lista blanca de la contrapartida `cuenta` de un premio en bienes: un activo imputable, propio de la
 * empresa o global, que no sea contracuenta ni auxiliar de clientes y que no esté bajo las cuentas
 * control (p. ej. un «Inventario de premios» que crea la empresa).
 */
/** Propiedad, planta y equipo o su depreciación (`1.2.01.*`, `1.2.02.*`). */
export function esCuentaDeActivoFijo(codigo: string): boolean {
    return [CUENTAS_GT.PROPIEDAD_PLANTA_EQUIPO, CUENTAS_GT.DEPRECIACION_ACUMULADA].some(
        (c) => codigo === c || codigo.startsWith(`${c}.`),
    )
}

export function cuentaParaBienDePremio(c: CuentaContrapartida, empresaId: number): boolean {
    if (c.tipo !== 'activo' || !c.imputable || c.contracuenta || c.auxiliar_cliente) return false
    if (c.empresa_id !== null && Number(c.empresa_id) !== empresaId) return false
    return !CONTROL_NO_PERMITIDAS.some((p) => c.codigo === p || c.codigo.startsWith(`${p}.`))
}

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
        exigirEstado(sorteo, ['ejecutado', 'acta_cerrada'], 'entregar premios')
        const todos = await ganadoresDe(sorteo.id, t.trx)
        const ganador = todos.find((g) => g.id === input.ganador_id)
        if (!ganador) throw new NoEncontrado(`El ganador ${input.ganador_id} no es del sorteo ${sorteo.id}`)
        if (ganador.premio === null) {
            throw new ReglaNegocio(
                'Solo se entrega el premio de un titular o de un suplente que tomó el de un ganador que no lo reclamó',
                'sin_premio',
            )
        }
        if (!['por_notificar', 'notificado'].includes(ganador.estado)) {
            throw new ReglaNegocio(
                `El premio del ganador ${ganador.id} está ${ganador.estado}`,
                'premio_entregado',
            )
        }
        const premio = sorteo.premios.find((p) => p.posicion === ganador.premio)!
        let constanciaId: number | null = null
        if (input.constancia_archivo_id) {
            const archivo = await verArchivo(sorteo.id, input.constancia_archivo_id, t.trx).catch(() => null)
            if (!archivo || archivo.uso !== 'constancia') {
                throw new ValidacionFallida([
                    {
                        field: 'constancia_archivo_id',
                        message: 'La constancia debe ser un archivo de uso constancia subido a este sorteo',
                        rule: 'archivo',
                    },
                ])
            }
            constanciaId = archivo.id
        }
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
            Object.assign(
                cambios,
                await contabilizarBien(t, input, sorteo.empresa_id, valor, isr, movimientos),
            )
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
                constancia_archivo_id: constanciaId,
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
        // con el acta cerrada y ningún premio pendiente, el sorteo queda `premios_entregados`
        await cerrarSiTodoResuelto(t, sorteo, await ganadoresDe(sorteo.id, t.trx))
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

/**
 * Contrapartida de un premio en bienes (decisión del líder y del PM): agrega sus movimientos al asiento
 * `sorteo` y devuelve lo que se guarda en el ganador.
 */
async function contabilizarBien(
    t: Transaccion,
    input: EntradaEntregarPremio,
    empresaId: number,
    valor: Dec,
    isr: Dec,
    movimientos: LineaAsiento[],
): Promise<Record<string, unknown>> {
    const errores: ErrorCampo[] = []
    if (!input.contrapartida) {
        errores.push({
            field: 'contrapartida',
            message: 'compra (compra_linea_id) o cuenta (cuenta_codigo)',
            rule: 'required',
        })
        throw new ValidacionFallida(errores)
    }
    const isrMovimiento = () => {
        if (isr.gt(0)) movimientos.push({ cuenta: CUENTAS_GT.RETENCIONES_ISR_POR_PAGAR, haber: aTexto(isr) })
    }
    if (input.contrapartida === 'compra') {
        const linea = input.compra_linea_id
            ? ((await t.trx
                  .from('ledger.compras_lineas as l')
                  .join('ledger.compras as c', 'c.id', 'l.compra_id')
                  .join('ledger.cuentas as cu', 'cu.id', 'l.cuenta_id')
                  .where('l.id', input.compra_linea_id)
                  .whereNotExists((q) =>
                      q.from('ledger.compras_anulaciones as x').whereRaw('x.compra_id = c.id'),
                  )
                  .select(
                      'l.id',
                      'l.base',
                      'l.cantidad',
                      'l.tipo',
                      'c.id as compra_id',
                      'c.empresa_id',
                      'c.tipo_documento',
                      'cu.codigo',
                  )
                  .first()) as {
                  id: number
                  base: string
                  cantidad: number
                  tipo: string
                  compra_id: number
                  empresa_id: number
                  tipo_documento: string
                  codigo: string
              } | null)
            : null
        if (
            !linea ||
            Number(linea.empresa_id) !== empresaId ||
            linea.tipo !== 'bien' ||
            linea.tipo_documento === 'NCRE'
        ) {
            throw new ValidacionFallida([
                {
                    field: 'compra_linea_id',
                    message:
                        'La línea debe ser un bien de una compra registrada (no anulada, no nota de crédito) de la empresa',
                    rule: 'compra',
                },
            ])
        }
        // H39: una línea que entró al inventario (1.1.14) no se acredita aquí: el bien está en el kardex
        // y su salida necesita su movimiento; mientras el inventario no tenga la salida por premio, 422
        if (esCuentaDelKardex(linea.codigo)) {
            throw new ReglaNegocio(
                `La línea ${linea.id} de la compra ${linea.compra_id} entró al inventario (${linea.codigo}): el premio no se entrega desde la compra, porque el bien ya está en el kardex`,
                'linea_de_inventario',
            )
        }
        // observación del auditor: una línea que fue a propiedad, planta y equipo es un activo fijo;
        // un premio no la acredita (el activo se registra y se da de baja por su propia acción)
        if (esCuentaDeActivoFijo(linea.codigo)) {
            throw new ReglaNegocio(
                `La línea ${linea.id} de la compra ${linea.compra_id} fue a la cuenta de activo fijo ${linea.codigo}: no se entrega como premio`,
                'linea_activo_fijo',
            )
        }
        // observación del auditor: cada entrega consume sus unidades de la línea, prorrateadas
        const unidades = input.unidades ?? 1
        const cantidad = Number(linea.cantidad)
        await t.trx.rawQuery(`SELECT pg_advisory_xact_lock(hashtext('lealtad.compra_linea'), ?::integer)`, [
            Number(linea.id),
        ])
        const previas = (await t.trx
            .from('lealtad.sorteos_ganadores')
            .where('compra_linea_id', linea.id)
            .select(
                t.trx.raw('coalesce(sum(compra_unidades), 0)::int as unidades'),
                t.trx.raw('coalesce(sum(compra_base), 0)::text as base'),
            )
            .first()) as { unidades: number; base: string }
        const usadas = Number(previas.unidades)
        if (usadas + unidades > cantidad) {
            throw new ReglaNegocio(
                `La línea ${linea.id} de la compra ${linea.compra_id} tiene ${cantidad} unidad(es) y ya se entregaron ${usadas}: quedan ${cantidad - usadas}`,
                'compra_ya_entregada',
            )
        }
        // la parte de esta entrega: base × (usadas + unidades) / cantidad menos lo ya tomado; la
        // última lleva el resto y la suma de las entregas es la base exacta
        const base = dec(linea.base)
        const parte = redondear(base.times(usadas + unidades).dividedBy(cantidad)).minus(dec(previas.base))
        // la línea ya fue gasto de premios en la compra: solo el ISR; si no, 5.1.03 / su cuenta por su parte
        if (linea.codigo !== CUENTAS_GT.PREMIOS_PROMOCIONES && parte.gt(0)) {
            movimientos.push(
                { cuenta: CUENTAS_GT.PREMIOS_PROMOCIONES, debe: aTexto(parte) },
                { cuenta: linea.codigo, haber: aTexto(parte) },
            )
        }
        if (isr.gt(0)) movimientos.push({ cuenta: CUENTAS_GT.PREMIOS_PROMOCIONES, debe: aTexto(isr) })
        isrMovimiento()
        return {
            contrapartida: `compra ${linea.compra_id}`,
            compra_linea_id: Number(linea.id),
            compra_unidades: unidades,
            compra_base: aTexto(parte),
        }
    }
    if (input.contrapartida === 'proveedor') {
        // decisión del líder (19 oct): 2.1.03 solo se mueve con una compra (fase 5, CxP = compras)
        throw new ReglaNegocio(
            'Un bien comprado a crédito se registra primero como compra (POST /compras) y se entrega con contrapartida compra (compra_linea_id)',
            'contrapartida_proveedor',
        )
    }
    const fila = input.cuenta_codigo
        ? ((await t.trx
              .from('ledger.cuentas')
              .where('codigo', input.cuenta_codigo)
              .select('codigo', 'tipo', 'imputable', 'empresa_id', 'contracuenta', 'auxiliar_cliente')
              .first()) as CuentaContrapartida | null)
        : null
    if (!fila || !cuentaParaBienDePremio(fila, empresaId)) {
        throw new ValidacionFallida([
            {
                field: 'cuenta_codigo',
                message:
                    'La cuenta debe ser un activo imputable de la empresa fuera de las cuentas control (caja, bancos, CxC, impuestos, cobros por liquidar, fondos en tránsito, estimación, gastos anticipados y propiedad, planta y equipo con su depreciación): p. ej. un inventario de premios',
                rule: 'cuenta',
            },
        ])
    }
    movimientos.push(
        { cuenta: CUENTAS_GT.PREMIOS_PROMOCIONES, debe: aTexto(valor.plus(isr)) },
        { cuenta: fila.codigo, haber: aTexto(valor) },
    )
    isrMovimiento()
    return { contrapartida: `cuenta ${fila.codigo}` }
}
