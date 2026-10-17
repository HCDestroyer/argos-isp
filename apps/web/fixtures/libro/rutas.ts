import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, numeroQuery, paginar, registrarAccion, usuariosPorToken } from '../comun'
import { asientoReverso, bancosLibro } from './datos'

type Cuenta = Schema<'Cuenta'>
type LineaMayor = Schema<'LineaMayor'>

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const ORIGENES = ['factura', 'pago', 'mora', 'nota_credito', 'egreso', 'cierre_caja', 'ajuste']

/** Como `bloqueoReversoDirecto` (A3, `ledger/reversos.ts`): los asientos con documento se corrigen anulándolo. */
const POR_DOCUMENTO: Record<string, string> = {
    factura: 'la factura (POST /facturas/:id/anular)',
    mora: 'la factura de mora (POST /facturas/:id/anular)',
    pago: 'el pago (POST /pagos/:id/anular)',
    nota_credito: 'la nota de crédito (emitiendo un cargo o anulando la factura)',
    egreso: 'el egreso (POST /egresos/:id/anular)',
}

/** Como `conReverso` de `ledger/consultas.ts`: `revertido_por`, `revertible` y `motivo_no_revertible`. */
export function vistaAsiento(asiento: Schema<'Asiento'>): Schema<'Asiento'> {
    const revertidoPor = bd.asientos.find(a => a.reversa_de === asiento.id)?.id ?? null
    const documento = POR_DOCUMENTO[asiento.origen_tipo]
    let bloqueo: string | null = null
    if (asiento.reversa_de !== null) {
        bloqueo = 'Es un reverso'
    }
    else if (revertidoPor !== null) {
        bloqueo = `Revertido por el asiento ${revertidoPor}`
    }
    else if (documento) {
        bloqueo = `El asiento ${asiento.id} es de origen ${asiento.origen_tipo} ${asiento.origen_id ?? ''}`.trimEnd() + `: no se revierte directo; anula ${documento}`
    }
    else if (asiento.origen_tipo === 'ajuste' && asiento.origen_id !== null) {
        bloqueo = `El asiento ${asiento.id} es del saldo inicial ${asiento.origen_id}: no se revierte directo; anula el saldo inicial`
    }
    return { ...asiento, revertido_por: revertidoPor, revertible: bloqueo === null, motivo_no_revertible: bloqueo }
}

/** Saldo según la naturaleza de la cuenta, como `saldoSegunNaturaleza` de la API. */
function saldoNatural(cuenta: Cuenta, debe: string, haber: string): Decimal {
    const neto = new Decimal(debe).minus(haber)
    return cuenta.tipo === 'activo' || cuenta.tipo === 'gasto' ? neto : neto.negated()
}

function fechaValida(valor: string | null): boolean {
    return valor === null || valor === '' || FECHA.test(valor)
}

export const rutasLibro: RutasFixture = {
    /** Como `GET /libro/bancos` (A3, `egresos.ver`). */
    'GET /api/v1/libro/bancos': conPermiso('egresos.ver', () => ({ status: 200, cuerpo: bancosLibro })),

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
            .map(vistaAsiento)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'GET /api/v1/libro/asientos/:id': conPermiso('libro.ver', (solicitud) => {
        const asiento = bd.asientos.find(a => a.id === idDe(solicitud))
        return asiento ? { status: 200, cuerpo: vistaAsiento(asiento) } : noEncontrado('el asiento')
    }),

    /** Como `RevertirAsiento` (A3): motivo 3..500; 422 `reverso_por_documento`, `asiento_revertido`, `asiento_es_reverso`. */
    'POST /api/v1/libro/asientos/:id/revertir': conPermiso('libro.revertir_asiento', conIdempotencia((solicitud) => {
        const original = bd.asientos.find(a => a.id === idDe(solicitud))
        if (!original) {
            return noEncontrado('el asiento')
        }
        const { motivo } = cuerpoObjeto(solicitud)
        const texto = typeof motivo === 'string' ? motivo.trim() : ''
        if (texto.length < 3 || texto.length > 500) {
            return datosInvalidos([{ field: 'motivo', message: 'El motivo debe tener entre 3 y 500 caracteres', rule: 'minLength' }])
        }
        const vista = vistaAsiento(original)
        if (!vista.revertible) {
            const codigo = original.reversa_de !== null ? 'asiento_es_reverso' : vista.revertido_por !== null ? 'asiento_revertido' : 'reverso_por_documento'
            const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title: 'Regla de negocio', status: 422, detail: vista.motivo_no_revertible ?? 'No se puede revertir' }
            return { status: 422, cuerpo }
        }
        const momento = new Date().toISOString()
        const usuario = solicitud.token ? (usuariosPorToken[solicitud.token]?.id ?? null) : null
        const reverso = asientoReverso(siguienteId(bd.asientos), original, `Reverso del asiento ${original.id}: ${texto}`, momento, usuario)
        bd.asientos.push(reverso)
        registrarAccion(solicitud, 'libro.revertir_asiento', { tipo: 'asiento', id: original.id }, { motivo: texto })
        return { status: 201, cuerpo: vistaAsiento(reverso) }
    })),

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
            // Como la API: por fecha contable y luego por asiento (un asiento con fecha anterior
            // registrado después, como una nota de crédito sembrada, va en su fecha).
            .sort((x, y) => x.asiento.fecha.localeCompare(y.asiento.fecha) || x.asiento.id - y.asiento.id || x.movimiento.id - y.movimiento.id)
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
