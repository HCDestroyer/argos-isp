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
import { configuracionFel, modoEmision, type CertificarAl } from '#fiscal/fel/configuracion'
import type { TipoConceptoCargo } from '#billing/cargos_unicos'

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
 *   `motivo_sin_costo_texto`; la ruta exige además `facturas.cargo_sin_costo`. Nace `pagada`, sin CxC
 *   y **sin DTE** cualquiera sea el modo FEL; el asiento deja el bruto en ingresos y el descuento en
 *   `5.1.01` (neto 0). Un motivo con total > 0 → 422.
 * - FEL activa con un concepto exento (`gravable: false`) → 422 `concepto_exento_con_fel`: el DTE aún no
 *   lleva la frase de exención (pendiente del contador).
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

export default class EmitirCargoUnico extends DomainAction<
    EntradaEmitirCargoUnico,
    Awaited<ReturnType<typeof verFactura>>
> {
    readonly nombre = 'facturas.emitir_cargo_unico'

    protected async handle(input: EntradaEmitirCargoUnico, t: Transaccion) {
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
            })
        })
        if (errores.length > 0) throw new ValidacionFallida(errores)
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
                ...(sinCosto ? { sin_costo: true } : {}),
            },
            certificar_al: certificarAl,
            descripcion: `cargo único ${servicio ? `servicio ${servicio.id}` : `cliente ${clienteId}`}`,
            sin_costo: sinCosto,
        })
        const facturaId = emision.factura_id!
        t.fijarEntidad('factura', facturaId)
        return verFactura(facturaId, t.trx)
    }
}
