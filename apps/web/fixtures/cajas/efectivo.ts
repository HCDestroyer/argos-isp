/**
 * Cajas y efectivo (B1 y B9 del plan de contabilidad, §5.7; tablero PlanCajas): entregas de las
 * cajas de cobros a la custodia, custodia por persona, depósitos desde la custodia y la caja chica
 * (gasto con comprobante, reposición y conteo). Mismas reglas y códigos de error que
 * `ledger/custodia.ts`, `ledger/caja_chica.ts` y sus acciones (A3).
 */
import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import type { BaseFixtures } from '../bd'
import { categoriasEgreso } from '../egresos/datos'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, empresaActivaDe, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'

type Entrega = Schema<'EntregaCaja'>
type Egreso = Schema<'Egreso'>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/

/** La caja chica de la semilla: «Caja chica Central», de la empresa 1, con Ana como encargada. */
export const CAJA_CHICA_ID = 5
const CUENTA_CAJA_CHICA_ID = 95

export interface EfectivoFixtures {
    entregas: Entrega[]
    reposiciones: Schema<'ReposicionCaja'>[]
    conteos: Schema<'ConteoCaja'>[]
    ajustes: Schema<'AjustesCajas'>[]
}

const AJUSTES_FABRICA: Omit<Schema<'AjustesCajas'>, 'empresa_id'> = {
    fondo_cobros: '200.00',
    custodia_plazo_dias: 1,
    custodia_tope: '5000.00',
    autoentrega: true,
    fondo_caja_chica: '2000.00',
    de_fabrica: true,
    version: 0,
    updated_at: null,
}

function dia(desplazamiento: number, hora = '15:00:00'): string {
    const fecha = new Date(Date.now() + desplazamiento * 86_400_000)
    return `${fecha.toISOString().slice(0, 10)}T${hora}.000Z`
}

function entrega(id: number, cajaId: number, cajaNombre: string, monto: string, estado: Entrega['estado'], creada: string): Entrega {
    return {
        id,
        empresa_id: 1,
        caja_id: cajaId,
        caja_nombre: cajaNombre,
        turno_id: 30 + id,
        monto,
        entregado_por: 2,
        entregado_por_nombre: 'Carlos Cajero',
        recibe_id: 1,
        recibe_nombre: 'Ana Administradora',
        autoentrega: false,
        origen: 'cierre',
        estado,
        recibido_por: estado === 'recibida' ? 1 : null,
        recibido_en: estado === 'recibida' ? creada.replace('T15', 'T16') : null,
        contado: estado === 'recibida' ? monto : null,
        diferencia: estado === 'recibida' ? '0.00' : null,
        motivo: null,
        created_at: creada,
    }
}

function gasto(id: number, categoria: Egreso['categoria'], nombre: string, codigo: string, descripcion: string, monto: string, creado: string): Egreso {
    return {
        empresa_id: 1,
        id,
        fecha: creado.slice(0, 10),
        categoria,
        categoria_nombre: nombre,
        cuenta_codigo: codigo,
        proveedor: null,
        descripcion,
        comprobante: null,
        monto,
        metodo: 'caja',
        caja_id: CAJA_CHICA_ID,
        caja_nombre: 'Caja chica Central',
        turno_id: null,
        banco_id: null,
        banco_nombre: null,
        cuenta_bancaria_id: null,
        cuenta_bancaria_nombre: null,
        asiento_id: null,
        compra_id: null,
        estado: 'registrado',
        registrado_por: 1,
        registrado_por_nombre: 'Ana Administradora',
        anulado_en: null,
        anulado_por: null,
        motivo_anulacion: null,
        asiento_reverso_id: null,
        con_comprobante: true,
        reposicion_id: null,
        version: 1,
        created_at: creado,
        updated_at: creado,
    }
}

/** Siembra la caja chica, sus gastos sin reponer y las entregas a la custodia. */
export function sembrarEfectivo(datos: BaseFixtures): void {
    const momento = dia(-30)
    datos.cuentas.push({
        id: CUENTA_CAJA_CHICA_ID,
        codigo: '1.1.01.05',
        nombre: 'Caja · Caja chica Central',
        tipo: 'activo',
        padre_id: datos.cuentas.find(c => c.codigo === '1.1.01')?.id ?? null,
        imputable: true,
        auxiliar_cliente: false,
        empresa_id: 1,
        activa: true,
        version: 1,
        created_at: momento,
        updated_at: momento,
    })
    for (const caja of datos.cajas) {
        caja.tipo ??= 'cobros'
        caja.fiscal ??= true
    }
    datos.cajas.push({
        id: CAJA_CHICA_ID,
        empresa_id: 1,
        nombre: 'Caja chica Central',
        cajero_id: 1,
        cajero_nombre: 'Ana Administradora',
        cuenta_id: CUENTA_CAJA_CHICA_ID,
        activa: true,
        turno_abierto_id: null,
        turno_abierto_por: null,
        turno_abierto_por_nombre: null,
        tipo: 'gastos',
        fondo_fijo: null,
        fiscal: true,
        usuarios: [],
        aviso_sin_factura: null,
        fondo_fijo_efectivo: '2000.00',
        version: 1,
        created_at: momento,
        updated_at: momento,
    })
    const primero = siguienteId(datos.egresos)
    datos.egresos.push(
        gasto(primero + 4, 'vehiculos', 'Vehículos', '5.2.04', 'Combustible moto 2', '150.00', dia(0, '15:12:00')),
        gasto(primero + 3, 'otros', 'Otros', '5.2.99', 'Cinchos y grapas', '85.00', dia(-1, '17:40:00')),
        gasto(primero + 2, 'vehiculos', 'Vehículos', '5.2.04', 'Parqueo visita técnica', '25.00', dia(-1, '16:05:00')),
        gasto(primero + 1, 'otros', 'Otros', '5.2.99', 'Almuerzo cuadrilla (turno extra)', '260.00', dia(-3, '19:30:00')),
        gasto(primero, 'transito', 'Tránsito', '5.2.02', 'Paso por terreno · Finca El Roble', '300.00', dia(-4, '18:00:00')),
    )
    datos.efectivo = {
        entregas: [
            entrega(31, 1, 'Caja Central', '2850.00', 'por_recibir', dia(0, '00:04:00')),
            entrega(30, 3, 'Caja Mixco', '2050.00', 'recibida', dia(-1)),
        ],
        reposiciones: [{
            id: 6,
            empresa_id: 1,
            caja_id: CAJA_CHICA_ID,
            caja_nombre: 'Caja chica Central',
            origen: 'banco',
            custodio_id: null,
            custodio_nombre: null,
            banco_id: null,
            cuenta_bancaria_id: 1,
            cuenta_codigo: '1.1.02.01',
            referencia: 'cheque 1042',
            monto: '1640.00',
            fondo: '2000.00',
            efectivo_antes: '360.00',
            fecha: dia(-5).slice(0, 10),
            gastos: 9,
            conteos: 0,
            asiento_id: null,
            registrado_por: 1,
            registrado_por_nombre: 'Ana Administradora',
            created_at: dia(-5),
        }],
        conteos: [{
            id: 1,
            empresa_id: 1,
            caja_id: CAJA_CHICA_ID,
            esperado: '2000.00',
            contado: '2000.00',
            diferencia: '0.00',
            comprobantes: '0.00',
            fondo: '2000.00',
            motivo: null,
            responsable_id: 1,
            responsable_nombre: 'Ana Administradora',
            contado_por: 1,
            contado_por_nombre: 'Ana Administradora',
            fecha: dia(-5).slice(0, 10),
            asiento_id: null,
            repuesto: true,
            created_at: dia(-5, '17:00:00'),
        }],
        ajustes: [],
    }
}

function ajustesDe(empresaId: number): Schema<'AjustesCajas'> {
    return bd.efectivo.ajustes.find(a => a.empresa_id === empresaId) ?? { ...AJUSTES_FABRICA, empresa_id: empresaId }
}

function usuarioDe(solicitud: SolicitudFixture): Schema<'Me'> | undefined {
    return solicitud.token ? usuariosPorToken[solicitud.token] : undefined
}

function veTodaLaCustodia(solicitud: SolicitudFixture): boolean {
    return usuarioDe(solicitud)?.permisos.includes('cajas.ver_custodia') ?? false
}

/** Saldo de la custodia de una persona: recibido − depositado − repuesto a cajas chicas. */
function saldoCustodia(empresaId: number, usuarioId: number): Decimal {
    const recibido = bd.efectivo.entregas
        .filter(e => e.empresa_id === empresaId && e.estado === 'recibida' && e.recibe_id === usuarioId)
        .reduce((suma, e) => suma.plus(e.contado ?? e.monto), new Decimal(0))
    const depositado = bd.depositos
        .filter(d => d.empresa_id === empresaId && d.origen === 'custodia' && d.custodio_id === usuarioId)
        .reduce((suma, d) => suma.plus(d.monto), new Decimal(0))
    return bd.efectivo.reposiciones
        .filter(r => r.empresa_id === empresaId && r.origen === 'custodia' && r.custodio_id === usuarioId)
        .reduce((suma, r) => suma.minus(r.monto), recibido.minus(depositado))
}

function sumar(filas: readonly Entrega[]): { cantidad: number, monto: string } {
    return { cantidad: filas.length, monto: filas.reduce((suma, e) => suma.plus(e.monto), new Decimal(0)).toFixed(2) }
}

function custodiaDe(empresaId: number, solicitud: SolicitudFixture): Schema<'CustodiaEfectivo'> {
    const ajustes = ajustesDe(empresaId)
    const yo = usuarioDe(solicitud)?.id ?? 0
    const todas = veTodaLaCustodia(solicitud)
    const entregas = bd.efectivo.entregas.filter(e => e.empresa_id === empresaId)
    const ids = [...new Set(entregas.map(e => e.recibe_id))].filter(id => todas || id === yo)
    const hoy = ahora().slice(0, 10)
    const personas = ids.map((usuarioId) => {
        const saldo = saldoCustodia(empresaId, usuarioId)
        const recibidas = entregas.filter(e => e.recibe_id === usuarioId && e.estado === 'recibida').map(e => (e.recibido_en ?? e.created_at).slice(0, 10)).sort()
        const desde = saldo.gt(0) ? (recibidas.at(-1) ?? null) : null
        const vence = desde ? new Date(Date.parse(`${desde}T12:00:00Z`) + ajustes.custodia_plazo_dias * 86_400_000).toISOString().slice(0, 10) : null
        return {
            empresa_id: empresaId,
            usuario_id: usuarioId,
            usuario_nombre: bd.usuarios.find(u => u.id === usuarioId)?.nombre ?? null,
            saldo: saldo.toFixed(2),
            desde,
            vence,
            fuera_de_plazo: vence !== null && vence < hoy,
            sobre_tope: saldo.gt(ajustes.custodia_tope),
            por_recibir: sumar(entregas.filter(e => e.recibe_id === usuarioId && e.estado === 'por_recibir')),
        }
    })
    const total = ids.reduce((suma, id) => suma.plus(saldoCustodia(empresaId, id)), new Decimal(0))
    const porRecibir = entregas.filter(e => e.estado === 'por_recibir' && (todas || e.recibe_id === yo || e.entregado_por === yo))
    return { empresa_id: empresaId, ajustes, total: total.toFixed(2), por_recibir: sumar(porRecibir), personas }
}

/** `EstadoCajaChica` como `estadoCajaChica` (A3): efectivo + comprobantes − diferencias = fondo vigente. */
export function estadoCajaChica(caja: Schema<'Caja'>): Schema<'EstadoCajaChica'> {
    const empresaId = caja.empresa_id ?? 1
    const fondoFijo = new Decimal(caja.fondo_fijo ?? ajustesDe(empresaId).fondo_caja_chica)
    const reposiciones = bd.efectivo.reposiciones.filter(r => r.caja_id === caja.id).sort((a, b) => b.id - a.id)
    const fondoVigente = new Decimal(reposiciones[0]?.fondo ?? '0')
    const gastos = bd.egresos.filter(e => e.caja_id === caja.id && e.estado === 'registrado' && !e.reposicion_id)
    const comprobantes = gastos.reduce((suma, e) => suma.plus(e.monto), new Decimal(0))
    const conteos = bd.efectivo.conteos.filter(c => c.caja_id === caja.id).sort((a, b) => b.id - a.id)
    const pendientes = conteos.filter(c => !c.repuesto)
    const diferencias = pendientes.reduce((suma, c) => suma.plus(c.diferencia), new Decimal(0))
    const efectivo = fondoVigente.minus(comprobantes).plus(diferencias)
    return {
        caja_id: caja.id,
        empresa_id: empresaId,
        nombre: caja.nombre,
        encargado_id: caja.cajero_id,
        encargado_nombre: caja.cajero_nombre ?? null,
        fondo_fijo: fondoFijo.toFixed(2),
        fondo_vigente: fondoVigente.toFixed(2),
        efectivo: efectivo.toFixed(2),
        comprobantes: { cantidad: gastos.length, monto: comprobantes.toFixed(2), sin_archivo: gastos.filter(g => g.con_comprobante === false).length },
        diferencias: { cantidad: pendientes.length, monto: diferencias.toFixed(2) },
        cuadra: efectivo.plus(comprobantes).minus(diferencias).equals(fondoVigente),
        por_reponer: Decimal.max(fondoFijo.minus(efectivo), 0).toFixed(2),
        porcentaje: fondoFijo.isZero() ? 0 : efectivo.div(fondoFijo).times(100).floor().toNumber(),
        ultima_reposicion: reposiciones[0] ? { id: reposiciones[0].id, fecha: reposiciones[0].fecha, monto: reposiciones[0].monto } : null,
        ultimo_conteo: conteos[0] ? { id: conteos[0].id, fecha: conteos[0].fecha, diferencia: conteos[0].diferencia } : null,
    }
}

function cajaChicaDe(solicitud: SolicitudFixture): Schema<'Caja'> | RespuestaFixture {
    const caja = bd.cajas.find(c => c.id === idDe(solicitud))
    if (!caja) {
        return noEncontrado('la caja')
    }
    if (caja.tipo !== 'gastos') {
        return problemaTipado(422, 'no_es_caja_chica', 'No es una caja chica', `La caja ${caja.id} es de cobros`)
    }
    return caja
}

function esRespuesta(valor: Schema<'Caja'> | RespuestaFixture): valor is RespuestaFixture {
    return 'status' in valor
}

function entregaPropia(solicitud: SolicitudFixture): Entrega | RespuestaFixture {
    const encontrada = bd.efectivo.entregas.find(e => e.id === idDe(solicitud))
    if (!encontrada) {
        return noEncontrado('la entrega')
    }
    if (encontrada.recibe_id !== usuarioDe(solicitud)?.id) {
        return problemaTipado(403, 'entrega_ajena', 'La entrega no es para ti', `La entrega ${encontrada.id} la recibe ${encontrada.recibe_nombre ?? 'otra persona'}`)
    }
    if (encontrada.estado !== 'por_recibir') {
        return problemaTipado(409, 'entrega_no_pendiente', 'Entrega ya resuelta', `La entrega ${encontrada.id} ya está ${encontrada.estado}`)
    }
    return encontrada
}

function textoMotivo(valor: unknown): string {
    return typeof valor === 'string' ? valor.trim() : ''
}

export const rutasEfectivo: RutasFixture = {
    'GET /api/v1/cajas/ajustes': conPermiso('cajas.ver', solicitud => ({ status: 200, cuerpo: ajustesDe(empresaActivaDe(solicitud) ?? 1) })),

    'GET /api/v1/cajas/custodia': conPermiso('cajas.ver', solicitud => ({ status: 200, cuerpo: custodiaDe(empresaActivaDe(solicitud) ?? 1, solicitud) })),

    'GET /api/v1/cajas/entregas': conPermiso('cajas.ver', (solicitud) => {
        const yo = usuarioDe(solicitud)?.id
        const estado = solicitud.query.get('estado')
        const recibe = Number(solicitud.query.get('recibe_id')) || null
        const empresaId = empresaActivaDe(solicitud) ?? 1
        const filas = bd.efectivo.entregas
            .filter(e => e.empresa_id === empresaId)
            .filter(e => veTodaLaCustodia(solicitud) || e.recibe_id === yo || e.entregado_por === yo)
            .filter(e => !estado || e.estado === estado)
            .filter(e => recibe === null || e.recibe_id === recibe)
            .sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),

    'POST /api/v1/cajas/entregas/:id/recibir': conPermiso('cajas.recibir_entrega', conIdempotencia((solicitud) => {
        const encontrada = entregaPropia(solicitud)
        if ('status' in encontrada) {
            return encontrada
        }
        const fila = encontrada
        const cuerpo = cuerpoObjeto(solicitud)
        const contado = typeof cuerpo.contado === 'string' && cuerpo.contado ? cuerpo.contado : fila.monto
        if (!MONTO.test(contado)) {
            return datosInvalidos([{ field: 'contado', message: 'Monto con hasta 2 decimales, sin comas', rule: 'regex' }])
        }
        const diferencia = new Decimal(contado).minus(fila.monto)
        const motivo = textoMotivo(cuerpo.motivo)
        if (!diferencia.isZero() && motivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'Lo contado no es lo entregado: el motivo es obligatorio', rule: 'requiredWhen' }])
        }
        Object.assign(fila, {
            estado: 'recibida',
            recibido_por: usuarioDe(solicitud)?.id ?? null,
            recibido_en: ahora(),
            contado: new Decimal(contado).toFixed(2),
            diferencia: diferencia.toFixed(2),
            motivo: motivo || null,
        })
        registrarAccion(solicitud, 'cajas.recibir_entrega', { tipo: 'entrega_caja', id: fila.id }, { contado: fila.contado, motivo: fila.motivo })
        return { status: 200, cuerpo: fila }
    })),

    'POST /api/v1/cajas/entregas/:id/rechazar': conPermiso('cajas.rechazar_entrega', conIdempotencia((solicitud) => {
        const encontrada = entregaPropia(solicitud)
        if ('status' in encontrada) {
            return encontrada
        }
        const fila = encontrada
        const motivo = textoMotivo(cuerpoObjeto(solicitud).motivo)
        if (motivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'Escribe por qué no lo recibiste', rule: 'minLength' }])
        }
        Object.assign(fila, { estado: 'rechazada', motivo })
        registrarAccion(solicitud, 'cajas.rechazar_entrega', { tipo: 'entrega_caja', id: fila.id }, { motivo })
        return { status: 200, cuerpo: fila }
    })),

    'POST /api/v1/custodia/depositar': conPermiso('cajas.depositar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const yo = usuarioDe(solicitud)
        const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : (empresaActivaDe(solicitud) ?? 1)
        const errores: NonNullable<Problem['errors']> = []
        if (typeof cuerpo.monto !== 'string' || !MONTO.test(cuerpo.monto) || new Decimal(cuerpo.monto).lte(0)) {
            errores.push({ field: 'monto', message: 'Monto mayor que cero con hasta 2 decimales', rule: 'regex' })
        }
        const boleta = typeof cuerpo.boleta === 'string' ? cuerpo.boleta.trim() : ''
        if (!boleta) {
            errores.push({ field: 'boleta', message: 'El número de boleta es obligatorio', rule: 'required' })
        }
        const cuenta = bd.cuentasBancarias.find(c => c.cuenta_id === cuerpo.cuenta_id)
        if (!cuenta) {
            errores.push({ field: 'cuenta_id', message: 'Elige la cuenta que recibe el depósito', rule: 'exists' })
        }
        if (errores.length || !cuenta || typeof cuerpo.monto !== 'string') {
            return datosInvalidos(errores)
        }
        const saldo = saldoCustodia(empresaId, yo?.id ?? 0)
        if (new Decimal(cuerpo.monto).gt(saldo)) {
            return problemaTipado(422, 'deposito_excede_custodia', 'El depósito supera tu custodia', `Tienes ${saldo.toFixed(2)} en custodia`, [{ field: 'monto', message: `Tienes Q ${saldo.toFixed(2)} en custodia`, rule: 'deposito_excede_custodia' }])
        }
        if (bd.depositos.some(d => d.cuenta_id === cuenta.cuenta_id && d.boleta === boleta)) {
            return problemaTipado(409, 'deposito_duplicado', 'Boleta repetida', `La boleta ${boleta} ya está registrada en esa cuenta`)
        }
        const momento = ahora()
        const deposito: Schema<'Deposito'> = {
            id: siguienteId(bd.depositos),
            empresa_id: empresaId,
            caja_id: null,
            caja_nombre: null,
            turno_id: null,
            origen: 'custodia',
            custodio_id: yo?.id ?? null,
            custodio_nombre: yo?.nombre ?? null,
            cuenta_id: cuenta.cuenta_id,
            cuenta_codigo: cuenta.cuenta_codigo,
            cuenta_nombre: `${cuenta.banco_nombre} · ${cuenta.alias}`,
            cuenta_bancaria_id: cuenta.id,
            banco_id: null,
            monto: new Decimal(cuerpo.monto).toFixed(2),
            boleta,
            fecha: typeof cuerpo.fecha === 'string' && cuerpo.fecha ? cuerpo.fecha : momento.slice(0, 10),
            estado: 'en_transito',
            acreditado_en: null,
            registrado_por: yo?.id ?? null,
            created_at: momento,
        }
        bd.depositos.push(deposito)
        registrarAccion(solicitud, 'cajas.depositar', { tipo: 'deposito', id: deposito.id }, { monto: deposito.monto, boleta, desde: 'custodia' })
        return { status: 201, cuerpo: deposito }
    })),

    'GET /api/v1/cajas/:id/caja-chica': conPermiso('cajas.ver', (solicitud) => {
        const caja = cajaChicaDe(solicitud)
        return esRespuesta(caja) ? caja : { status: 200, cuerpo: estadoCajaChica(caja) }
    }),

    'GET /api/v1/cajas/:id/reposiciones': conPermiso('cajas.ver', (solicitud) => {
        const caja = cajaChicaDe(solicitud)
        return esRespuesta(caja) ? caja : { status: 200, cuerpo: paginar(bd.efectivo.reposiciones.filter(r => r.caja_id === caja.id).sort((a, b) => b.id - a.id), solicitud) }
    }),

    'GET /api/v1/cajas/:id/conteos': conPermiso('cajas.ver', (solicitud) => {
        const caja = cajaChicaDe(solicitud)
        return esRespuesta(caja) ? caja : { status: 200, cuerpo: paginar(bd.efectivo.conteos.filter(c => c.caja_id === caja.id).sort((a, b) => b.id - a.id), solicitud) }
    }),

    'POST /api/v1/cajas/:id/gastos': conPermiso('caja_chica.registrar_gasto', conIdempotencia((solicitud) => {
        const caja = cajaChicaDe(solicitud)
        if (esRespuesta(caja)) {
            return caja
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: NonNullable<Problem['errors']> = []
        const categoria = categoriasEgreso.find(c => c.clave === cuerpo.categoria)
        if (!categoria) {
            errores.push({ field: 'categoria', message: 'Elige el tipo de gasto', rule: 'enum' })
        }
        if (typeof cuerpo.monto !== 'string' || !MONTO.test(cuerpo.monto) || new Decimal(cuerpo.monto).lte(0)) {
            errores.push({ field: 'monto', message: 'Monto mayor que cero con hasta 2 decimales', rule: 'regex' })
        }
        const descripcion = typeof cuerpo.descripcion === 'string' ? cuerpo.descripcion.trim() : ''
        if (descripcion.length < 2) {
            errores.push({ field: 'descripcion', message: 'Escribe en qué se gastó', rule: 'minLength' })
        }
        if (!(typeof File !== 'undefined' && cuerpo.archivo instanceof File)) {
            errores.push({ field: 'archivo', message: 'El comprobante es obligatorio', rule: 'required' })
        }
        if (errores.length || !categoria || typeof cuerpo.monto !== 'string') {
            return datosInvalidos(errores)
        }
        const yo = usuarioDe(solicitud)
        if (!yo?.permisos.includes('egresos.registrar_sin_limite') && caja.cajero_id !== yo?.id) {
            return problemaTipado(403, 'caja_ajena', 'No eres el encargado', `La caja chica ${caja.nombre} la lleva ${caja.cajero_nombre ?? 'otra persona'}`)
        }
        const antes = estadoCajaChica(caja)
        if (new Decimal(cuerpo.monto).gt(antes.efectivo)) {
            return problemaTipado(422, 'efectivo_insuficiente', 'No alcanza el efectivo', `En la caja chica hay ${antes.efectivo}`, [{ field: 'monto', message: `En la caja chica hay Q ${antes.efectivo}`, rule: 'efectivo_insuficiente' }])
        }
        const momento = ahora()
        const egreso = gasto(siguienteId(bd.egresos), categoria.clave as Egreso['categoria'], categoria.nombre, categoria.cuenta_codigo, descripcion, new Decimal(cuerpo.monto).toFixed(2), momento)
        Object.assign(egreso, { empresa_id: caja.empresa_id ?? 1, caja_id: caja.id, caja_nombre: caja.nombre, registrado_por: yo?.id ?? null, registrado_por_nombre: yo?.nombre ?? null })
        bd.egresos.push(egreso)
        const conFactura = cuerpo.con_factura === true || cuerpo.con_factura === 'true'
        registrarAccion(solicitud, 'caja_chica.registrar_gasto', { tipo: 'egreso', id: egreso.id }, { monto: egreso.monto, categoria: egreso.categoria, con_factura: conFactura })
        return { status: 201, cuerpo: { egreso, caja_chica: estadoCajaChica(caja), pasar_a_compras: conFactura } }
    })),

    'POST /api/v1/cajas/:id/reponer': conPermiso('caja_chica.reponer', conIdempotencia((solicitud) => {
        const caja = cajaChicaDe(solicitud)
        if (esRespuesta(caja)) {
            return caja
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const desde = cuerpo.desde === 'banco' ? 'banco' : cuerpo.desde === 'custodia' ? 'custodia' : null
        if (!desde) {
            return datosInvalidos([{ field: 'desde', message: 'Elige de dónde sale: custodia o banco', rule: 'enum' }])
        }
        const estado = estadoCajaChica(caja)
        const monto = new Decimal(estado.por_reponer)
        if (monto.lte(0)) {
            return problemaTipado(422, 'nada_que_reponer', 'Nada que reponer', 'La caja chica tiene su fondo completo')
        }
        if (typeof cuerpo.monto === 'string' && !monto.equals(cuerpo.monto)) {
            return problemaTipado(422, 'monto_distinto', 'El monto cambió', `Ahora se repone ${monto.toFixed(2)}`)
        }
        const gastos = bd.egresos.filter(e => e.caja_id === caja.id && e.estado === 'registrado' && !e.reposicion_id)
        if (gastos.some(g => g.con_comprobante === false)) {
            return problemaTipado(422, 'gastos_sin_comprobante', 'Gastos sin comprobante', 'Adjunta el comprobante de cada gasto antes de reponer')
        }
        const yo = usuarioDe(solicitud)
        const empresaId = caja.empresa_id ?? 1
        if (desde === 'custodia' && saldoCustodia(empresaId, yo?.id ?? 0).lt(monto)) {
            return problemaTipado(422, 'custodia_insuficiente', 'No alcanza tu custodia', `Tienes ${saldoCustodia(empresaId, yo?.id ?? 0).toFixed(2)} en custodia`)
        }
        const cuenta = desde === 'banco' ? (bd.cuentasBancarias.find(c => c.id === cuerpo.cuenta_bancaria_id) ?? bd.cuentasBancarias[0]) : undefined
        const momento = ahora()
        const reposicion: Schema<'ReposicionCaja'> = {
            id: siguienteId(bd.efectivo.reposiciones),
            empresa_id: empresaId,
            caja_id: caja.id,
            caja_nombre: caja.nombre,
            origen: desde,
            custodio_id: desde === 'custodia' ? (yo?.id ?? null) : null,
            custodio_nombre: desde === 'custodia' ? (yo?.nombre ?? null) : null,
            banco_id: null,
            cuenta_bancaria_id: cuenta?.id ?? null,
            cuenta_codigo: cuenta?.cuenta_codigo ?? '1.1.15',
            referencia: typeof cuerpo.referencia === 'string' && cuerpo.referencia.trim() ? cuerpo.referencia.trim() : null,
            monto: monto.toFixed(2),
            fondo: estado.fondo_fijo,
            efectivo_antes: estado.efectivo,
            fecha: momento.slice(0, 10),
            gastos: gastos.length,
            conteos: estado.diferencias.cantidad,
            asiento_id: null,
            registrado_por: yo?.id ?? null,
            registrado_por_nombre: yo?.nombre ?? null,
            created_at: momento,
        }
        bd.efectivo.reposiciones.push(reposicion)
        for (const g of gastos) {
            g.reposicion_id = reposicion.id
        }
        for (const c of bd.efectivo.conteos.filter(c => c.caja_id === caja.id)) {
            c.repuesto = true
        }
        registrarAccion(solicitud, 'caja_chica.reponer', { tipo: 'reposicion_caja', id: reposicion.id }, { desde, monto: reposicion.monto })
        return { status: 201, cuerpo: reposicion }
    })),

    'POST /api/v1/cajas/:id/contar': conPermiso('caja_chica.contar', conIdempotencia((solicitud) => {
        const caja = cajaChicaDe(solicitud)
        if (esRespuesta(caja)) {
            return caja
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (typeof cuerpo.contado !== 'string' || !MONTO.test(cuerpo.contado)) {
            return datosInvalidos([{ field: 'contado', message: 'Monto con hasta 2 decimales, sin comas', rule: 'regex' }])
        }
        const estado = estadoCajaChica(caja)
        const diferencia = new Decimal(cuerpo.contado).minus(estado.efectivo)
        const motivo = textoMotivo(cuerpo.motivo)
        if (!diferencia.isZero() && motivo.length < 3) {
            return datosInvalidos([{ field: 'motivo', message: 'No cuadra: el motivo es obligatorio', rule: 'requiredWhen' }])
        }
        const yo = usuarioDe(solicitud)
        const momento = ahora()
        const conteo: Schema<'ConteoCaja'> = {
            id: siguienteId(bd.efectivo.conteos),
            empresa_id: caja.empresa_id ?? 1,
            caja_id: caja.id,
            esperado: estado.efectivo,
            contado: new Decimal(cuerpo.contado).toFixed(2),
            diferencia: diferencia.toFixed(2),
            comprobantes: estado.comprobantes.monto,
            fondo: estado.fondo_vigente,
            motivo: motivo || null,
            responsable_id: caja.cajero_id,
            responsable_nombre: caja.cajero_nombre ?? null,
            contado_por: yo?.id ?? null,
            contado_por_nombre: yo?.nombre ?? null,
            fecha: momento.slice(0, 10),
            asiento_id: null,
            repuesto: diferencia.isZero(),
            created_at: momento,
        }
        bd.efectivo.conteos.push(conteo)
        registrarAccion(solicitud, 'caja_chica.contar', { tipo: 'caja', id: caja.id }, { contado: conteo.contado, motivo: conteo.motivo })
        return { status: 201, cuerpo: conteo }
    })),
}
