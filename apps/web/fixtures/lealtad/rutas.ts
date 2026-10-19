/**
 * Rutas del programa de lealtad, fase 1 (A3, `start/routes/lealtad.ts`): programa, reglas, puntos
 * de un cliente, ajustes, referidos y el reporte. Mismos errores que la API real (`programa_ya_activo`,
 * `programa_inactivo_ya`, `cuentas_lealtad_faltantes`, `saldo_insuficiente`, `referido_rechazado`).
 */
import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, numeroQuery, paginar, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'

type Programa = Schema<'ProgramaLealtad'>
type Regla = Schema<'ReglaLealtad'>
type Errores = NonNullable<Problem['errors']>

const MONTO = /^\d{1,12}(\.\d{1,2})?$/
const PORCENTAJE = /^\d{1,3}(\.\d{1,6})?$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const TIPOS = ['pago_a_tiempo', 'antiguedad', 'referido', 'pago_adelantado'] as const

/** Empresas sin las cuentas 2.1.10, 4.1.05 y 4.1.06 en los fixtures: Fibra del Sur. */
const SIN_CUENTAS_LEALTAD = new Set([2])

const invalido = (errores: Errores): RespuestaFixture => problemaTipado(422, 'validacion', 'Datos inválidos', 'Los datos enviados no son válidos', errores)

function hoy(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date())
}

function empresaDe(solicitud: SolicitudFixture): number {
    return empresaActivaDe(solicitud) ?? 1
}

function pasivo(valorPunto: string, pct: string): string {
    return new Decimal(valorPunto).times(pct).div(100).toFixed(6)
}

function validarPrograma(cuerpo: Record<string, unknown>, parcial: boolean): Errores {
    const errores: Errores = []
    if (!parcial || cuerpo.nombre !== undefined) {
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        if (!nombre || nombre.length > 120) {
            errores.push({ field: 'nombre', message: 'El campo nombre es obligatorio', rule: 'required' })
        }
    }
    if (!parcial || cuerpo.valor_punto !== undefined) {
        if (typeof cuerpo.valor_punto !== 'string' || !MONTO.test(cuerpo.valor_punto)) {
            errores.push({ field: 'valor_punto', message: 'Q por punto con hasta 2 decimales', rule: 'regex' })
        }
    }
    if (cuerpo.canje_esperado_pct !== undefined && (typeof cuerpo.canje_esperado_pct !== 'string' || !PORCENTAJE.test(cuerpo.canje_esperado_pct) || new Decimal(cuerpo.canje_esperado_pct).gt(100))) {
        errores.push({ field: 'canje_esperado_pct', message: 'Porcentaje de 0 a 100', rule: 'regex' })
    }
    if (cuerpo.vencimiento_meses !== undefined && cuerpo.vencimiento_meses !== null && (typeof cuerpo.vencimiento_meses !== 'number' || cuerpo.vencimiento_meses < 1 || cuerpo.vencimiento_meses > 120)) {
        errores.push({ field: 'vencimiento_meses', message: 'Meses de 1 a 120', rule: 'range' })
    }
    return errores
}

function cuentasFaltantes(empresaId: number, diferimiento: boolean): RespuestaFixture | null {
    if (!diferimiento || !SIN_CUENTAS_LEALTAD.has(empresaId)) {
        return null
    }
    return problemaTipado(422, 'cuentas_lealtad_faltantes', 'Faltan las cuentas de lealtad', `La empresa ${empresaId} no tiene las cuentas 2.1.10, 4.1.05 y 4.1.06 que exige el diferimiento`, [{ field: 'diferimiento', message: 'Instala las cuentas 2.1.10, 4.1.05 y 4.1.06', rule: 'cuentas_lealtad_faltantes' }])
}

function aplicarPrograma(programa: Programa, cuerpo: Record<string, unknown>): void {
    if (typeof cuerpo.nombre === 'string') {
        programa.nombre = cuerpo.nombre.trim()
    }
    if (typeof cuerpo.valor_punto === 'string') {
        programa.valor_punto = new Decimal(cuerpo.valor_punto).toFixed(2)
    }
    if (typeof cuerpo.diferimiento === 'boolean') {
        programa.diferimiento = cuerpo.diferimiento
    }
    if (typeof cuerpo.canje_esperado_pct === 'string') {
        programa.canje_esperado_pct = new Decimal(cuerpo.canje_esperado_pct).toFixed(6)
    }
    if (cuerpo.vencimiento_meses !== undefined) {
        programa.vencimiento_meses = typeof cuerpo.vencimiento_meses === 'number' ? cuerpo.vencimiento_meses : null
    }
    if (typeof cuerpo.aviso_vencimiento_dias === 'number') {
        programa.aviso_vencimiento_dias = cuerpo.aviso_vencimiento_dias
    }
    if (typeof cuerpo.minimo_canje === 'number') {
        programa.minimo_canje = cuerpo.minimo_canje
    }
    if (typeof cuerpo.terminos === 'string') {
        programa.terminos = cuerpo.terminos
    }
    if (typeof cuerpo.vigente_desde === 'string' && FECHA.test(cuerpo.vigente_desde)) {
        programa.vigente_desde = cuerpo.vigente_desde
    }
    if (cuerpo.vigente_hasta !== undefined) {
        programa.vigente_hasta = typeof cuerpo.vigente_hasta === 'string' ? cuerpo.vigente_hasta : null
    }
    programa.valor_pasivo_punto = pasivo(programa.valor_punto, programa.canje_esperado_pct)
}

function crearPrograma(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores = validarPrograma(cuerpo, false)
    if (errores.length) {
        return invalido(errores)
    }
    const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : empresaDe(solicitud)
    if (bd.programasLealtad.some(p => p.empresa_id === empresaId)) {
        return problemaTipado(409, 'programa_activo_existente', 'Programa existente', `La empresa ${empresaId} ya tiene programa de lealtad`)
    }
    const faltan = cuentasFaltantes(empresaId, cuerpo.diferimiento === true)
    if (faltan) {
        return faltan
    }
    const momento = ahora()
    const programa: Programa = {
        id: siguienteId(bd.programasLealtad),
        empresa_id: empresaId,
        nombre: '',
        activo: false,
        valor_punto: '0.00',
        diferimiento: false,
        canje_esperado_pct: '100.000000',
        valor_pasivo_punto: '0.000000',
        vencimiento_meses: 12,
        aviso_vencimiento_dias: 30,
        minimo_canje: 0,
        terminos: '',
        terminos_hash: '0'.repeat(64),
        vigente_desde: hoy(),
        vigente_hasta: null,
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
    aplicarPrograma(programa, cuerpo)
    bd.programasLealtad.push(programa)
    registrarAccion(solicitud, 'lealtad.crear_programa', { tipo: 'programa_lealtad', id: programa.id }, cuerpo)
    return { status: 201, cuerpo: programa }
}

function validarRegla(cuerpo: Record<string, unknown>, tipo: string): Errores {
    const errores: Errores = []
    if (typeof cuerpo.puntos !== 'number' || !Number.isInteger(cuerpo.puntos) || cuerpo.puntos < 0 || cuerpo.puntos > 1_000_000) {
        errores.push({ field: 'puntos', message: 'Puntos enteros de 0 a 1 000 000', rule: 'range' })
    }
    if (cuerpo.recompensa !== undefined && cuerpo.recompensa !== 'puntos') {
        errores.push({ field: 'recompensa', message: 'Fase 1: solo puntos', rule: 'recompensa_no_disponible' })
    }
    const c = typeof cuerpo.condiciones === 'object' && cuerpo.condiciones !== null ? cuerpo.condiciones as Record<string, unknown> : {}
    if (tipo === 'antiguedad' && Array.isArray(c.estados_validos) && !c.estados_validos.length) {
        errores.push({ field: 'condiciones.estados_validos', message: 'Al menos un estado', rule: 'minLength' })
    }
    return errores
}

const DEFECTOS: Record<string, Record<string, unknown>> = {
    pago_a_tiempo: { dias_antes_vencimiento: 0, solo_servicio: true, sin_promesa: true, racha: null, monto_minimo: null },
    antiguedad: { cada_meses: 12, sin_vencidas_mas_de_dias: null, estados_validos: ['activo'] },
    referido: { facturas_pagadas_minimas: 2, dias_maximos: null, tope_por_referidor: null, puntos_referido: 0 },
    pago_adelantado: { periodos_minimos: 1, puntos_por_periodo: 0 },
}

function condiciones(tipo: string, recibidas: unknown): Regla['condiciones'] {
    return { ...DEFECTOS[tipo], ...(typeof recibidas === 'object' && recibidas !== null ? recibidas : {}) } as Regla['condiciones']
}

/** Saldo y lotes vivos de un cliente en una empresa. */
function lotesDe(clienteId: number, empresaId: number) {
    return bd.lotesPuntos.filter(l => l.cliente_id === clienteId && l.empresa_id === empresaId)
}

function puntosDe(solicitud: SolicitudFixture): RespuestaFixture {
    const clienteId = idDe(solicitud)
    if (!clienteId || !bd.clientes.some(c => c.id === clienteId)) {
        return noEncontrado('el cliente')
    }
    const empresas = [...new Set(bd.movimientosPuntos.filter(m => m.cliente_id === clienteId).map(m => m.empresa_id))].sort()
    const saldos: Schema<'PuntosCliente'>['saldos'] = empresas.map((empresaId) => {
        const lotes = lotesDe(clienteId, empresaId)
        const vivos = lotes.filter(l => l.restante > 0)
        const limite = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
        const proximo = vivos.map(l => l.vence_en).filter((v): v is string => Boolean(v)).sort()[0] ?? null
        return {
            empresa_id: empresaId,
            saldo: bd.movimientosPuntos.filter(m => m.cliente_id === clienteId && m.empresa_id === empresaId).reduce((s, m) => s + m.puntos, 0),
            por_vencer: vivos.filter(l => l.vence_en && l.vence_en <= limite).reduce((s, l) => s + l.restante, 0),
            proximo_vencimiento: proximo,
            valor_pasivo: vivos.reduce((s, l) => s.plus(l.valor_restante), new Decimal(0)).toFixed(2),
            lotes: lotes.map(({ cliente_id: _c, empresa_id: _e, ...lote }) => lote),
        }
    })
    const movimientos = bd.movimientosPuntos.filter(m => m.cliente_id === clienteId).sort((a, b) => b.id - a.id)
    const respuesta: Schema<'PuntosCliente'> = { cliente_id: clienteId, saldos, movimientos: paginar(movimientos, solicitud, 25) }
    return { status: 200, cuerpo: respuesta }
}

/** Como `AjustarPuntos` (A3): positivo agrega un lote; negativo consume los que vencen primero. */
function ajustar(solicitud: SolicitudFixture): RespuestaFixture {
    const cuerpo = cuerpoObjeto(solicitud)
    const errores: Errores = []
    const puntos = cuerpo.puntos
    if (typeof puntos !== 'number' || !Number.isInteger(puntos) || puntos === 0 || Math.abs(puntos) > 1_000_000) {
        errores.push({ field: 'puntos', message: 'Puntos enteros distintos de 0', rule: 'range' })
    }
    const motivo = typeof cuerpo.motivo === 'string' ? cuerpo.motivo.trim() : ''
    if (motivo.length < 3) {
        errores.push({ field: 'motivo', message: 'El campo motivo debe tener al menos 3 caracteres', rule: 'minLength' })
    }
    const cliente = bd.clientes.find(c => c.id === cuerpo.cliente_id)
    if (!cliente) {
        errores.push({ field: 'cliente_id', message: 'El cliente no existe', rule: 'exists' })
    }
    if (errores.length || typeof puntos !== 'number' || !cliente) {
        return invalido(errores)
    }
    const empresaId = empresaDe(solicitud)
    const programa = bd.programasLealtad.find(p => p.empresa_id === empresaId)
    if (!programa || !programa.activo) {
        return problemaTipado(422, 'programa_inactivo', 'Programa inactivo', `La empresa ${empresaId} no tiene un programa de lealtad activo`)
    }
    const saldo = bd.movimientosPuntos.filter(m => m.cliente_id === cliente.id && m.empresa_id === empresaId).reduce((s, m) => s + m.puntos, 0)
    if (puntos < 0 && saldo + puntos < 0) {
        return problemaTipado(422, 'saldo_insuficiente', 'Saldo de puntos insuficiente', `El cliente tiene ${saldo} puntos y se piden ${-puntos}`)
    }
    const valorPorPunto = programa.diferimiento ? new Decimal(programa.valor_pasivo_punto) : new Decimal(0)
    const momento = ahora()
    const vence = programa.vencimiento_meses && puntos > 0 ? new Date(Date.now() + programa.vencimiento_meses * 30.44 * 86_400_000).toISOString().slice(0, 10) : null
    const movimientoId = siguienteId(bd.movimientosPuntos)
    if (puntos > 0) {
        bd.lotesPuntos.push({ id: siguienteId(bd.lotesPuntos), cliente_id: cliente.id, empresa_id: empresaId, programa_id: programa.id, servicio_id: null, regla_id: null, tipo: 'ajuste', puntos, restante: puntos, valor: valorPorPunto.times(puntos).toFixed(2), valor_restante: valorPorPunto.times(puntos).toFixed(2), vence_en: vence, created_at: momento })
    }
    else {
        let falta = -puntos
        for (const lote of lotesDe(cliente.id, empresaId).filter(l => l.restante > 0).sort((a, b) => (a.vence_en ?? '9999').localeCompare(b.vence_en ?? '9999'))) {
            const usa = Math.min(lote.restante, falta)
            lote.restante -= usa
            lote.valor_restante = new Decimal(lote.valor_restante).minus(valorPorPunto.times(usa)).toFixed(2)
            falta -= usa
            if (!falta) {
                break
            }
        }
    }
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    const movimiento: Schema<'MovimientoPuntos'> = {
        id: movimientoId,
        empresa_id: empresaId,
        programa_id: programa.id,
        cliente_id: cliente.id,
        servicio_id: typeof cuerpo.servicio_id === 'number' ? cuerpo.servicio_id : null,
        tipo: 'ajuste',
        puntos,
        regla_id: null,
        origen_tipo: 'ajuste',
        origen_id: null,
        clave_unica: `ajuste:${crypto.randomUUID()}`,
        vence_en: vence,
        valor: valorPorPunto.times(Math.abs(puntos)).toFixed(2),
        asiento_id: programa.diferimiento ? siguienteId(bd.asientos) : null,
        reversa_de: null,
        motivo,
        creado_por: usuario?.id ?? null,
        created_at: momento,
    }
    bd.movimientosPuntos.push(movimiento)
    registrarAccion(solicitud, 'lealtad.ajustar', { tipo: 'cliente', id: cliente.id }, cuerpo)
    const resultado: Schema<'AjustePuntos'> = { movimiento, saldo: saldo + puntos }
    return { status: 201, cuerpo: resultado }
}

function reporte(solicitud: SolicitudFixture): RespuestaFixture {
    const desde = solicitud.query.get('desde')
    const hasta = solicitud.query.get('hasta')
    const empresas = deLaEmpresa(bd.programasLealtad, solicitud).map(p => p.empresa_id)
    const enRango = (m: Schema<'MovimientoPuntos'>) => (!desde || m.created_at.slice(0, 10) >= desde) && (!hasta || m.created_at.slice(0, 10) <= hasta)
    const filas: Schema<'ReporteLealtad'>['empresas'] = empresas.map((empresaId) => {
        const todos = bd.movimientosPuntos.filter(m => m.empresa_id === empresaId)
        const rango = todos.filter(enRango)
        const suma = (lista: typeof todos) => lista.reduce((s, m) => s + Math.abs(m.puntos), 0)
        const positivos = rango.filter(m => m.puntos > 0)
        const liberados = rango.filter(m => m.puntos < 0)
        const vivos = bd.lotesPuntos.filter(l => l.empresa_id === empresaId && l.restante > 0)
        const pasivoLotes = vivos.reduce((s, l) => s.plus(l.valor_restante), new Decimal(0)).toFixed(2)
        const pasivoLibro = bd.pasivoLibroLealtad[empresaId] ?? pasivoLotes
        return {
            empresa_id: empresaId,
            emitidos: suma(positivos),
            valor_emitido: positivos.reduce((s, m) => s.plus(m.valor), new Decimal(0)).toFixed(2),
            canjeados: suma(rango.filter(m => m.tipo === 'canje')),
            vencidos: suma(rango.filter(m => m.tipo === 'vencimiento')),
            revertidos: suma(rango.filter(m => m.tipo === 'reverso')),
            ajustes_negativos: suma(liberados.filter(m => m.tipo === 'ajuste')),
            valor_liberado: liberados.reduce((s, m) => s.plus(m.valor), new Decimal(0)).toFixed(2),
            saldo_puntos: todos.reduce((s, m) => s + m.puntos, 0),
            puntos_vivos: vivos.reduce((s, l) => s + l.restante, 0),
            pasivo_lotes: pasivoLotes,
            pasivo_libro: pasivoLibro,
            cuadra: new Decimal(pasivoLotes).equals(pasivoLibro),
        }
    })
    const cuerpo: Schema<'ReporteLealtad'> = { desde, hasta, empresas: filas }
    return { status: 200, cuerpo }
}

export const rutasLealtad: RutasFixture = {
    'GET /api/v1/lealtad/programa': conPermiso('lealtad.ver', (solicitud) => {
        const empresaId = empresaDe(solicitud)
        const cuerpo: Schema<'ProgramaLealtadEmpresa'> = { empresa_id: empresaId, programa: bd.programasLealtad.find(p => p.empresa_id === empresaId) ?? null }
        return { status: 200, cuerpo }
    }),
    'GET /api/v1/lealtad/programas': conPermiso('lealtad.ver', solicitud => ({ status: 200, cuerpo: deLaEmpresa(bd.programasLealtad, solicitud) })),
    'POST /api/v1/lealtad/programas': conPermiso('lealtad.configurar', conIdempotencia(crearPrograma)),
    'PUT /api/v1/lealtad/programas/:id': conPermiso('lealtad.configurar', (solicitud) => {
        const programa = bd.programasLealtad.find(p => p.id === idDe(solicitud))
        if (!programa) {
            return noEncontrado('el programa')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== programa.version) {
            return versionCambiada()
        }
        const errores = validarPrograma(cuerpo, true)
        if (errores.length) {
            return invalido(errores)
        }
        const faltan = cuentasFaltantes(programa.empresa_id, cuerpo.diferimiento === true)
        if (faltan) {
            return faltan
        }
        aplicarPrograma(programa, cuerpo)
        Object.assign(programa, { version: programa.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'lealtad.editar_programa', { tipo: 'programa_lealtad', id: programa.id }, cuerpo)
        return { status: 200, cuerpo: programa }
    }),
    'POST /api/v1/lealtad/programas/:id/activar': conPermiso('lealtad.configurar', conIdempotencia((solicitud) => {
        const programa = bd.programasLealtad.find(p => p.id === idDe(solicitud))
        if (!programa) {
            return noEncontrado('el programa')
        }
        if (programa.activo) {
            return problemaTipado(409, 'programa_ya_activo', 'Programa ya activo', `El programa ${programa.id} ya está activo`)
        }
        const faltan = cuentasFaltantes(programa.empresa_id, programa.diferimiento)
        if (faltan) {
            return faltan
        }
        Object.assign(programa, { activo: true, version: programa.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'lealtad.activar_programa', { tipo: 'programa_lealtad', id: programa.id }, {})
        return { status: 200, cuerpo: programa }
    })),
    'POST /api/v1/lealtad/programas/:id/desactivar': conPermiso('lealtad.configurar', conIdempotencia((solicitud) => {
        const programa = bd.programasLealtad.find(p => p.id === idDe(solicitud))
        if (!programa) {
            return noEncontrado('el programa')
        }
        const motivo = String(cuerpoObjeto(solicitud).motivo ?? '').trim()
        if (motivo.length < 3) {
            return invalido([{ field: 'motivo', message: 'El campo motivo debe tener al menos 3 caracteres', rule: 'minLength' }])
        }
        if (!programa.activo) {
            return problemaTipado(409, 'programa_inactivo_ya', 'Programa ya inactivo', `El programa ${programa.id} ya está inactivo`)
        }
        Object.assign(programa, { activo: false, version: programa.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'lealtad.desactivar_programa', { tipo: 'programa_lealtad', id: programa.id }, { motivo })
        return { status: 200, cuerpo: programa }
    })),

    'GET /api/v1/lealtad/reglas': conPermiso('lealtad.ver', (solicitud) => {
        const programa = numeroQuery(solicitud, 'programa_id')
        const tipo = solicitud.query.get('tipo')
        const filas = deLaEmpresa(bd.reglasLealtad, solicitud).filter(r => (programa === undefined || r.programa_id === programa) && (!tipo || r.tipo === tipo)).sort((a, b) => a.id - b.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
    'POST /api/v1/lealtad/reglas': conPermiso('lealtad.configurar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const tipo = String(cuerpo.tipo)
        if (!(TIPOS as readonly string[]).includes(tipo)) {
            return invalido([{ field: 'tipo', message: 'Tipo de regla inválido', rule: 'union' }])
        }
        const programa = bd.programasLealtad.find(p => p.id === cuerpo.programa_id)
        if (!programa) {
            return invalido([{ field: 'programa_id', message: 'El programa no existe', rule: 'exists' }])
        }
        const errores = validarRegla(cuerpo, tipo)
        if (errores.length) {
            return invalido(errores)
        }
        const momento = ahora()
        const regla: Regla = {
            id: siguienteId(bd.reglasLealtad),
            empresa_id: programa.empresa_id,
            programa_id: programa.id,
            tipo: tipo as Regla['tipo'],
            condiciones: condiciones(tipo, cuerpo.condiciones),
            recompensa: 'puntos',
            puntos: Number(cuerpo.puntos),
            premio_id: null,
            sorteo_id: null,
            tope_por_cliente: typeof cuerpo.tope_por_cliente === 'number' ? cuerpo.tope_por_cliente : null,
            periodo_tope: cuerpo.periodo_tope === 'mes' || cuerpo.periodo_tope === 'anio' ? cuerpo.periodo_tope : null,
            activa: cuerpo.activa !== false,
            vigente_desde: typeof cuerpo.vigente_desde === 'string' ? cuerpo.vigente_desde : hoy(),
            vigente_hasta: typeof cuerpo.vigente_hasta === 'string' ? cuerpo.vigente_hasta : null,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.reglasLealtad.push(regla)
        registrarAccion(solicitud, 'lealtad.crear_regla', { tipo: 'regla_lealtad', id: regla.id }, cuerpo)
        return { status: 201, cuerpo: regla }
    })),
    'GET /api/v1/lealtad/reglas/:id': conPermiso('lealtad.ver', (solicitud) => {
        const regla = bd.reglasLealtad.find(r => r.id === idDe(solicitud))
        return regla ? { status: 200, cuerpo: regla } : noEncontrado('la regla')
    }),
    'PUT /api/v1/lealtad/reglas/:id': conPermiso('lealtad.configurar', (solicitud) => {
        const regla = bd.reglasLealtad.find(r => r.id === idDe(solicitud))
        if (!regla) {
            return noEncontrado('la regla')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        if (cuerpo.version !== regla.version) {
            return versionCambiada()
        }
        const errores = validarRegla({ puntos: regla.puntos, ...cuerpo }, regla.tipo)
        if (errores.length) {
            return invalido(errores)
        }
        Object.assign(regla, {
            condiciones: cuerpo.condiciones === undefined ? regla.condiciones : condiciones(regla.tipo, cuerpo.condiciones),
            puntos: typeof cuerpo.puntos === 'number' ? cuerpo.puntos : regla.puntos,
            tope_por_cliente: cuerpo.tope_por_cliente === undefined ? regla.tope_por_cliente : (typeof cuerpo.tope_por_cliente === 'number' ? cuerpo.tope_por_cliente : null),
            periodo_tope: cuerpo.periodo_tope === undefined ? regla.periodo_tope : (cuerpo.periodo_tope === 'mes' || cuerpo.periodo_tope === 'anio' ? cuerpo.periodo_tope : null),
            activa: typeof cuerpo.activa === 'boolean' ? cuerpo.activa : regla.activa,
            vigente_desde: typeof cuerpo.vigente_desde === 'string' ? cuerpo.vigente_desde : regla.vigente_desde,
            vigente_hasta: cuerpo.vigente_hasta === undefined ? regla.vigente_hasta : (typeof cuerpo.vigente_hasta === 'string' ? cuerpo.vigente_hasta : null),
            version: regla.version + 1,
            updated_at: ahora(),
        })
        registrarAccion(solicitud, 'lealtad.editar_regla', { tipo: 'regla_lealtad', id: regla.id }, cuerpo)
        return { status: 200, cuerpo: regla }
    }),

    'GET /api/v1/clientes/:id/puntos': conPermiso('lealtad.ver', puntosDe),
    'POST /api/v1/lealtad/ajustes': conPermiso('lealtad.ajustar', conIdempotencia(ajustar)),

    'GET /api/v1/lealtad/referidos': conPermiso('lealtad.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        const filas = deLaEmpresa(bd.referidosLealtad, solicitud).filter(r => !estado || r.estado === estado).sort((a, b) => b.id - a.id)
        return { status: 200, cuerpo: paginar(filas, solicitud) }
    }),
    'POST /api/v1/lealtad/referidos/:id/rechazar': conPermiso('lealtad.ajustar', conIdempotencia((solicitud) => {
        const referido = bd.referidosLealtad.find(r => r.id === idDe(solicitud))
        if (!referido) {
            return noEncontrado('el referido')
        }
        const motivo = String(cuerpoObjeto(solicitud).motivo ?? '').trim()
        if (motivo.length < 3) {
            return invalido([{ field: 'motivo', message: 'El campo motivo debe tener al menos 3 caracteres', rule: 'minLength' }])
        }
        if (referido.estado === 'rechazado') {
            return problemaTipado(409, 'referido_rechazado', 'Referido rechazado', `El referido ${referido.id} ya está rechazado`)
        }
        Object.assign(referido, { estado: 'rechazado', motivo, version: referido.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'lealtad.rechazar_referido', { tipo: 'referido_lealtad', id: referido.id }, { motivo })
        return { status: 200, cuerpo: referido }
    })),

    'GET /api/v1/reportes/lealtad': conPermiso('reportes.ver', reporte),
}
