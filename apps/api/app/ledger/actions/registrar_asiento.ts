import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { usuarioDelActor } from '#shared/contexto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ReglaNegocio, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { CERO, aTexto, dec, tieneCentavosExactos, type Dec, type Monto } from '#ledger/dinero'
import { fechaValida, hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import { periodoCerrado } from '#ledger/cierres'
import { resolverEmpresaActiva } from '#core/empresas'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { PAIS_PLAN } from '#ledger/plan_cuentas'
import { CUADRICULAS_GT } from '#fiscal/l10n/gt/impuestos'
import { diarioDeAsiento, numerarAsiento } from '#ledger/diarios'

/**
 * `registrarAsiento`: única puerta de entrada al libro. Toda acción que mueve dinero (facturas,
 * pagos, mora, cajas, egresos) llama esta acción anidada con `{ trx: t.trx }`.
 *
 * Valida antes de escribir (errores 422 legibles) y, además, la base de datos lo vuelve a
 * verificar: triggers de periodo cerrado, cuenta imputable/activa, auxiliar por cliente y el
 * constraint trigger de cuadre. El cuadre se fuerza **dentro** de la acción con
 * `SET CONSTRAINTS ... IMMEDIATE`, así un descuadre nunca se pierde en un COMMIT silencioso.
 *
 * Numeración (§10.7 de localización fiscal): en la misma transacción el asiento recibe su diario
 * (derivado del origen y de las cuentas que toca, o el de `diario`) y el siguiente número de ese
 * diario en el año de su fecha (`ledger.asientos_numeros`, sin huecos: ver `#ledger/diarios`).
 */

export const ORIGENES_ASIENTO = [
    'factura',
    'pago',
    'mora',
    'nota_credito',
    'egreso',
    'cierre_caja',
    'ajuste',
    'reclasificacion',
    // fase 4 (§10.3, §10.9): cobros y bancos, cartera
    'liquidacion_cobro',
    'deposito',
    'traslado',
    'banco',
    'provision',
    'castigo',
    // B (decisión del líder): diferencia de cobro como gasto; origen_id = `billing.diferencias_cobro.id`
    'diferencia_cobro',
    // fase 5 (§3.4, §10.10): compras, pagos a proveedores, activos fijos y diferidos
    'compra',
    'pago_proveedor',
    'depreciacion',
    'baja_activo',
    'diferido',
    'alta_activo',
    // pasivo del programa de lealtad (`contratos/lealtad.md` §6); origen_id = `lealtad.movimientos.id`
    'lealtad',
    // lealtad fase 3: entrega de premios de sorteo en especie e ISR retenido; origen_id = el ganador
    'sorteo',
    // decisiones del PM (19 oct): lo que era una factura de Q0; origen_id = `billing.bonificaciones.id`
    'bonificacion',
] as const
export type OrigenAsiento = (typeof ORIGENES_ASIENTO)[number]

export interface LineaAsiento {
    /** código del plan (`'1.1.03'`) o id de la cuenta */
    cuenta: string | number
    debe?: Monto | null
    haber?: Monto | null
    /** obligatorio en cuentas con auxiliar por cliente (CxC, anticipos) */
    cliente_id?: number | null
    /** obligatorio en cuentas con auxiliar por proveedor (`2.1.03 Proveedores`, fase 5) */
    proveedor_id?: number | null
    /**
     * Etiqueta de impuesto de la partida (`fiscal.impuestos`): el código y la cuadrícula de la base o
     * de la cuota. Van juntos. Las acciones la irán poniendo en las fases de FEL y declaraciones.
     */
    impuesto_codigo?: string | null
    cuadricula?: string | null
}

export interface EntradaAsiento {
    /**
     * empresa (NIT) del libro en el que va el asiento: la del documento (factura, pago, caja…).
     * Sin ella (asientos manuales), la empresa activa del contexto o la única activa.
     */
    empresa_id?: number | null
    /** fecha contable YYYY-MM-DD; por defecto hoy en Guatemala */
    fecha?: string
    descripcion: string
    origen_tipo: OrigenAsiento
    /** obligatorio salvo en `ajuste` */
    origen_id?: number | null
    /** id del asiento que este revierte (lo usa `RevertirAsiento`) */
    reversa_de?: number | null
    /** código del diario (`VEN`, `CAJ-3`…); por defecto se deriva del origen y las cuentas */
    diario?: string | null
    movimientos: LineaAsiento[]
}

export interface MovimientoRegistrado {
    id: number
    cuenta_id: number
    cuenta_codigo: string
    cuenta_nombre: string
    debe: string
    haber: string
    cliente_id: number | null
    proveedor_id: number | null
    impuesto_codigo: string | null
    cuadricula: string | null
}

export interface AsientoRegistrado {
    id: number
    empresa_id: number
    fecha: string
    descripcion: string
    origen_tipo: OrigenAsiento
    origen_id: number | null
    reversa_de: number | null
    /** diario y número guardados al registrar (`ledger.asientos_numeros`) */
    diario: string
    numero: number
    created_by: number | null
    total: string
    movimientos: MovimientoRegistrado[]
}

interface FilaCuenta {
    id: number
    codigo: string
    nombre: string
    activa: boolean
    imputable: boolean
    auxiliar_cliente: boolean
    auxiliar_proveedor: boolean
    /** subcuenta de una empresa (caja, cuenta bancaria); null = común */
    empresa_id: number | null
}

interface LineaNormalizada {
    cuenta: FilaCuenta
    debe: Dec
    haber: Dec
    cliente_id: number | null
    proveedor_id: number | null
    impuesto_codigo: string | null
    cuadricula: string | null
}

export default class RegistrarAsiento extends DomainAction<EntradaAsiento, AsientoRegistrado> {
    readonly nombre = 'libro.registrar_asiento'

    protected async handle(input: EntradaAsiento, t: Transaccion): Promise<AsientoRegistrado> {
        const fecha = input.fecha ? fechaValida(input.fecha) : hoyGuatemala()
        const descripcion = input.descripcion?.trim()
        if (!descripcion) {
            throw new ValidacionFallida([{ field: 'descripcion', message: 'La descripción es obligatoria' }])
        }
        if (!(ORIGENES_ASIENTO as readonly string[]).includes(input.origen_tipo)) {
            throw new ValidacionFallida([{ field: 'origen_tipo', message: 'Origen inválido' }])
        }
        const origenId = input.origen_id ?? null
        if (input.origen_tipo !== 'ajuste' && origenId === null) {
            throw new ValidacionFallida([
                { field: 'origen_id', message: `origen_id es obligatorio para origen ${input.origen_tipo}` },
            ])
        }

        const empresaId = input.empresa_id ?? (await resolverEmpresaActiva(t.ctx, t.trx))
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const lineas = await this.normalizarLineas(t.trx, input.movimientos ?? [], empresaId)
        const total = this.validarCuadre(lineas)
        await this.verificarPeriodoAbierto(t.trx, fecha, empresaId)

        // Deferred al insertar (el asiento existe antes que sus movimientos) …
        await t.trx.rawQuery('SET CONSTRAINTS ledger.asientos_cuadre, ledger.movimientos_cuadre DEFERRED')

        const [asiento] = (await t.trx
            .insertQuery()
            .table('ledger.asientos')
            .insert({
                empresa_id: empresaId,
                fecha,
                descripcion,
                origen_tipo: input.origen_tipo,
                origen_id: origenId,
                reversa_de: input.reversa_de ?? null,
                created_by: usuarioDelActor(t.ctx.actor),
            })
            .returning(['id', 'created_by'])) as Array<{ id: number; created_by: number | null }>

        const filas = (await t.trx
            .insertQuery()
            .table('ledger.movimientos')
            .multiInsert(
                lineas.map((linea) => ({
                    asiento_id: asiento!.id,
                    cuenta_id: linea.cuenta.id,
                    debe: linea.debe.toFixed(2),
                    haber: linea.haber.toFixed(2),
                    cliente_id: linea.cliente_id,
                    proveedor_id: linea.proveedor_id,
                    impuesto_codigo: linea.impuesto_codigo,
                    cuadricula: linea.cuadricula,
                })),
            )
            .returning([
                'id',
                'cuenta_id',
                'debe',
                'haber',
                'cliente_id',
                'proveedor_id',
                'impuesto_codigo',
                'cuadricula',
            ])) as Array<{
            id: number
            cuenta_id: number
            debe: string
            haber: string
            cliente_id: number | null
            proveedor_id: number | null
            impuesto_codigo: string | null
            cuadricula: string | null
        }>

        // … e inmediato al terminar: el cuadre se verifica aquí y el error sale de esta acción.
        await t.trx.rawQuery('SET CONSTRAINTS ledger.asientos_cuadre, ledger.movimientos_cuadre IMMEDIATE')
        await t.trx.rawQuery('SET CONSTRAINTS ledger.asientos_cuadre, ledger.movimientos_cuadre DEFERRED')

        t.fijarEntidad('asiento', asiento!.id)

        const diario = await diarioDeAsiento(
            t.trx,
            empresaId,
            input.origen_tipo,
            lineas.map((l) => l.cuenta.id),
            input.diario,
        )
        const numero = await numerarAsiento(t.trx, asiento!.id, empresaId, fecha, diario)

        const porId = new Map(lineas.map((l) => [l.cuenta.id, l.cuenta]))
        return {
            id: asiento!.id,
            empresa_id: empresaId,
            fecha,
            descripcion,
            origen_tipo: input.origen_tipo,
            origen_id: origenId,
            reversa_de: input.reversa_de ?? null,
            diario: diario.codigo,
            numero,
            created_by: asiento!.created_by,
            total: aTexto(total),
            movimientos: filas
                .sort((a, b) => a.id - b.id)
                .map((fila) => ({
                    id: fila.id,
                    cuenta_id: fila.cuenta_id,
                    cuenta_codigo: porId.get(fila.cuenta_id)!.codigo,
                    cuenta_nombre: porId.get(fila.cuenta_id)!.nombre,
                    debe: fila.debe,
                    haber: fila.haber,
                    cliente_id: fila.cliente_id,
                    proveedor_id: fila.proveedor_id === null ? null : Number(fila.proveedor_id),
                    impuesto_codigo: fila.impuesto_codigo,
                    cuadricula: fila.cuadricula,
                })),
        }
    }

    /**
     * Debe = Haber, en decimal exacto. Protegido para que las pruebas puedan saltarla y demostrar
     * que la base de datos también lo rechaza.
     */
    protected validarCuadre(lineas: LineaNormalizada[]): Dec {
        let debe = CERO
        let haber = CERO
        for (const linea of lineas) {
            debe = debe.plus(linea.debe)
            haber = haber.plus(linea.haber)
        }
        if (!debe.equals(haber)) {
            throw new ReglaNegocio(
                `Asiento descuadrado: debe ${aTexto(debe)} <> haber ${aTexto(haber)}`,
                'asiento_descuadrado',
            )
        }
        return debe
    }

    private async normalizarLineas(
        trx: TransactionClientContract,
        movimientos: LineaAsiento[],
        empresaId: number,
    ): Promise<LineaNormalizada[]> {
        if (movimientos.length < 2) {
            throw new ReglaNegocio('Un asiento necesita al menos 2 movimientos', 'asiento_descuadrado')
        }

        const codigos = movimientos.map((m) => m.cuenta).filter((c): c is string => typeof c === 'string')
        const ids = movimientos.map((m) => m.cuenta).filter((c): c is number => typeof c === 'number')
        const cuentas = (await trx
            .from('ledger.cuentas')
            .where((q) => {
                q.where((c) =>
                    c.where('pais', PAIS_PLAN).whereIn('codigo', codigos.length > 0 ? codigos : ['']),
                )
                q.orWhereIn('id', ids.length > 0 ? ids : [0])
            })
            .select(
                'id',
                'codigo',
                'nombre',
                'activa',
                'imputable',
                'auxiliar_cliente',
                'auxiliar_proveedor',
                'empresa_id',
            )) as FilaCuenta[]
        const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]))
        const porId = new Map(cuentas.map((c) => [c.id, c]))

        const errores: ErrorCampo[] = []
        const lineas: LineaNormalizada[] = []
        movimientos.forEach((movimiento, i) => {
            const campo = `movimientos.${i}`
            const cuenta =
                typeof movimiento.cuenta === 'string'
                    ? porCodigo.get(movimiento.cuenta)
                    : porId.get(movimiento.cuenta)
            if (!cuenta) {
                errores.push({
                    field: `${campo}.cuenta`,
                    message: `La cuenta ${movimiento.cuenta} no existe`,
                })
                return
            }
            if (!cuenta.activa) {
                errores.push({
                    field: `${campo}.cuenta`,
                    message: `La cuenta ${cuenta.codigo} está inactiva`,
                })
            }
            if (!cuenta.imputable) {
                errores.push({
                    field: `${campo}.cuenta`,
                    message: `La cuenta ${cuenta.codigo} es de agrupación y no recibe movimientos`,
                })
            }
            if (cuenta.empresa_id !== null && Number(cuenta.empresa_id) !== empresaId) {
                errores.push({
                    field: `${campo}.cuenta`,
                    message: `La cuenta ${cuenta.codigo} es de la empresa ${cuenta.empresa_id}: un asiento no mezcla empresas`,
                    rule: 'cuenta_de_otra_empresa',
                })
            }
            const clienteId = movimiento.cliente_id ?? null
            if (cuenta.auxiliar_cliente && clienteId === null) {
                errores.push({
                    field: `${campo}.cliente_id`,
                    message: `La cuenta ${cuenta.codigo} lleva auxiliar por cliente: falta cliente_id`,
                })
            }

            const proveedorId = movimiento.proveedor_id ?? null
            if (cuenta.auxiliar_proveedor && proveedorId === null) {
                errores.push({
                    field: `${campo}.proveedor_id`,
                    message: `La cuenta ${cuenta.codigo} lleva auxiliar por proveedor: falta proveedor_id`,
                    rule: 'movimiento_proveedor',
                })
            }

            let debe: Dec
            let haber: Dec
            try {
                debe = dec(movimiento.debe)
                haber = dec(movimiento.haber)
            } catch {
                errores.push({ field: campo, message: 'Monto inválido' })
                return
            }
            if (debe.isNegative() || haber.isNegative()) {
                errores.push({ field: campo, message: 'Los montos no pueden ser negativos' })
            } else if (debe.isZero() === haber.isZero()) {
                errores.push({
                    field: campo,
                    message: 'Cada movimiento lleva exactamente uno de debe o haber',
                })
            }
            if (!tieneCentavosExactos(debe) || !tieneCentavosExactos(haber)) {
                errores.push({
                    field: campo,
                    message: 'Los montos se redondean a 2 decimales antes del asiento',
                })
            }
            const impuesto = movimiento.impuesto_codigo?.trim() || null
            const cuadricula = movimiento.cuadricula?.trim() || null
            if ((impuesto === null) !== (cuadricula === null)) {
                errores.push({
                    field: `${campo}.${impuesto === null ? 'impuesto_codigo' : 'cuadricula'}`,
                    message: 'impuesto_codigo y cuadricula van juntos',
                    rule: 'cuadricula',
                })
            }
            lineas.push({
                cuenta,
                debe,
                haber,
                cliente_id: clienteId,
                proveedor_id: proveedorId,
                impuesto_codigo: impuesto,
                cuadricula,
            })
        })

        await this.validarProveedores(trx, lineas, empresaId, errores)
        await this.validarCuadriculas(trx, lineas, errores)
        if (errores.length > 0) throw new ValidacionFallida(errores, 'Movimientos inválidos')
        return lineas
    }

    /** El proveedor del auxiliar es de la empresa del asiento (también por trigger). */
    private async validarProveedores(
        trx: TransactionClientContract,
        lineas: LineaNormalizada[],
        empresaId: number,
        errores: ErrorCampo[],
    ) {
        const ids = [...new Set(lineas.map((l) => l.proveedor_id).filter((p): p is number => p !== null))]
        if (ids.length === 0) return
        const filas = (await trx
            .from('ledger.proveedores')
            .whereIn('id', ids)
            .select('id', 'empresa_id')) as Array<{ id: number; empresa_id: number }>
        const empresaDe = new Map(filas.map((f) => [Number(f.id), Number(f.empresa_id)]))
        lineas.forEach((linea, i) => {
            if (linea.proveedor_id === null) return
            const empresa = empresaDe.get(linea.proveedor_id)
            if (empresa === undefined) {
                errores.push({
                    field: `movimientos.${i}.proveedor_id`,
                    message: `El proveedor ${linea.proveedor_id} no existe`,
                    rule: 'exists',
                })
            } else if (empresa !== empresaId) {
                errores.push({
                    field: `movimientos.${i}.proveedor_id`,
                    message: `El proveedor ${linea.proveedor_id} es de la empresa ${empresa}: un asiento no mezcla empresas`,
                    rule: 'proveedor_de_otra_empresa',
                })
            }
        })
    }

    /** El impuesto existe en `fiscal.impuestos` y la cuadrícula es una del paquete, con signo (`+V_IVA`). */
    private async validarCuadriculas(
        trx: TransactionClientContract,
        lineas: LineaNormalizada[],
        errores: ErrorCampo[],
    ) {
        const codigos = [
            ...new Set(lineas.map((l) => l.impuesto_codigo).filter((c): c is string => c !== null)),
        ]
        if (codigos.length === 0) return
        const filas = (await trx
            .from('fiscal.impuestos')
            .where('pais', PAIS_PLAN)
            .whereIn('codigo', codigos)
            .select('codigo')) as Array<{ codigo: string }>
        const existentes = new Set(filas.map((f) => f.codigo))
        const cuadriculas = new Set<string>(CUADRICULAS_GT)
        lineas.forEach((linea, i) => {
            if (linea.impuesto_codigo === null || linea.cuadricula === null) return
            if (!existentes.has(linea.impuesto_codigo)) {
                errores.push({
                    field: `movimientos.${i}.impuesto_codigo`,
                    message: `El impuesto ${linea.impuesto_codigo} no existe`,
                    rule: 'exists',
                })
            }
            // con signo: +V_IVA suma a la casilla y -V_IVA resta (contrato §10.2)
            const signo = linea.cuadricula[0]
            if ((signo !== '+' && signo !== '-') || !cuadriculas.has(linea.cuadricula.slice(1))) {
                errores.push({
                    field: `movimientos.${i}.cuadricula`,
                    message: `Cuadrícula inválida: ${linea.cuadricula} (signo + o - y una de ${[...cuadriculas].join(', ')})`,
                    rule: 'cuadricula',
                })
            }
        })
    }

    private async verificarPeriodoAbierto(trx: TransactionClientContract, fecha: string, empresaId: number) {
        const periodo = inicioDeMes(fecha)
        // misma regla que los triggers: hay un cierre del mes (de esta empresa) sin reapertura
        if (await periodoCerrado(trx, fecha, empresaId)) {
            throw new ReglaNegocio(
                `Periodo ${periodo.slice(0, 7)} cerrado: no se registran asientos con fecha ${fecha}`,
                'periodo_cerrado',
            )
        }
    }
}
