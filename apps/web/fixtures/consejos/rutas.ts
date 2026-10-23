import Decimal from 'decimal.js'
import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { hoyGuatemala } from '~/utils/cobro'
import { bd, siguienteId } from '../bd'
import { conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, empresaActivaDe, empresasDeLista, noEncontrado, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'
import { compararEmpresa } from '../comparador/rutas'
import { resolverValor } from '../fiscal/rutas'
import { tableroEmpresa } from '../tablero/rutas'

/**
 * Consejos fiscales (A3, fase 8 PR C; `app/fiscal/consejos.ts` y `l10n/gt/consejos.ts`). Cada consejo se
 * evalúa solo con los bloques del tablero y del comparador de los fixtures (los mismos de sus pantallas)
 * y los parámetros vigentes: un bloque fuente en error deja el consejo `sin_datos` con su problema; uno
 * que no aplica, `no_aplica` con su motivo. Ocultar y mostrar (`fiscal.ocultar_consejo`) insertan filas
 * en `bd.consejosOcultos`; la del usuario manda sobre la de la empresa.
 */

type Consejo = Schema<'ConsejoFiscal'>
type Fuente = 'tablero.vencimientos' | 'tablero.isr' | 'tablero.pequeno_contribuyente' | 'tablero.libros' | 'tablero.fel' | 'comparador.datos' | 'comparador.comparacion'
type Datos = Record<string, string | number | boolean | null>
type Bloque = { estado: 'ok' | 'error' | 'no_aplica', motivo: string | null, error: Problem | null, datos: unknown }

const AVISO = 'Referencia; valídelo con su contador'
/** Valores del paquete gt-2026.1 que el paquete del fixture no trae. */
const PAQUETE: Record<string, unknown> = { isr_trimestral_metodo: 'renta_presunta', isr_trimestral_presunta: '8.00' }

interface Entrada {
    regimen: string | null
    // Los bloques fuente en `ok`, tal como los da la API (objetos de su esquema).
    bloques: Partial<Record<Fuente, Record<string, unknown>>>
    parametro: (clave: string) => unknown
}

interface Resultado {
    aplica: boolean
    texto?: string
    datos?: Datos
    no_aplica?: string
}

interface Definicion {
    clave: string
    titulo: string
    fuente: string
    confirmar_contador: boolean
    fuentes: Fuente[]
    evaluar: (e: Entrada) => Resultado
}

interface ObligacionVencimiento {
    impuesto: string
    nombre: string
    vencida: boolean
    a_pagar: string | null
    mora_estimada: string | null
}

const num = (v: unknown) => new Decimal(v === null || v === undefined ? '0' : String(v))
const texto = (d: Decimal) => d.toFixed(2)
const suma = (xs: unknown[]) => xs.reduce<Decimal>((s, x) => s.plus(num(x)), new Decimal(0))

const CATALOGO: Definicion[] = [
    {
        clave: 'pago_antes_requerimiento',
        titulo: 'Pague lo vencido antes del requerimiento',
        fuente: 'inv. E.2 (Código Tributario, rebaja de la mora y de los intereses)',
        confirmar_contador: true,
        fuentes: ['tablero.vencimientos'],
        evaluar: (e) => {
            const obligaciones = e.bloques['tablero.vencimientos']?.obligaciones as ObligacionVencimiento[]
            const vencidas = obligaciones.filter(o => o.vencida && o.a_pagar !== null && num(o.a_pagar).gt(0))
            if (!vencidas.length) {
                return { aplica: false }
            }
            const mora = texto(suma(vencidas.map(o => o.mora_estimada)))
            return {
                aplica: true,
                texto: `Tiene ${vencidas.length} declaración(es) vencida(s) con impuesto por pagar (mora estimada Q${mora} según el tablero). Pagar antes de que la SAT lo requiera rebaja la mora en 85 % y los intereses en 50 %`,
                datos: { vencidas: vencidas.length, mora_estimada: mora },
            }
        },
    },
    {
        clave: 'retenciones_sin_enterar',
        titulo: 'Entere las retenciones',
        fuente: 'inv. E.2; LAT (el gasto con retención no es deducible hasta enterarla)',
        confirmar_contador: true,
        fuentes: ['tablero.vencimientos'],
        evaluar: (e) => {
            const obligaciones = e.bloques['tablero.vencimientos']?.obligaciones as ObligacionVencimiento[]
            const pendientes = obligaciones.filter(o => o.impuesto.startsWith('retenciones_') && o.a_pagar !== null && num(o.a_pagar).gt(0))
            if (!pendientes.length) {
                return { aplica: false }
            }
            const monto = texto(suma(pendientes.map(o => o.a_pagar)))
            return {
                aplica: true,
                texto: `Hay Q${monto} de retenciones por enterar (${pendientes.map(o => o.nombre).join(', ')}). El gasto de las compras con retención no es deducible hasta enterarla`,
                datos: { declaraciones: pendientes.length, a_pagar: monto },
            }
        },
    },
    {
        clave: 'iso_por_vencer',
        titulo: 'ISO por vencer sin acreditar',
        fuente: 'inv. A.4 (Ley ISO: acreditable al ISR en los 3 años siguientes)',
        confirmar_contador: true,
        fuentes: ['tablero.isr'],
        evaluar: (e) => {
            const anual = e.bloques['tablero.isr']?.anual as { totales: Record<string, string> } | null
            if (!anual) {
                return { aplica: false, no_aplica: `regimen_${e.regimen}` }
            }
            if (!num(anual.totales.iso_por_vencer).gt(0)) {
                return { aplica: false }
            }
            return {
                aplica: true,
                texto: `Q${anual.totales.iso_por_vencer} de ISO vencen este año sin acreditar al ISR: en el cierre anual pasarán a gasto (5.3.03)`,
                datos: { iso_por_vencer: anual.totales.iso_por_vencer ?? null },
            }
        },
    },
    {
        clave: 'forma_pago_trimestral',
        titulo: 'Forma del pago trimestral del ISR según su margen',
        fuente: 'inv. A.2 (LAT, art. 38: renta presunta o cierres parciales; cambiarla exige autorización de la SAT)',
        confirmar_contador: true,
        fuentes: ['comparador.datos'],
        evaluar: (e) => {
            if (e.regimen !== 'utilidades') {
                return { aplica: false, no_aplica: `regimen_${e.regimen}` }
            }
            const datos = e.bloques['comparador.datos']!
            const metodo = e.parametro('isr_trimestral_metodo')
            const presunta = num(e.parametro('isr_trimestral_presunta'))
            if (!num(datos.ventas_sin_iva).gt(0)) {
                return { aplica: false }
            }
            const margen = num(datos.margen_fiscal)
            const conviene = metodo === 'renta_presunta' && margen.lt(presunta)
                ? 'cierre_parcial'
                : metodo === 'cierre_parcial' && margen.gt(presunta) ? 'renta_presunta' : null
            if (!conviene) {
                return { aplica: false }
            }
            return {
                aplica: true,
                texto: `Su margen fiscal de los últimos meses es ${texto(margen)} % y la renta presunta es ${texto(presunta)} %: con ${conviene === 'cierre_parcial' ? 'cierres parciales' : 'renta presunta'} los pagos trimestrales serían menores. Cambiar la forma exige autorización de la SAT`,
                datos: { margen_fiscal: texto(margen), renta_presunta: texto(presunta), metodo: String(metodo), sugerido: conviene },
            }
        },
    },
    {
        clave: 'regimen_simulado',
        titulo: 'El otro régimen pagaría menos según la simulación',
        fuente: 'inv. E.1 (comparador de regímenes)',
        confirmar_contador: true,
        fuentes: ['comparador.comparacion'],
        evaluar: (e) => {
            const c = e.bloques['comparador.comparacion']!
            if (e.regimen !== 'utilidades' && e.regimen !== 'opcional_simplificado') {
                return { aplica: false, no_aplica: `regimen_${e.regimen}` }
            }
            if (c.menor === 'iguales' || c.menor === e.regimen) {
                return { aplica: false }
            }
            const diferencia = texto(num(c.diferencia).abs())
            const equilibrio = c.margen_equilibrio as string | null
            return {
                aplica: true,
                texto: `Con sus datos de los últimos meses el régimen ${c.menor === 'utilidades' ? 'sobre utilidades' : 'opcional simplificado'} pagaría Q${diferencia} menos de ISR al año (margen ${String(c.margen_fiscal)} %, equilibrio ${equilibrio ?? '—'} %). Es una simulación: el cambio se avisa a la SAT en diciembre y rige el 1 de enero; el sistema no lo hace`,
                datos: { menor: String(c.menor), diferencia, margen_fiscal: String(c.margen_fiscal), margen_equilibrio: equilibrio },
            }
        },
    },
    {
        clave: 'limite_pequeno',
        titulo: 'Cerca del límite del pequeño contribuyente',
        fuente: 'inv. A.3 (Ley IVA, art. 45)',
        confirmar_contador: false,
        fuentes: ['tablero.pequeno_contribuyente'],
        evaluar: (e) => {
            const p = e.bloques['tablero.pequeno_contribuyente']!
            if (p.umbral_alcanzado === null) {
                return { aplica: false }
            }
            const [acumulado, limite, porcentaje] = [String(p.acumulado), String(p.limite), String(p.porcentaje)]
            return {
                aplica: true,
                texto: p.supera_limite
                    ? `Facturó Q${acumulado} este año y superó el límite de Q${limite}: debe pasar al régimen general`
                    : `Facturó Q${acumulado} este año (${porcentaje} % del límite de Q${limite}): planifique el paso al régimen general si lo supera`,
                datos: { acumulado, limite, porcentaje },
            }
        },
    },
    {
        clave: 'libros_atrasados',
        titulo: 'Emita los libros atrasados',
        fuente: 'inv. B.1 y E.2 (Código Tributario, art. 94: multa por libros atrasados)',
        confirmar_contador: true,
        fuentes: ['tablero.libros'],
        evaluar: (e) => {
            const l = e.bloques['tablero.libros']!
            const atrasados = (l.libros as { libro: string, al_dia: boolean, meses_atrasados: number }[]).filter(x => !x.al_dia)
            if (!atrasados.length) {
                return { aplica: false }
            }
            return {
                aplica: true,
                texto: `Libros con meses sin emitir fuera del plazo de ${String(l.ventana_meses)} meses: ${atrasados.map(x => `${x.libro} (${x.meses_atrasados})`).join(', ')}. Emítalos con folio para evitar la multa`,
                datos: { libros: atrasados.length },
            }
        },
    },
    {
        clave: 'fel_desactivada',
        titulo: 'Active la FEL',
        fuente: 'inv. C (SAT: la FEL es obligatoria)',
        confirmar_contador: false,
        fuentes: ['tablero.fel'],
        evaluar: (e) => {
            const f = e.bloques['tablero.fel']!
            if (!f.alerta) {
                return { aplica: false }
            }
            return { aplica: true, texto: String(f.alerta), datos: { modo: String(f.modo) } }
        },
    },
]

/** Oculto vigente: la última fila del usuario manda; si no tiene, la última de la empresa. */
function ocultoVigente(empresaId: number, clave: string, usuarioId: number | null): { oculto: boolean, por: 'empresa' | 'usuario' | null } {
    const filas = bd.consejosOcultos.filter(f => f.empresa_id === empresaId && f.clave === clave).sort((a, b) => a.id - b.id)
    const delUsuario = usuarioId === null ? undefined : filas.filter(f => f.usuario_id === usuarioId).at(-1)
    if (delUsuario) {
        return { oculto: delUsuario.oculto, por: delUsuario.oculto ? 'usuario' : null }
    }
    const deEmpresa = filas.filter(f => f.usuario_id === null).at(-1)
    return deEmpresa?.oculto ? { oculto: true, por: 'empresa' } : { oculto: false, por: null }
}

function consejosEmpresa(empresaId: number, hoy: string, usuarioId: number | null) {
    const tablero = tableroEmpresa(empresaId, hoy)
    const comparador = compararEmpresa(empresaId, hoy, null)
    const bloqueDe = (fuente: Fuente): Bloque => {
        const [origen, nombre] = fuente.split('.') as ['tablero' | 'comparador', string]
        const bloques = (origen === 'tablero' ? tablero.bloques : comparador.bloques) as Record<string, Bloque>
        return bloques[nombre]!
    }
    const parametro = (clave: string) => resolverValor(empresaId, clave, hoy)?.valor ?? PAQUETE[clave] ?? null
    const consejos = CATALOGO.map((def): Consejo => {
        const o = ocultoVigente(empresaId, def.clave, usuarioId)
        const base = { clave: def.clave, titulo: def.titulo, fuente: def.fuente, confirmar_contador: def.confirmar_contador, aviso: AVISO, fuentes: [...def.fuentes], oculto: o.oculto, oculto_por: o.por }
        const bloques = def.fuentes.map(f => [f, bloqueDe(f)] as const)
        const enError = bloques.find(([, b]) => b.estado === 'error')
        if (enError) {
            return { ...base, estado: 'sin_datos', texto: null, datos: null, motivo: `El bloque ${enError[0]} no se pudo calcular`, error: enError[1].error }
        }
        const noAplica = bloques.find(([, b]) => b.estado === 'no_aplica')
        if (noAplica) {
            return { ...base, estado: 'no_aplica', texto: null, datos: null, motivo: noAplica[1].motivo, error: null }
        }
        const r = def.evaluar({ regimen: tablero.regimen, bloques: Object.fromEntries(bloques.map(([f, b]) => [f, b.datos as Record<string, unknown>])), parametro })
        return r.aplica
            ? { ...base, estado: 'aplica', texto: r.texto ?? null, datos: r.datos ?? null, motivo: null, error: null }
            : { ...base, estado: 'no_aplica', texto: null, datos: null, motivo: r.no_aplica ?? null, error: null }
    })
    return { empresa_id: empresaId, regimen: tablero.regimen, consejos }
}

/** `fiscal.ocultar_consejo` (ocultar o mostrar) por empresa o solo para quien lo pide. */
function ocultar(oculto: boolean) {
    return conPermiso('fiscal.configurar', conIdempotencia((solicitud: SolicitudFixture): RespuestaFixture => {
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: NonNullable<Problem['errors']> = []
        if (cuerpo.alcance !== undefined && cuerpo.alcance !== 'empresa' && cuerpo.alcance !== 'usuario') {
            errores.push({ field: 'alcance', message: 'empresa o usuario', rule: 'enum' })
        }
        if (cuerpo.motivo !== undefined && cuerpo.motivo !== null && (typeof cuerpo.motivo !== 'string' || cuerpo.motivo.length > 500)) {
            errores.push({ field: 'motivo', message: 'Hasta 500 caracteres', rule: 'maxLength' })
        }
        if (cuerpo.empresa_id !== undefined && cuerpo.empresa_id !== null && (typeof cuerpo.empresa_id !== 'number' || !Number.isInteger(cuerpo.empresa_id) || cuerpo.empresa_id < 1)) {
            errores.push({ field: 'empresa_id', message: 'Empresa no válida', rule: 'number' })
        }
        if (errores.length) {
            return datosInvalidos(errores)
        }
        const empresaId = typeof cuerpo.empresa_id === 'number' ? cuerpo.empresa_id : empresaActivaDe(solicitud)
        if (empresaId === null) {
            return problemaTipado(422, 'empresa_requerida', 'Empresa requerida', 'Elige la empresa del consejo')
        }
        const permitidas = empresasDeLista(solicitud)
        if (!bd.empresas.some(e => e.id === empresaId) || (permitidas !== null && !permitidas.includes(empresaId))) {
            return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', `La empresa ${empresaId} no está en su alcance`)
        }
        const clave = solicitud.params.clave ?? ''
        if (!CATALOGO.some(c => c.clave === clave)) {
            return noEncontrado(`el consejo ${clave} en el catálogo`)
        }
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        const alcance = cuerpo.alcance === 'usuario' ? 'usuario' as const : 'empresa' as const
        const fila = {
            id: siguienteId(bd.consejosOcultos),
            empresa_id: empresaId,
            clave,
            oculto,
            alcance,
            usuario_id: alcance === 'usuario' ? (usuario?.id ?? null) : null,
            motivo: typeof cuerpo.motivo === 'string' && cuerpo.motivo.trim() ? cuerpo.motivo.trim() : null,
        }
        bd.consejosOcultos.push(fila)
        registrarAccion(solicitud, 'fiscal.ocultar_consejo', { tipo: 'consejo_fiscal', id: fila.id }, { empresa_id: empresaId, clave, oculto, alcance, motivo: fila.motivo })
        const respuesta: Schema<'ConsejoOcultado'> = { id: fila.id, empresa_id: fila.empresa_id, clave, oculto, alcance, usuario_id: fila.usuario_id }
        return { status: 200, cuerpo: respuesta }
    }))
}

export const rutasConsejos: RutasFixture = {
    'GET /api/v1/fiscal/consejos': conPermiso('fiscal.ver', (solicitud) => {
        const pedido = solicitud.query.get('empresas')
        if (pedido !== null && pedido !== '' && pedido !== 'todas') {
            return datosInvalidos([{ field: 'empresas', message: 'Valor no permitido', rule: 'enum' }])
        }
        const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
        if (pedido === 'todas' && usuario?.alcance_global !== true) {
            return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', 'El consolidado de todas las empresas (empresas=todas) requiere alcance global')
        }
        const hoy = hoyGuatemala()
        const ids = empresasDeLista(solicitud) ?? bd.empresas.filter(e => e.activa).map(e => e.id)
        const cuerpo: Schema<'ConsejosFiscales'> = { hoy, aviso: AVISO, empresas: [...ids].sort((a, b) => a - b).map(id => consejosEmpresa(id, hoy, usuario?.id ?? null)) }
        return { status: 200, cuerpo }
    }),
    'POST /api/v1/fiscal/consejos/:clave/ocultar': ocultar(true),
    'POST /api/v1/fiscal/consejos/:clave/mostrar': ocultar(false),
}
