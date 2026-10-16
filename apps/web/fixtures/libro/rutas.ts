import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, datosInvalidos, noEncontrado, numeroQuery, paginar } from '../comun'

type Cuenta = Schema<'Cuenta'>
type LineaMayor = Schema<'LineaMayor'>

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const ORIGENES = ['factura', 'pago', 'mora', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste']

/** Saldo según la naturaleza de la cuenta, como `saldoSegunNaturaleza` de la API. */
function saldoNatural(cuenta: Cuenta, debe: string, haber: string): Decimal {
    const neto = new Decimal(debe).minus(haber)
    return cuenta.tipo === 'activo' || cuenta.tipo === 'gasto' ? neto : neto.negated()
}

function fechaValida(valor: string | null): boolean {
    return valor === null || valor === '' || FECHA.test(valor)
}

export const rutasLibro: RutasFixture = {
    'GET /api/v1/libro/cuentas': conPermiso('libro.ver', () => ({
        status: 200,
        cuerpo: [...bd.cuentas].sort((a, b) => a.codigo.localeCompare(b.codigo)),
    })),

    'GET /api/v1/libro/diario': conPermiso('libro.ver', (solicitud) => {
        const desde = solicitud.query.get('desde')
        const hasta = solicitud.query.get('hasta')
        const origen = solicitud.query.get('origen_tipo')
        const errores = []
        if (!fechaValida(desde)) {
            errores.push({ field: 'desde', message: 'Fecha inválida (AAAA-MM-DD)', rule: 'regex' })
        }
        if (!fechaValida(hasta)) {
            errores.push({ field: 'hasta', message: 'Fecha inválida (AAAA-MM-DD)', rule: 'regex' })
        }
        if (origen && !ORIGENES.includes(origen)) {
            errores.push({ field: 'origen_tipo', message: 'Origen inválido', rule: 'enum' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        // Como `libroDiario`: id descendente (lo más reciente primero).
        const filas = bd.asientos
            .filter(a => !desde || a.fecha >= desde)
            .filter(a => !hasta || a.fecha <= hasta)
            .filter(a => !origen || a.origen_tipo === origen)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/libro/mayor': conPermiso('libro.ver', (solicitud) => {
        const cuentaId = numeroQuery(solicitud, 'cuenta_id')
        const clienteId = numeroQuery(solicitud, 'cliente_id')
        const desde = solicitud.query.get('desde')
        const hasta = solicitud.query.get('hasta')
        if (cuentaId === undefined) {
            return datosInvalidos([{ field: 'cuenta_id', message: 'La cuenta es obligatoria', rule: 'required' }])
        }
        const cuenta = bd.cuentas.find(c => c.id === cuentaId)
        if (!cuenta) {
            return noEncontrado('la cuenta')
        }
        const lineas = bd.asientos
            .filter(a => !hasta || a.fecha <= hasta)
            .flatMap(a => a.movimientos
                .filter(m => m.cuenta_id === cuentaId && (clienteId === undefined || m.cliente_id === clienteId))
                .map(m => ({ asiento: a, movimiento: m })))
            .sort((x, y) => x.movimiento.id - y.movimiento.id)
        let saldoInicial = new Decimal(0)
        let acumulado = new Decimal(0)
        const enRango: LineaMayor[] = []
        for (const { asiento, movimiento } of lineas) {
            const efecto = saldoNatural(cuenta, movimiento.debe, movimiento.haber)
            if (desde && asiento.fecha < desde) {
                saldoInicial = saldoInicial.plus(efecto)
                continue
            }
            acumulado = acumulado.plus(efecto)
            enRango.push({
                movimiento_id: movimiento.id,
                asiento_id: asiento.id,
                fecha: asiento.fecha,
                descripcion: asiento.descripcion,
                debe: movimiento.debe,
                haber: movimiento.haber,
                saldo: saldoInicial.plus(acumulado).toFixed(2),
                cliente_id: movimiento.cliente_id,
            })
        }
        const pagina = paginar(enRango, solicitud)
        return {
            status: 200,
            cuerpo: {
                cuenta,
                saldo_inicial: saldoInicial.toFixed(2),
                saldo_final: saldoInicial.plus(acumulado).toFixed(2),
                ...pagina,
            },
        }
    }),
}
