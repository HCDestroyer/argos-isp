import { randomUUID } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ReglaNegocio, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { CERO, dec, redondear, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida, hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { bloquearCliente } from '#billing/cobros'
import { configuracionDeServicio, leerServicio, type ServicioFacturable } from '#billing/configuracion'
import { sumarDias } from '#billing/periodos'
import {
    aplicarDescuentos,
    lineaConIva,
    totalesDe,
    verFactura,
    type DescuentoPedido,
    type LineaCalculada,
} from '#billing/facturas'
import { emitirDocumento } from '#billing/emision'
import { registrarBonificacion, type BonificacionVista } from '#billing/bonificaciones'
import { configuracionFel, modoEmision, type CertificarAl } from '#fiscal/fel/configuracion'
import type { TipoConceptoCargo } from '#billing/cargos_unicos'
import { prepararVentas, registrarVentas } from '#inventario/ventas'
import { origenExternoDe, type OrigenExternoTipo } from '#inventario/origen_externo'

/**
 * `facturas.emitir_cargo_unico` (`POST /facturas/cargo-unico`): factura manual de un cargo que no es
 * de un periodo (instalación, equipo, visita técnica…). Decisiones del líder (cargo único manual):
 *
 * - `clave_unica = cargo-<uuid>`: nunca ocupa la clave `servicio_id-periodo` ni la de importación.
 *   `periodo` = primer día del mes de emisión (para los reportes). Idempotente por `Idempotency-Key`.
 * - Cada línea sale de un **concepto de cargo** del catálogo de la empresa (`billing.conceptos_cargo`):
 *   su cuenta de ingreso (`cuenta_codigo`, guardada en la línea), su IVA (`gravable`) y si es bien o
 *   servicio (`tipo`). Precio **bruto** con IVA incluido (> 0) × cantidad; `descuentos[]` opcionales
 *   por línea (también parciales) van como líneas `descuento` (IVA del neto, `5.1.01` al debe).
 * - Con `servicio_id` la factura es del servicio (su empresa, su cliente, sus días de gracia y su
 *   `certificar_al`) y, vencida, cuenta para el corte como toda factura del servicio. Sin servicio es
 *   del cliente (`cliente_id`) en la empresa indicada o la activa; vence hoy salvo `vence_en`.
 * - Sin mora (`mora_tipo: ninguna` en `reglas_snapshot`): el recargo es de las mensualidades.
 * - Asiento como toda factura: `CxC + 5.1.01 / ingreso de cada concepto + IVA`; `factura.emitida`;
 *   aplica el anticipo del cliente. Total > 0: se certifica según el modo FEL de la empresa.
 * - **Total Q0** (todo descontado): exige `motivo_sin_costo_id` (catálogo activo de la empresa) y
 *   `motivo_sin_costo_texto`; la ruta exige además `facturas.cargo_sin_costo`. Decisión del PM (19 oct):
 *   **no hay factura**; se registra una **bonificación** (`#billing/bonificaciones`, origen
 *   `cargo_sin_costo`) con su asiento interno `5.1.01 / ingreso` por la base, sin CxC, IVA ni DTE. Un
 *   motivo con total > 0 → 422.
 * - Devuelve la factura o la bonificación con `documento` (`factura` | `bonificacion`); la ruta responde
 *   `{ documento, factura, bonificacion }`.
 * - **Inventario** (fase C, `contratos/inventario.md` §5): una línea con `producto_id` y `bodega_id`
 *   (y `unidad_id` si es de serie) vende del kardex: sale al costo promedio (o al de la unidad) con su
 *   asiento de costo de ventas `5.6.01 / 1.1.14` en esta transacción (`#inventario/ventas`). 409
 *   `existencia_insuficiente`, `unidad_en_comodato`; un cargo en Q0 con producto: 422 `producto_sin_costo`.
 * - FEL activa con un concepto exento (`gravable: false`) → 422 `concepto_exento_con_fel`: el DTE aún no
 *   lleva la frase de exención (pendiente del contador).
 * - **Origen** (pedido A4 de Iris, `contratos/iris.md` §5.1): `origen_tipo = iris_orden` + `origen_id`
 *   (la orden de trabajo) se guardan en la factura o la bonificación (`origen_externo_*`) y salen en la
 *   respuesta y en la auditoría. Solo trazabilidad: el asiento no cambia. Iris manda
 *   `Idempotency-Key: iris:cargo:<orden_id>` (la ruta es idempotente).
 */

export interface LineaCargoUnico {
    concepto_id: number
    /** texto de la línea; por defecto el nombre del concepto */
    descripcion?: string | null
    /** por defecto 1 */
    cantidad?: string
    /** precio unitario bruto con IVA incluido (> 0) */
    precio_unitario: string
    descuentos?: Array<{ concepto: string; monto: string }>
    /** inventario (fase C): vende del kardex de esta bodega (y esta unidad si es de serie) */
    producto_id?: number | null
    bodega_id?: number | null
    unidad_id?: number | null
}

export interface EntradaEmitirCargoUnico {
    servicio_id?: number | null
    cliente_id?: number | null
    empresa_id?: number | null
    /** YYYY-MM-DD, hoy o después; por defecto hoy + días de gracia del servicio (sin servicio: hoy) */
    vence_en?: string | null
    lineas: LineaCargoUnico[]
    motivo_sin_costo_id?: number | null
    motivo_sin_costo_texto?: string | null
    /** orden de Iris (`iris_orden`); con origen_tipo, origen_id es obligatorio */
    origen_tipo?: OrigenExternoTipo | null
    origen_id?: string | null
}

interface ConceptoFila {
    id: number
    empresa_id: number
    nombre: string
    tipo: TipoConceptoCargo
    cuenta_codigo: string
    gravable: boolean
    activo: boolean
}

const MORA_NINGUNA = { mora_tipo: 'ninguna', mora_valor: '0.00', mora_recurrente: false }

export type ResultadoCargoUnico =
    | (Awaited<ReturnType<typeof verFactura>> & { documento: 'factura' })
    | (BonificacionVista & { documento: 'bonificacion' })

export default class EmitirCargoUnico extends DomainAction<EntradaEmitirCargoUnico, ResultadoCargoUnico> {
    readonly nombre = 'facturas.emitir_cargo_unico'

    protected async handle(input: EntradaEmitirCargoUnico, t: Transaccion) {
        const origenExterno = origenExternoDe(input)
        const hoy = hoyGuatemala()
        let servicio: ServicioFacturable | null = null
        let clienteId: number
        let empresaId: number
        if (input.servicio_id) {
            servicio = await leerServicio(t.trx, input.servicio_id)
            t.fijarEntidad('servicio', servicio.id)
            if (input.cliente_id && input.cliente_id !== servicio.cliente_id) {
                throw new ValidacionFallida([
                    {
                        field: 'cliente_id',
                        message: `El servicio ${servicio.id} es del cliente ${servicio.cliente_id}`,
                        rule: 'cliente_id',
                    },
                ])
            }
            if (input.empresa_id && input.empresa_id !== servicio.empresa_id) {
                throw new ValidacionFallida([
                    {
                        field: 'empresa_id',
                        message: `El servicio ${servicio.id} es de la empresa ${servicio.empresa_id}`,
                        rule: 'empresa_servicio',
                    },
                ])
            }
            clienteId = servicio.cliente_id
            empresaId = servicio.empresa_id
        } else {
            if (!input.cliente_id) {
                throw new ValidacionFallida([
                    {
                        field: 'cliente_id',
                        message: 'Indica el cliente o el servicio del cargo',
                        rule: 'required',
                    },
                ])
            }
            clienteId = input.cliente_id
            t.fijarEntidad('cliente', clienteId)
            const cliente = await t.trx.from('core.clientes').where('id', clienteId).select('id').first()
            if (!cliente) {
                throw new ValidacionFallida([
                    { field: 'cliente_id', message: `El cliente ${clienteId} no existe`, rule: 'exists' },
                ])
            }
            if (input.empresa_id) {
                await exigirEmpresaActiva(t.trx, input.empresa_id)
                empresaId = input.empresa_id
            } else {
                empresaId = await resolverEmpresaActiva(t.ctx, t.trx)
            }
        }
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        await bloquearCliente(t.trx, clienteId)

        const config = servicio ? await configuracionDeServicio(t.trx, servicio) : null
        if (servicio && !config) {
            throw new ReglaNegocio('El servicio no tiene plantilla de facturación', 'sin_plantilla')
        }

        // líneas desde el catálogo de conceptos (activos, de la empresa)
        const ids = [...new Set(input.lineas.map((l) => l.concepto_id))]
        const conceptos = (await t.trx
            .from('billing.conceptos_cargo')
            .whereIn('id', ids)
            .select(
                'id',
                'empresa_id',
                'nombre',
                'tipo',
                'cuenta_codigo',
                'gravable',
                'activo',
            )) as ConceptoFila[]
        const porId = new Map(conceptos.map((c) => [Number(c.id), c]))
        const errores: ErrorCampo[] = []
        const lineas: LineaCalculada[] = []
        const descuentos: DescuentoPedido[] = []
        input.lineas.forEach((l, i) => {
            const concepto = porId.get(Number(l.concepto_id))
            if (!concepto || Number(concepto.empresa_id) !== empresaId) {
                errores.push({
                    field: `lineas.${i}.concepto_id`,
                    message: `El concepto ${l.concepto_id} no es del catálogo de la empresa ${empresaId}`,
                    rule: 'concepto',
                })
                return
            }
            if (!concepto.activo) {
                errores.push({
                    field: `lineas.${i}.concepto_id`,
                    message: `El concepto «${concepto.nombre}» está inactivo`,
                    rule: 'concepto_activo',
                })
                return
            }
            const cantidad = dec(l.cantidad ?? '1')
            const precio = dec(l.precio_unitario)
            if (!cantidad.gt(0)) {
                errores.push({
                    field: `lineas.${i}.cantidad`,
                    message: 'La cantidad debe ser mayor que 0',
                    rule: 'min',
                })
                return
            }
            if (!precio.gt(0) || !tieneCentavosExactos(precio)) {
                errores.push({
                    field: `lineas.${i}.precio_unitario`,
                    message:
                        'El precio bruto debe ser mayor que 0 y con centavos exactos (un cargo sin costo va con su descuento)',
                    rule: 'precio',
                })
                return
            }
            const bruto = redondear(cantidad.times(precio))
            let descontado = CERO
            for (const [j, d] of (l.descuentos ?? []).entries()) {
                const monto = dec(d.monto)
                if (!monto.gt(0) || !tieneCentavosExactos(monto)) {
                    errores.push({
                        field: `lineas.${i}.descuentos.${j}.monto`,
                        message: 'El descuento debe ser mayor que 0 y con centavos exactos',
                        rule: 'monto',
                    })
                    continue
                }
                descontado = descontado.plus(monto)
                descuentos.push({ indice: lineas.length, concepto: d.concepto.trim(), monto: d.monto })
            }
            if (descontado.gt(bruto)) {
                errores.push({
                    field: `lineas.${i}.descuentos`,
                    message: `Los descuentos (Q${descontado.toFixed(2)}) pasan el bruto de la línea (Q${bruto.toFixed(2)})`,
                    rule: 'descuento',
                })
            }
            lineas.push({
                ...lineaConIva({
                    concepto: l.descripcion?.trim() || concepto.nombre,
                    tipo: concepto.tipo,
                    cantidad: cantidad.toString(),
                    gravable: concepto.gravable,
                    total: bruto,
                }),
                precio_unitario: precio.toFixed(2),
                cuenta_codigo: concepto.cuenta_codigo,
                ...(l.producto_id
                    ? {
                          producto_id: l.producto_id,
                          bodega_id: l.bodega_id ?? null,
                          unidad_id: l.unidad_id ?? null,
                      }
                    : {}),
            })
        })
        if (errores.length > 0) throw new ValidacionFallida(errores)
        // inventario (fase C): valida y costea lo que se vende, con el lock de cada producto
        const ventas = await prepararVentas(
            t,
            empresaId,
            input.lineas.map((l) => ({
                producto_id: l.producto_id,
                bodega_id: l.bodega_id,
                unidad_id: l.unidad_id,
                cantidad: l.cantidad ?? '1',
            })),
        )
        const conDescuentos = descuentos.length > 0 ? aplicarDescuentos(lineas, descuentos) : lineas
        const totales = totalesDe(conDescuentos)

        // total Q0: motivo obligatorio; con total > 0, sin motivo
        let sinCosto: { motivo_id: number; texto: string } | null = null
        const texto = input.motivo_sin_costo_texto?.trim() ?? ''
        if (totales.total.isZero()) {
            const faltan: ErrorCampo[] = []
            if (!input.motivo_sin_costo_id) {
                faltan.push({
                    field: 'motivo_sin_costo_id',
                    message: 'Un cargo en Q0 necesita su motivo del catálogo',
                    rule: 'required',
                })
            }
            if (!texto) {
                faltan.push({
                    field: 'motivo_sin_costo_texto',
                    message: 'Un cargo en Q0 necesita explicar el motivo',
                    rule: 'required',
                })
            }
            if (faltan.length > 0) throw new ValidacionFallida(faltan)
            const motivo = (await t.trx
                .from('billing.motivos_sin_costo')
                .where('id', input.motivo_sin_costo_id!)
                .select('empresa_id', 'nombre', 'activo')
                .first()) as { empresa_id: number; nombre: string; activo: boolean } | null
            if (!motivo || Number(motivo.empresa_id) !== empresaId || !motivo.activo) {
                throw new ValidacionFallida([
                    {
                        field: 'motivo_sin_costo_id',
                        message:
                            !motivo || Number(motivo.empresa_id) !== empresaId
                                ? `El motivo ${input.motivo_sin_costo_id} no es del catálogo de la empresa ${empresaId}`
                                : `El motivo «${motivo.nombre}» está inactivo`,
                        rule: 'motivo',
                    },
                ])
            }
            if (ventas.length > 0) {
                throw new ValidacionFallida([
                    {
                        field: `lineas.${ventas[0]!.indice}.producto_id`,
                        message:
                            'Un equipo o material entregado sin costo no es una venta: dalo de baja, consúmelo o préstalo en comodato',
                        rule: 'producto_sin_costo',
                    },
                ])
            }
            sinCosto = { motivo_id: input.motivo_sin_costo_id!, texto }
        } else if (input.motivo_sin_costo_id || texto) {
            throw new ValidacionFallida([
                {
                    field: 'motivo_sin_costo_id',
                    message: 'El motivo sin costo solo va en un cargo de total Q0',
                    rule: 'sin_costo',
                },
            ])
        }

        const certificarAl: CertificarAl = config?.certificar_al ?? 'emitir'
        if (!sinCosto && conDescuentos.some((l) => l.tipo !== 'descuento' && !l.gravable)) {
            const fel = await configuracionFel(empresaId, t.trx)
            if (modoEmision(fel, certificarAl) !== 'sin_fel') {
                throw new ReglaNegocio(
                    'La empresa certifica con FEL y el DTE aún no lleva la frase de exención de un concepto sin IVA',
                    'concepto_exento_con_fel',
                )
            }
        }

        let venceEn: string
        if (sinCosto) venceEn = hoy
        else if (input.vence_en) {
            venceEn = fechaValida(input.vence_en, 'vence_en')
            if (venceEn < hoy) {
                throw new ValidacionFallida([
                    { field: 'vence_en', message: 'El vencimiento no puede ser pasado', rule: 'fecha' },
                ])
            }
        } else venceEn = sumarDias(hoy, config?.dias_gracia ?? 0)

        const clave = `cargo-${randomUUID()}`
        if (sinCosto) {
            const { bonificacion } = await registrarBonificacion(t, {
                empresa_id: empresaId,
                cliente_id: clienteId,
                servicio_id: servicio?.id ?? null,
                periodo: inicioDeMes(hoy),
                clave_unica: clave,
                concepto: lineas.map((l) => l.concepto).join(', '),
                origen: 'cargo_sin_costo',
                lineas: conDescuentos,
                motivo_id: sinCosto.motivo_id,
                motivo_texto: sinCosto.texto,
                reglas_snapshot: { ...MORA_NINGUNA, cargo_unico: true, sin_costo: true },
                origen_externo: origenExterno,
            })
            t.fijarEntidad('bonificacion', bonificacion.id)
            return { ...bonificacion, documento: 'bonificacion' as const }
        }
        const emision = await emitirDocumento(t, {
            empresa_id: empresaId,
            cliente_id: clienteId,
            servicio_id: servicio?.id ?? null,
            periodo: inicioDeMes(hoy),
            clave_unica: clave,
            vence_en: venceEn,
            lineas: conDescuentos,
            reglas_snapshot: {
                ...(config ?? {}),
                ...MORA_NINGUNA,
                certificar_al: certificarAl,
                cargo_unico: true,
            },
            certificar_al: certificarAl,
            descripcion: `cargo único ${servicio ? `servicio ${servicio.id}` : `cliente ${clienteId}`}`,
            origen_externo: origenExterno,
        })
        const facturaId = emision.factura_id!
        await registrarVentas(t, ventas, {
            id: facturaId,
            empresa_id: empresaId,
            fecha: hoy,
            servicio_id: servicio?.id ?? null,
        })
        t.fijarEntidad('factura', facturaId)
        return { ...(await verFactura(facturaId, t.trx)), documento: 'factura' as const }
    }
}
