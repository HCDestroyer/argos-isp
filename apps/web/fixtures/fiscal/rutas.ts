import type { Problem, Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { hoyGuatemala } from '~/utils/cobro'
import { bd, siguienteId } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, empresaActivaDe, idDe, noEncontrado, problemaTipado, registrarAccion, usuariosPorToken, versionCambiada } from '../comun'
import { CATALOGO_DTE_GT, FRASES_REGIMEN, TIPOS_DTE_GT, localizacionesFiscales } from './datos'
import { parametrosPaquete } from './paquete'

/**
 * Rutas de la localización fiscal (A3, fase 2; README de `apps/api/app/fiscal`). Resuelven los
 * valores igual que la API: en cada nivel la fila más reciente con `vigente_desde <= fecha`; gana
 * empresa (usuario) → instalación → global (usuario) → paquete. Edición = inserción con vigencia.
 */

type Parametro = Schema<'ParametroFiscal'>
type Valor = Schema<'ValorParametroFiscal'>
type Impuesto = Schema<'ImpuestoFiscal'>
type Frase = Schema<'FraseFiscal'>
type Errores = NonNullable<Problem['errors']>

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const PORCENTAJE = /^\d{1,3}(\.\d{1,6})?$/
const MONTO = /^\d{1,12}\.\d{2}$/
const REGIMENES = ['utilidades', 'opcional_simplificado', 'pequeno_contribuyente'] as const
type Regimen = typeof REGIMENES[number]

const esRegimen = (valor: unknown): valor is Regimen => typeof valor === 'string' && (REGIMENES as readonly string[]).includes(valor)

/** Empresa de la operación: `empresa_id` (query o cuerpo) o la activa; 422 `empresa_requerida` sin ninguna. */
function empresaDe(solicitud: SolicitudFixture, cuerpo?: Record<string, unknown>): number | RespuestaFixture {
    const pedida = typeof cuerpo?.empresa_id === 'number' ? cuerpo.empresa_id : Number(solicitud.query.get('empresa_id'))
    const id = Number.isInteger(pedida) && pedida > 0 ? pedida : empresaActivaDe(solicitud)
    if (id === null) {
        return problemaTipado(422, 'empresa_requerida', 'Empresa requerida', 'Elige la empresa con la que trabajas (cabecera X-Empresa-Id) o indica empresa_id')
    }
    if (!bd.empresas.some(e => e.id === id)) {
        return noEncontrado('la empresa')
    }
    if (!bd.fiscal.instalaciones[id]?.length) {
        return problemaTipado(422, 'localizacion_no_instalada', 'Localización no instalada', `La empresa ${id} no tiene localización fiscal instalada (POST /fiscal/empresas/${id}/actualizar-localizacion)`, [{ field: 'empresa_id', message: 'Sin localización fiscal', rule: 'localizacion_no_instalada' }])
    }
    return id
}

function fechaDe(solicitud: SolicitudFixture): string | RespuestaFixture {
    const fecha = solicitud.query.get('fecha')
    if (fecha === null || fecha === '') {
        return hoyGuatemala()
    }
    return FECHA.test(fecha) ? fecha : datosInvalidos([{ field: 'fecha', message: 'Fecha YYYY-MM-DD', rule: 'date' }])
}

function alcanceGlobal(solicitud: SolicitudFixture): boolean {
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    return usuario?.alcance_global === true
}

/** La fila más reciente con `vigente_desde <= fecha` (empate: la última insertada). */
function ultima<T extends { id: number | null, vigente_desde: string | null }>(filas: T[], fecha: string): T | null {
    return filas
        .filter(f => f.vigente_desde !== null && f.vigente_desde <= fecha)
        .sort((a, b) => (a.vigente_desde ?? '').localeCompare(b.vigente_desde ?? '') || (a.id ?? 0) - (b.id ?? 0))
        .at(-1) ?? null
}

function nivelDe(fila: Valor): Valor['nivel'] {
    if (fila.origen === 'paquete') {
        return 'paquete'
    }
    if (fila.origen === 'instalacion') {
        return 'instalacion'
    }
    return fila.empresa_id === null ? 'global' : 'empresa'
}

/** Filas que ve una empresa: las suyas, las globales y las del paquete. */
function valoresDe(empresaId: number, clave: string): Valor[] {
    return bd.fiscal.valores.filter(v => v.clave === clave && (v.empresa_id === null || v.empresa_id === empresaId))
}

export function resolverValor(empresaId: number, clave: string, fecha: string): Valor | null {
    const filas = valoresDe(empresaId, clave)
    const niveles: Valor['nivel'][] = ['empresa', 'instalacion', 'global', 'paquete']
    for (const nivel of niveles) {
        const fila = ultima(filas.filter(f => nivelDe(f) === nivel), fecha)
        if (fila) {
            return fila
        }
    }
    return null
}

export function parametroVigente(def: Parametro, empresaId: number, fecha: string): Parametro {
    if (def.derivado) {
        return { ...def }
    }
    const fila = resolverValor(empresaId, def.clave, fecha)
    const nivel = fila ? nivelDe(fila) : null
    return {
        ...def,
        valor: fila?.valor ?? null,
        vigente_desde: fila?.vigente_desde ?? null,
        nivel,
        origen: fila?.origen ?? null,
        pendiente_confirmar: def.confirmar_contador && (nivel === null || nivel === 'paquete'),
        editable: def.alcance !== 'N' && def.accion === null,
    }
}

/** Mismo periodo cerrado que `exigirVigenciaAbierta` (meses cerrados sin reapertura). */
function vigenciaBloqueada(empresaId: number | null, vigenteDesde: string): RespuestaFixture | null {
    const mes = vigenteDesde.slice(0, 7)
    const cerrado = bd.cierres
        .filter(c => c.estado === 'cerrado' && c.periodo >= mes && (empresaId === null || (c.empresa_id ?? 1) === empresaId))
        .sort((a, b) => b.periodo.localeCompare(a.periodo))[0]
    if (!cerrado) {
        return null
    }
    return problemaTipado(422, 'vigencia_en_periodo_bloqueado', 'Vigencia en periodo bloqueado', `vigente_desde ${vigenteDesde} cae en un periodo cerrado (${cerrado.periodo}); use una fecha posterior`, [{ field: 'vigente_desde', message: `Periodo ${cerrado.periodo} cerrado`, rule: 'vigencia_en_periodo_bloqueado' }])
}

function motivoInvalido(motivo: unknown): Errores {
    return typeof motivo === 'string' && motivo.trim().length >= 3 && motivo.trim().length <= 500
        ? []
        : [{ field: 'motivo', message: 'El campo motivo debe tener al menos 3 caracteres', rule: 'minLength' }]
}

function fechaInvalida(valor: unknown, campo = 'vigente_desde'): Errores {
    return typeof valor === 'string' && FECHA.test(valor) ? [] : [{ field: campo, message: `El campo ${campo} no tiene un formato válido`, rule: 'regex' }]
}

function tipoJson(valor: unknown): string {
    if (valor === null) {
        return 'null'
    }
    if (Array.isArray(valor)) {
        return 'array'
    }
    if (typeof valor === 'string' && /^-?\d+(\.\d+)?$/.test(valor)) {
        return 'decimal'
    }
    return typeof valor
}

/** `mismaForma` de la API: el valor nuevo de un `json` tiene la forma del del paquete. */
function mismaForma(valor: unknown, modelo: unknown, ruta: string, errores: Errores): void {
    const esperado = tipoJson(modelo)
    const recibido = tipoJson(valor)
    if (esperado === 'null' || (esperado === 'string' && recibido === 'decimal')) {
        return
    }
    if (esperado !== recibido) {
        errores.push({ field: ruta, message: `Se esperaba ${esperado} y llegó ${recibido}`, rule: 'forma' })
        return
    }
    if (esperado === 'array' && Array.isArray(valor) && Array.isArray(modelo)) {
        if (valor.length === 0) {
            errores.push({ field: ruta, message: 'La lista no puede estar vacía', rule: 'forma' })
        }
        if (modelo[0] !== undefined) {
            valor.forEach((elemento, indice) => mismaForma(elemento, modelo[0], `${ruta}.${indice}`, errores))
        }
        return
    }
    if (esperado === 'object' && typeof valor === 'object' && typeof modelo === 'object' && valor !== null && modelo !== null) {
        const propio = valor as Record<string, unknown>
        const plantilla = modelo as Record<string, unknown>
        for (const clave of Object.keys(plantilla)) {
            if (clave in propio) {
                mismaForma(propio[clave], plantilla[clave], `${ruta}.${clave}`, errores)
            }
            else {
                errores.push({ field: `${ruta}.${clave}`, message: 'Falta', rule: 'required' })
            }
        }
        for (const clave of Object.keys(propio)) {
            if (!(clave in plantilla)) {
                errores.push({ field: `${ruta}.${clave}`, message: 'No existe', rule: 'no_aplica' })
            }
        }
    }
}

/** `validarValor` de la API (tipo, opciones, rango, forma y tope por clave). */
function validarValor(def: Parametro, valor: unknown, modelo: unknown): Errores {
    const errores: Errores = []
    const enRango = (texto: string) => {
        const numero = new Decimal(texto)
        if (def.minimo !== null && numero.lt(def.minimo)) {
            errores.push({ field: 'valor', message: `Mínimo ${def.minimo}`, rule: 'minimo' })
        }
        if (def.maximo !== null && numero.gt(def.maximo)) {
            errores.push({ field: 'valor', message: `Máximo ${def.maximo}`, rule: 'maximo' })
        }
    }
    switch (def.tipo) {
        case 'porcentaje':
        case 'monto':
            if (typeof valor !== 'string' || !(def.tipo === 'monto' ? MONTO : PORCENTAJE).test(valor)) {
                errores.push({ field: 'valor', message: def.tipo === 'monto' ? 'Monto como string con 2 decimales ("2500.00")' : 'Porcentaje como string decimal ("12.00")', rule: def.tipo })
                break
            }
            if (def.tipo === 'porcentaje' && new Decimal(valor).gt(100)) {
                errores.push({ field: 'valor', message: 'Un porcentaje no pasa de 100', rule: 'maximo' })
            }
            enRango(valor)
            break
        case 'entero':
            if (typeof valor !== 'number' || !Number.isInteger(valor)) {
                errores.push({ field: 'valor', message: 'Número entero', rule: 'entero' })
                break
            }
            enRango(String(valor))
            break
        case 'fecha':
            if (typeof valor !== 'string' || !FECHA.test(valor)) {
                errores.push({ field: 'valor', message: 'Fecha YYYY-MM-DD', rule: 'fecha' })
            }
            break
        case 'texto':
            if (typeof valor !== 'string' || valor.trim().length === 0) {
                errores.push({ field: 'valor', message: 'Texto no vacío', rule: 'texto' })
            }
            break
        case 'enum':
            if (typeof valor !== 'string' || !(def.opciones ?? []).includes(valor)) {
                errores.push({ field: 'valor', message: `Una de: ${(def.opciones ?? []).join(', ')}`, rule: 'enum' })
            }
            break
        case 'bool':
            if (typeof valor !== 'boolean') {
                errores.push({ field: 'valor', message: 'true o false', rule: 'bool' })
            }
            break
        case 'json':
            if (valor === null || typeof valor !== 'object') {
                errores.push({ field: 'valor', message: 'Objeto o lista JSON', rule: 'json' })
                break
            }
            if (modelo !== undefined && modelo !== null) {
                mismaForma(valor, modelo, 'valor', errores)
            }
            if (errores.length === 0 && def.tope_por_clave && modelo && typeof modelo === 'object') {
                for (const [clave, tope] of Object.entries(modelo as Record<string, string>)) {
                    const propio = new Decimal((valor as Record<string, string>)[clave] ?? '0')
                    if (propio.lt(0)) {
                        errores.push({ field: `valor.${clave}`, message: 'No puede ser negativo', rule: 'minimo' })
                    }
                    else if (propio.gt(tope)) {
                        errores.push({ field: `valor.${clave}`, message: `El máximo legal es ${tope}`, rule: 'maximo' })
                    }
                }
            }
            break
    }
    return errores
}

function vigenciaDuplicada(detalle: string): RespuestaFixture {
    return problemaTipado(409, 'vigencia_duplicada', 'Vigencia duplicada', detalle)
}

function regimenVigente(empresaId: number, fecha: string): Regimen {
    const valor = resolverValor(empresaId, 'regimen', fecha)?.valor
    return esRegimen(valor) ? valor : 'utilidades'
}

/** Frases que aplican en `fecha`: las del régimen vigente (derivadas) y las manuales activas. */
function frasesVigentes(empresaId: number, fecha: string): Frase[] {
    const fila = resolverValor(empresaId, 'regimen', fecha)
    const delRegimen: Frase[] = FRASES_REGIMEN[regimenVigente(empresaId, fecha)].map(frase => ({
        ...frase,
        id: null,
        empresa_id: empresaId,
        origen: 'regimen',
        activa: true,
        vigente_desde: fila?.vigente_desde ?? null,
        resolucion: null,
        motivo: null,
        creado_por: null,
        created_at: null,
    }))
    return [...delRegimen, ...manualesEn(empresaId, fecha).filter(f => f.activa)]
}

/** Última fila de cada frase manual con `vigente_desde <= fecha` (activa o retirada). */
function manualesEn(empresaId: number, fecha: string): Frase[] {
    const claves = new Set(bd.fiscal.frases.filter(f => f.empresa_id === empresaId).map(f => f.clave))
    return [...claves]
        .map(clave => ultima(bd.fiscal.frases.filter(f => f.empresa_id === empresaId && f.clave === clave), fecha))
        .filter((f): f is Frase => f !== null)
}

function nivelImpuesto(fila: Impuesto): Impuesto['nivel'] {
    if (fila.origen === 'paquete') {
        return 'paquete'
    }
    return fila.empresa_id === null ? 'global' : 'empresa'
}

function versionesImpuesto(empresaId: number, codigo: string): Impuesto[] {
    return bd.fiscal.impuestos
        .filter(i => i.codigo === codigo && (i.empresa_id === null || i.empresa_id === empresaId))
        .map(i => ({ ...i, nivel: nivelImpuesto(i) }))
        .sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde) || a.id - b.id)
}

function impuestoVigente(empresaId: number, codigo: string, fecha: string): Impuesto | null {
    const versiones = versionesImpuesto(empresaId, codigo)
    for (const nivel of ['empresa', 'global', 'paquete'] as const) {
        const fila = ultima(versiones.filter(v => v.nivel === nivel), fecha)
        if (fila) {
            return fila
        }
    }
    return null
}

function localizacion(empresaId: number): Schema<'LocalizacionEmpresa'> {
    const instalaciones = bd.fiscal.instalaciones[empresaId] ?? []
    const vigente = instalaciones[0]
    const empresa = bd.empresas.find(e => e.id === empresaId)
    const disponible = localizacionesFiscales.find(l => l.pais === (empresa?.pais ?? 'GT') && l.mas_reciente) ?? null
    return {
        empresa_id: empresaId,
        instalada: Boolean(vigente),
        pais: vigente ? 'GT' : null,
        codigo: vigente?.localizacion_codigo ?? null,
        version: vigente ? (localizacionesFiscales.find(l => l.codigo === vigente.localizacion_codigo)?.version ?? null) : null,
        disponible: disponible?.codigo ?? null,
        actualizacion_disponible: Boolean(disponible && vigente && disponible.codigo !== vigente.localizacion_codigo),
        instalaciones,
        tipos_dte: vigente ? CATALOGO_DTE_GT.map(t => ({ ...t, regimenes: [...t.regimenes] })) : [],
    }
}

function textoONull(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

function erroresEstablecimiento(cuerpo: Record<string, unknown>, creando: boolean): Errores {
    const errores: Errores = []
    if (creando && (typeof cuerpo.codigo !== 'number' || !Number.isInteger(cuerpo.codigo) || cuerpo.codigo < 1)) {
        errores.push({ field: 'codigo', message: 'El campo codigo debe ser un número entero mayor que 0', rule: 'min' })
    }
    if ((creando || 'nombre' in cuerpo) && (typeof cuerpo.nombre !== 'string' || !cuerpo.nombre.trim() || cuerpo.nombre.length > 150)) {
        errores.push({ field: 'nombre', message: 'El nombre es obligatorio (máximo 150 caracteres)', rule: 'required' })
    }
    for (const [campo, maximo] of [['direccion', 300], ['municipio', 100], ['departamento', 100]] as const) {
        const valor = cuerpo[campo]
        if (valor !== undefined && valor !== null && (typeof valor !== 'string' || valor.length > maximo)) {
            errores.push({ field: campo, message: `Máximo ${maximo} caracteres`, rule: 'maxLength' })
        }
    }
    return errores
}

export const rutasFiscal: RutasFixture = {
    'GET /api/v1/fiscal/localizaciones': conPermiso('fiscal.ver', () => ({ status: 200, cuerpo: localizacionesFiscales })),

    'GET /api/v1/fiscal/empresas/:id/localizacion': conPermiso('fiscal.ver', (solicitud) => {
        const id = idDe(solicitud)
        if (id === null || !bd.empresas.some(e => e.id === id)) {
            return noEncontrado('la empresa')
        }
        return { status: 200, cuerpo: localizacion(id) }
    }),

    'POST /api/v1/fiscal/empresas/:id/actualizar-localizacion': conPermiso('fiscal.instalar', conIdempotencia((solicitud) => {
        const id = idDe(solicitud)
        if (id === null || !bd.empresas.some(e => e.id === id)) {
            return noEncontrado('la empresa')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const codigo = typeof cuerpo.codigo === 'string' ? cuerpo.codigo : 'gt-2026.1'
        if (!localizacionesFiscales.some(l => l.codigo === codigo)) {
            return problemaTipado(422, 'pais_no_soportado', 'País no soportado', `No hay paquete ${codigo}`, [{ field: 'codigo', message: `Sin paquete ${codigo}`, rule: 'pais_no_soportado' }])
        }
        const instalaciones = bd.fiscal.instalaciones[id] ?? []
        const ya = instalaciones[0]?.localizacion_codigo === codigo
        registrarAccion(solicitud, 'fiscal.instalar', { tipo: 'empresa', id }, cuerpo)
        const resumen: Schema<'ResultadoInstalacionFiscal'>['resumen'] = {
            empresa_id: id,
            codigo,
            de_codigo: ya ? (instalaciones[0]?.de_codigo ?? null) : (instalaciones[0]?.localizacion_codigo ?? null),
            ya_instalada: ya,
            cuentas: [],
            parametros: [],
            valores: [],
            impuestos: [],
            establecimientos: [],
            instalacion_id: instalaciones[0]?.id ?? null,
        }
        return { status: 200, cuerpo: { ...localizacion(id), resumen } }
    })),

    'GET /api/v1/fiscal/parametros': conPermiso('fiscal.ver', (solicitud) => {
        const empresaId = empresaDe(solicitud)
        if (typeof empresaId !== 'number') {
            return empresaId
        }
        const fecha = fechaDe(solicitud)
        if (typeof fecha !== 'string') {
            return fecha
        }
        const parametros = parametrosPaquete
            .map(def => parametroVigente(def, empresaId, fecha))
            .sort((a, b) => a.clave.localeCompare(b.clave))
        const cuerpo: Schema<'ParametrosFiscales'> = { empresa_id: empresaId, fecha, pais: 'GT', localizacion: 'gt-2026.1', parametros }
        return { status: 200, cuerpo }
    }),

    'GET /api/v1/fiscal/parametros/:clave/historial': conPermiso('fiscal.ver', (solicitud) => {
        const empresaId = empresaDe(solicitud)
        if (typeof empresaId !== 'number') {
            return empresaId
        }
        const fecha = fechaDe(solicitud)
        if (typeof fecha !== 'string') {
            return fecha
        }
        const def = parametrosPaquete.find(p => p.clave === solicitud.params.clave)
        if (!def) {
            return noEncontrado(`el parámetro ${solicitud.params.clave ?? ''}`)
        }
        const valores = valoresDe(empresaId, def.clave)
            .map(v => ({ ...v, nivel: nivelDe(v) }))
            .sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde) || a.id - b.id)
        const cuerpo: Schema<'HistorialParametroFiscal'> = { parametro: parametroVigente(def, empresaId, fecha), valores }
        return { status: 200, cuerpo }
    }),

    'POST /api/v1/fiscal/parametros/:clave/valores': conPermiso('fiscal.editar_parametros', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = [...fechaInvalida(cuerpo.vigente_desde), ...motivoInvalido(cuerpo.motivo)]
        if (!('valor' in cuerpo)) {
            errores.push({ field: 'valor', message: 'El campo valor es obligatorio', rule: 'required' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const global = cuerpo.ambito === 'global'
        let empresaId: number | null = null
        if (global) {
            if (!alcanceGlobal(solicitud)) {
                return problemaTipado(403, 'alcance_global_requerido', 'Alcance global requerido', 'Un valor global afecta a todas las empresas: requiere un usuario con alcance global')
            }
        }
        else {
            const empresa = empresaDe(solicitud, cuerpo)
            if (typeof empresa !== 'number') {
                return empresa
            }
            empresaId = empresa
        }
        const clave = solicitud.params.clave ?? ''
        const def = parametrosPaquete.find(p => p.clave === clave)
        if (!def) {
            return noEncontrado(`el parámetro ${clave}`)
        }
        const noEditable = (detalle: string) => problemaTipado(422, 'parametro_no_editable', 'Parámetro no editable', detalle, [{ field: clave, message: detalle, rule: 'parametro_no_editable' }])
        if (def.alcance === 'N') {
            return noEditable(`${clave} lo fija la ley (alcance N): no se edita`)
        }
        if (def.accion) {
            return noEditable(`${clave} se cambia con su acción propia (${def.accion})`)
        }
        if (global && def.alcance === 'E') {
            return noEditable(`${clave} es de cada empresa (alcance E): no admite valor global`)
        }
        const vigenteDesde = String(cuerpo.vigente_desde)
        const delPaquete = bd.fiscal.valores.filter(v => v.clave === clave && v.origen === 'paquete')
        const modelo = (ultima(delPaquete, vigenteDesde) ?? delPaquete.at(-1))?.valor
        const fueraDeRango = validarValor(def, cuerpo.valor, modelo)
        if (fueraDeRango.length) {
            return problemaTipado(422, 'parametro_fuera_de_rango', 'Parámetro fuera de rango', 'El valor no es válido para el parámetro', fueraDeRango)
        }
        const bloqueada = vigenciaBloqueada(empresaId, vigenteDesde)
        if (bloqueada) {
            return bloqueada
        }
        const repetida = bd.fiscal.valores.find(v => v.clave === clave && v.empresa_id === empresaId && v.origen === 'usuario' && v.vigente_desde === vigenteDesde)
        if (repetida) {
            return vigenciaDuplicada(`${clave} ya tiene un valor ${global ? 'global' : 'de la empresa'} con vigencia ${vigenteDesde} (${repetida.id}); use otra fecha`)
        }
        const anterior = empresaId === null
            ? (ultima(bd.fiscal.valores.filter(v => v.clave === clave && v.empresa_id === null), vigenteDesde)?.valor ?? null)
            : (resolverValor(empresaId, clave, vigenteDesde)?.valor ?? null)
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const fila: Valor = {
            id: siguienteId(bd.fiscal.valores),
            pais: 'GT',
            empresa_id: empresaId,
            clave,
            valor: cuerpo.valor,
            vigente_desde: vigenteDesde,
            origen: 'usuario',
            motivo: String(cuerpo.motivo).trim(),
            creado_por: usuario?.id ?? null,
            created_at: ahora(),
            nivel: global ? 'global' : 'empresa',
        }
        bd.fiscal.valores.push(fila)
        registrarAccion(solicitud, 'fiscal.editar_parametros', { tipo: 'parametro_fiscal', id: fila.id }, cuerpo)
        const creado: Schema<'ValorParametroCreado'> = { ...fila, nivel: global ? 'global' : 'empresa', anterior }
        return { status: 201, cuerpo: creado }
    })),

    'POST /api/v1/fiscal/regimen': conPermiso('fiscal.cambiar_regimen', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = fechaInvalida(cuerpo.vigente_desde)
        if (!esRegimen(cuerpo.regimen)) {
            errores.push({ field: 'regimen', message: `Una de: ${REGIMENES.join(', ')}`, rule: 'enum' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const empresaId = empresaDe(solicitud, cuerpo)
        if (typeof empresaId !== 'number') {
            return empresaId
        }
        const regimen = cuerpo.regimen as Regimen
        const vigenteDesde = String(cuerpo.vigente_desde)
        const filas = valoresDe(empresaId, 'regimen')
        const primera = !filas.some(f => f.empresa_id === empresaId && f.origen === 'usuario')
        const hoy = hoyGuatemala()
        const aviso = typeof cuerpo.aviso_sat === 'object' && cuerpo.aviso_sat !== null ? cuerpo.aviso_sat as { numero?: unknown, fecha?: unknown } : null
        const fueraDePlazo = (campo: string, detalle: string) => problemaTipado(422, 'regimen_fuera_de_plazo', 'Régimen fuera de plazo', detalle, [{ field: campo, message: detalle, rule: 'regimen_fuera_de_plazo' }])
        let avisoSat: Schema<'RegimenCambiado'>['aviso_sat'] = null
        if (!primera) {
            const [anio = 0, mes = 0, dia = 0] = vigenteDesde.split('-').map(Number)
            if (mes !== 1 || dia !== 1 || anio <= Number(hoy.slice(0, 4))) {
                return fueraDePlazo('vigente_desde', `El cambio de régimen rige desde el 1 de enero de un año futuro (LAT, art. 51); ${vigenteDesde} no lo es`)
            }
            if (typeof aviso?.numero !== 'string' || !aviso.numero.trim() || typeof aviso.fecha !== 'string' || !aviso.fecha) {
                return datosInvalidos([{ field: 'aviso_sat', message: 'El cambio de régimen exige el número y la fecha del aviso a la SAT', rule: 'required' }])
            }
            if (!aviso.fecha.startsWith(`${anio - 1}-12`) || aviso.fecha > hoy) {
                return fueraDePlazo('aviso_sat.fecha', `El aviso a la SAT se presenta en diciembre de ${anio - 1}, antes del nuevo periodo (LAT, art. 51), y no puede ser futuro`)
            }
            avisoSat = { numero: aviso.numero.trim(), fecha: aviso.fecha }
        }
        else if (typeof aviso?.numero === 'string' && aviso.numero.trim() && typeof aviso.fecha === 'string') {
            avisoSat = { numero: aviso.numero.trim(), fecha: aviso.fecha }
        }
        const anteriorValor = resolverValor(empresaId, 'regimen', vigenteDesde)?.valor
        const anterior = typeof anteriorValor === 'string' ? anteriorValor : null
        if (!primera && anterior === regimen) {
            return datosInvalidos([{ field: 'regimen', message: `La empresa ya está en ${regimen} en esa fecha`, rule: 'sin_cambio' }])
        }
        const bloqueada = vigenciaBloqueada(empresaId, vigenteDesde)
        if (bloqueada) {
            return bloqueada
        }
        if (filas.some(f => f.empresa_id === empresaId && f.origen === 'usuario' && f.vigente_desde === vigenteDesde)) {
            return datosInvalidos([{ field: 'vigente_desde', message: 'Ya hay un régimen con esa vigencia', rule: 'vigencia_duplicada' }])
        }
        const motivo = [
            primera ? 'Primera configuración del régimen' : 'Cambio de régimen',
            avisoSat ? `aviso SAT ${avisoSat.numero} del ${avisoSat.fecha}` : null,
            textoONull(cuerpo.motivo),
        ].filter(Boolean).join('; ')
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const fila: Valor = {
            id: siguienteId(bd.fiscal.valores),
            pais: 'GT',
            empresa_id: empresaId,
            clave: 'regimen',
            valor: regimen,
            vigente_desde: vigenteDesde,
            origen: 'usuario',
            motivo,
            creado_por: usuario?.id ?? null,
            created_at: ahora(),
            nivel: 'empresa',
        }
        bd.fiscal.valores.push(fila)
        registrarAccion(solicitud, 'fiscal.cambiar_regimen', { tipo: 'parametro_fiscal', id: fila.id }, cuerpo)
        const respuesta: Schema<'RegimenCambiado'> = {
            empresa_id: empresaId,
            regimen,
            vigente_desde: vigenteDesde,
            anterior,
            primera_configuracion: primera,
            aviso_sat: avisoSat,
            valor_id: fila.id,
            frases: frasesVigentes(empresaId, vigenteDesde),
        }
        return { status: 201, cuerpo: respuesta }
    })),

    'GET /api/v1/fiscal/impuestos': conPermiso('fiscal.ver', (solicitud) => {
        const empresaId = empresaDe(solicitud)
        if (typeof empresaId !== 'number') {
            return empresaId
        }
        const fecha = fechaDe(solicitud)
        if (typeof fecha !== 'string') {
            return fecha
        }
        const codigos = [...new Set(bd.fiscal.impuestos.map(i => i.codigo))].sort()
        const impuestos = codigos
            .map(codigo => impuestoVigente(empresaId, codigo, fecha))
            .filter((i): i is Impuesto => i !== null)
        const cuerpo: Schema<'ImpuestosFiscales'> = { empresa_id: empresaId, fecha, pais: 'GT', impuestos }
        return { status: 200, cuerpo }
    }),

    'GET /api/v1/fiscal/impuestos/:codigo/historial': conPermiso('fiscal.ver', (solicitud) => {
        const empresaId = empresaDe(solicitud)
        if (typeof empresaId !== 'number') {
            return empresaId
        }
        const fecha = fechaDe(solicitud)
        if (typeof fecha !== 'string') {
            return fecha
        }
        const codigo = solicitud.params.codigo ?? ''
        const versiones = versionesImpuesto(empresaId, codigo)
        if (!versiones.length) {
            return noEncontrado(`el impuesto ${codigo}`)
        }
        const cuerpo: Schema<'HistorialImpuestoFiscal'> = { vigente: impuestoVigente(empresaId, codigo, fecha), versiones }
        return { status: 200, cuerpo }
    }),

    'POST /api/v1/fiscal/impuestos/:codigo/versiones': conPermiso('fiscal.editar_parametros', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = [...fechaInvalida(cuerpo.vigente_desde), ...motivoInvalido(cuerpo.motivo)]
        // El validador VineJS rechaza el signo: la tasa va en positivo (`^\d{1,3}(\.\d{1,6})?$`).
        if (typeof cuerpo.tasa !== 'string' || !PORCENTAJE.test(cuerpo.tasa)) {
            errores.push({ field: 'tasa', message: 'El campo tasa no tiene un formato válido', rule: 'regex' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const global = cuerpo.ambito === 'global'
        let empresaId: number | null = null
        if (global) {
            if (!alcanceGlobal(solicitud)) {
                return problemaTipado(403, 'alcance_global_requerido', 'Alcance global requerido', 'Un valor global afecta a todas las empresas: requiere un usuario con alcance global')
            }
        }
        else {
            const empresa = empresaDe(solicitud, cuerpo)
            if (typeof empresa !== 'number') {
                return empresa
            }
            empresaId = empresa
        }
        const codigo = solicitud.params.codigo ?? ''
        const vigenteDesde = String(cuerpo.vigente_desde)
        const versiones = bd.fiscal.impuestos.filter(i => i.codigo === codigo && (i.empresa_id === null || i.empresa_id === empresaId))
        if (!versiones.length) {
            return noEncontrado(`el impuesto ${codigo}`)
        }
        const tasa = String(cuerpo.tasa)
        if (new Decimal(tasa).gt(100)) {
            return problemaTipado(422, 'parametro_fuera_de_rango', 'Parámetro fuera de rango', 'El valor no es válido para el parámetro', [{ field: 'tasa', message: 'Por ciento positivo, de 0 a 100 ("12.00"); el signo de la retención no se escribe', rule: 'tasa' }])
        }
        const bloqueada = vigenciaBloqueada(empresaId, vigenteDesde)
        if (bloqueada) {
            return bloqueada
        }
        if (versiones.some(v => v.empresa_id === empresaId && v.origen === 'usuario' && v.vigente_desde === vigenteDesde)) {
            return vigenciaDuplicada(`${codigo} ya tiene una versión ${global ? 'global' : 'de la empresa'} con vigencia ${vigenteDesde}; use otra fecha`)
        }
        const base = (empresaId === null ? ultima(versiones.filter(v => v.empresa_id === null), vigenteDesde) : impuestoVigente(empresaId, codigo, vigenteDesde)) ?? versiones.at(-1)
        if (!base) {
            return noEncontrado(`el impuesto ${codigo}`)
        }
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const version: Impuesto = {
            ...base,
            id: siguienteId(bd.fiscal.impuestos),
            empresa_id: empresaId,
            vigente_desde: vigenteDesde,
            origen: 'usuario',
            tasa: new Decimal(tasa).toFixed(Math.max(2, tasa.split('.')[1]?.length ?? 0)),
            activo: cuerpo.activo !== false,
            motivo: String(cuerpo.motivo).trim(),
            creado_por: usuario?.id ?? null,
            created_at: ahora(),
            nivel: global ? 'global' : 'empresa',
        }
        bd.fiscal.impuestos.push(version)
        registrarAccion(solicitud, 'fiscal.editar_impuesto', { tipo: 'impuesto_fiscal', id: version.id }, cuerpo)
        return { status: 201, cuerpo: version }
    })),

    'GET /api/v1/fiscal/establecimientos': conPermiso('fiscal.ver', (solicitud) => {
        if (solicitud.query.get('empresas') === 'todas') {
            return { status: 200, cuerpo: [...bd.fiscal.establecimientos].sort((a, b) => a.empresa_id - b.empresa_id || a.codigo - b.codigo) }
        }
        const empresaId = empresaDe(solicitud)
        if (typeof empresaId !== 'number') {
            return empresaId
        }
        return { status: 200, cuerpo: bd.fiscal.establecimientos.filter(e => e.empresa_id === empresaId).sort((a, b) => a.codigo - b.codigo) }
    }),

    'GET /api/v1/fiscal/establecimientos/:id': conPermiso('fiscal.ver', (solicitud) => {
        const establecimiento = bd.fiscal.establecimientos.find(e => e.id === idDe(solicitud))
        return establecimiento ? { status: 200, cuerpo: establecimiento } : noEncontrado('el establecimiento')
    }),

    'POST /api/v1/fiscal/establecimientos': conPermiso('fiscal.configurar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = erroresEstablecimiento(cuerpo, true)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const empresaId = empresaDe(solicitud, cuerpo)
        if (typeof empresaId !== 'number') {
            return empresaId
        }
        const codigo = Number(cuerpo.codigo)
        const propios = bd.fiscal.establecimientos.filter(e => e.empresa_id === empresaId)
        const repetido = propios.find(e => e.codigo === codigo)
        if (repetido) {
            return problemaTipado(409, 'establecimiento_duplicado', 'Establecimiento duplicado', `La empresa ya tiene el establecimiento ${codigo} (${repetido.id})`)
        }
        const porDefecto = propios.length === 0 || cuerpo.por_defecto === true
        if (porDefecto) {
            for (const otro of propios.filter(e => e.por_defecto)) {
                Object.assign(otro, { por_defecto: false, version: otro.version + 1, updated_at: ahora() })
            }
        }
        const momento = ahora()
        const establecimiento: Schema<'EstablecimientoFiscal'> = {
            id: siguienteId(bd.fiscal.establecimientos),
            empresa_id: empresaId,
            codigo,
            nombre: String(cuerpo.nombre).trim(),
            direccion: textoONull(cuerpo.direccion),
            municipio: textoONull(cuerpo.municipio),
            departamento: textoONull(cuerpo.departamento),
            activo: true,
            por_defecto: porDefecto,
            version: 1,
            created_at: momento,
            updated_at: momento,
        }
        bd.fiscal.establecimientos.push(establecimiento)
        registrarAccion(solicitud, 'fiscal.crear_establecimiento', { tipo: 'establecimiento', id: establecimiento.id }, cuerpo)
        return { status: 201, cuerpo: establecimiento }
    })),

    'PUT /api/v1/fiscal/establecimientos/:id': conPermiso('fiscal.configurar', (solicitud) => {
        const actual = bd.fiscal.establecimientos.find(e => e.id === idDe(solicitud))
        if (!actual) {
            return noEncontrado('el establecimiento')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = erroresEstablecimiento(cuerpo, false)
        if (errores.length) {
            return datosInvalidos(errores)
        }
        if (cuerpo.version !== actual.version) {
            return versionCambiada()
        }
        const despues = {
            nombre: textoONull(cuerpo.nombre) ?? actual.nombre,
            direccion: 'direccion' in cuerpo ? textoONull(cuerpo.direccion) : actual.direccion,
            municipio: 'municipio' in cuerpo ? textoONull(cuerpo.municipio) : actual.municipio,
            departamento: 'departamento' in cuerpo ? textoONull(cuerpo.departamento) : actual.departamento,
            activo: typeof cuerpo.activo === 'boolean' ? cuerpo.activo : actual.activo,
            por_defecto: typeof cuerpo.por_defecto === 'boolean' ? cuerpo.por_defecto : actual.por_defecto,
        }
        if (actual.por_defecto && (!despues.por_defecto || !despues.activo)) {
            return problemaTipado(422, 'establecimiento_por_defecto', 'Regla de negocio', 'El establecimiento por defecto no se desmarca ni se desactiva: marque otro como por defecto primero')
        }
        if (despues.por_defecto && !despues.activo) {
            return problemaTipado(422, 'establecimiento_por_defecto', 'Regla de negocio', 'Un establecimiento inactivo no puede ser el por defecto')
        }
        if (despues.por_defecto && !actual.por_defecto) {
            for (const otro of bd.fiscal.establecimientos.filter(e => e.empresa_id === actual.empresa_id && e.por_defecto)) {
                Object.assign(otro, { por_defecto: false, version: otro.version + 1, updated_at: ahora() })
            }
        }
        Object.assign(actual, despues, { version: actual.version + 1, updated_at: ahora() })
        registrarAccion(solicitud, 'fiscal.editar_establecimiento', { tipo: 'establecimiento', id: actual.id }, cuerpo)
        return { status: 200, cuerpo: actual }
    }),

    'GET /api/v1/fiscal/frases': conPermiso('fiscal.ver', (solicitud) => {
        const empresaId = empresaDe(solicitud)
        if (typeof empresaId !== 'number') {
            return empresaId
        }
        const fecha = fechaDe(solicitud)
        if (typeof fecha !== 'string') {
            return fecha
        }
        const historial = bd.fiscal.frases
            .filter(f => f.empresa_id === empresaId)
            .sort((a, b) => (a.vigente_desde ?? '').localeCompare(b.vigente_desde ?? '') || (a.id ?? 0) - (b.id ?? 0))
        const cuerpo: Schema<'FrasesFiscales'> = { empresa_id: empresaId, fecha, vigentes: frasesVigentes(empresaId, fecha), historial }
        return { status: 200, cuerpo }
    }),

    'POST /api/v1/fiscal/frases': conPermiso('fiscal.configurar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores = [...fechaInvalida(cuerpo.vigente_desde), ...motivoInvalido(cuerpo.motivo)]
        for (const campo of ['tipo_frase', 'escenario'] as const) {
            const valor = cuerpo[campo]
            if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1) {
                errores.push({ field: campo, message: `El campo ${campo} debe ser un número entero mayor que 0`, rule: 'min' })
            }
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const empresaId = empresaDe(solicitud, cuerpo)
        if (typeof empresaId !== 'number') {
            return empresaId
        }
        const tipoFrase = Number(cuerpo.tipo_frase)
        const escenario = Number(cuerpo.escenario)
        const delRegimen = Object.values(FRASES_REGIMEN).flat().find(f => f.tipo_frase === tipoFrase && f.escenario === escenario)
        if (delRegimen) {
            return problemaTipado(422, 'frase_del_regimen', 'Regla de negocio', `La frase ${tipoFrase}-${escenario} sale del régimen (${delRegimen.clave}): cambie el régimen`)
        }
        const clave = `manual:${tipoFrase}-${escenario}`
        const vigenteDesde = String(cuerpo.vigente_desde)
        const activa = cuerpo.activa !== false
        const previa = manualesEn(empresaId, vigenteDesde).find(f => f.clave === clave)
        let texto = textoONull(cuerpo.texto) ?? ''
        let tipos = Array.isArray(cuerpo.tipos_dte) ? cuerpo.tipos_dte.filter((t): t is string => typeof t === 'string') : []
        if (!activa) {
            if (!previa?.activa) {
                return problemaTipado(422, 'frase_inactiva', 'Regla de negocio', `La frase ${clave} no está activa al ${vigenteDesde}`)
            }
            texto ||= previa.texto
            if (tipos.length === 0) {
                tipos = previa.tipos_dte
            }
        }
        const invalidos: Errores = []
        if (!texto) {
            invalidos.push({ field: 'texto', message: 'El texto de la frase es obligatorio', rule: 'required' })
        }
        if (tipos.length === 0) {
            invalidos.push({ field: 'tipos_dte', message: 'Al menos un tipo de DTE', rule: 'required' })
        }
        tipos.forEach((tipo, indice) => {
            if (!(TIPOS_DTE_GT as readonly string[]).includes(tipo)) {
                invalidos.push({ field: `tipos_dte.${indice}`, message: `Tipo de DTE desconocido; uno de: ${TIPOS_DTE_GT.join(', ')}`, rule: 'enum' })
            }
        })
        if (invalidos.length) {
            return datosInvalidos(invalidos)
        }
        const bloqueada = vigenciaBloqueada(empresaId, vigenteDesde)
        if (bloqueada) {
            return bloqueada
        }
        if (previa?.vigente_desde === vigenteDesde) {
            return vigenciaDuplicada(`La frase ${clave} ya tiene un cambio con vigencia ${vigenteDesde}; use otra fecha`)
        }
        const resolucion = typeof cuerpo.resolucion === 'object' && cuerpo.resolucion !== null ? cuerpo.resolucion as { numero?: unknown, fecha?: unknown } : null
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const frase: Frase = {
            id: siguienteId(bd.fiscal.frases.map(f => ({ id: f.id ?? 0 }))),
            empresa_id: empresaId,
            clave,
            tipo_frase: tipoFrase,
            escenario,
            texto,
            tipos_dte: tipos,
            origen: 'manual',
            activa,
            vigente_desde: vigenteDesde,
            resolucion: resolucion && typeof resolucion.numero === 'string' && typeof resolucion.fecha === 'string' ? { numero: resolucion.numero.trim(), fecha: resolucion.fecha } : null,
            confirmar_contador: false,
            fuente: null,
            motivo: String(cuerpo.motivo).trim(),
            creado_por: usuario?.id ?? null,
            created_at: ahora(),
        }
        bd.fiscal.frases.push(frase)
        registrarAccion(solicitud, 'fiscal.agregar_frase', { tipo: 'frase', id: frase.id ?? 0 }, cuerpo)
        return { status: 201, cuerpo: frase }
    })),
}
