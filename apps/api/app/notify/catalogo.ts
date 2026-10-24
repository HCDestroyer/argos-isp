import Mustache from 'mustache'
import { DateTime } from 'luxon'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { PLANTILLAS_BASE, type PlantillaBase } from '#notify/plantillas_base'
import { tipoDeAviso } from '#notify/configuracion'
import { errorDeSintaxis, renderizar } from '#notify/plantillas'
import { ZONA, fechaCorta, fechaHora, isoFecha, mesAnio } from '#notify/formato'
import { venceRelativo, variablesEmpresa, type Variables } from '#notify/variables'
import { MAXIMO_TEXTO } from '#notify/canales/telegram'
import { ValidacionFallida } from '#shared/errores'
import type { CanalNotificacion } from '#shared/eventos'

/**
 * Catálogo de eventos con plantilla y vista previa (pedido de A4, `a4.md`): el panel deja de
 * copiar a mano las variables de `README.md` y puede mostrar una plantilla renderizada antes de
 * guardarla.
 *
 * - **Eventos**: los de las plantillas de fábrica (`PLANTILLAS_BASE`): avisos al cliente,
 *   recordatorios y alertas al equipo. Son los únicos que tienen fila en `notify.plantillas`.
 * - **Variables**: para los avisos al cliente y los recordatorios, el mismo árbol que arma
 *   `construirVariables` (`variables.ts`) según el evento, con valores de ejemplo coherentes
 *   (`tests/notify/catalogo.spec.ts` compara las claves con las reales, así no se separan). Para
 *   las alertas, `alerta.*` sale de las variables que usan sus plantillas de fábrica (cada alerta
 *   arma las suyas): el ejemplo es el propio nombre entre `‹ ›`.
 * - **Empresa**: la vista previa usa los datos reales de la empresa activa (o la principal), como
 *   el aviso de verdad.
 */

export type GrupoEvento = 'cliente' | 'recordatorio' | 'alerta'
export type TipoVariable = 'texto' | 'numero' | 'booleano'

export interface VariableCatalogo {
    nombre: string
    tipo: TipoVariable
    ejemplo: string
}

export interface GrupoVariables {
    grupo: string
    etiqueta: string
    variables: VariableCatalogo[]
}

export interface EventoCatalogo {
    evento: string
    nombre: string
    grupo: GrupoEvento
    tipo_aviso: string | null
    canales: CanalNotificacion[]
    variables: GrupoVariables[]
}

export interface VistaPrevia {
    evento: string
    canal: CanalNotificacion
    asunto: string | null
    cuerpo: string
    /** Texto que recibe el destinatario: en Telegram el asunto va como primera línea */
    mensaje: string
    /** Variables que la plantilla usa y el evento no trae (se renderizan vacías) */
    variables_desconocidas: string[]
}

// ── Nombres y grupos ─────────────────────────────────────────────────────────────────────────

const NOMBRES: Record<string, string> = {
    'factura.emitida': 'Factura emitida',
    'factura.vencida': 'Factura vencida',
    'servicio.estado_cambiado': 'Cambio de estado del servicio',
    'pago.registrado': 'Pago registrado',
    'pago.registrado.tercero': 'Pago hecho por otro cliente',
    'promesa.creada': 'Promesa creada',
    'promesa.cumplida': 'Promesa cumplida',
    'promesa.incumplida': 'Promesa incumplida',
    'comprobante.recibido': 'Comprobante recibido',
    'comprobante.aprobado': 'Comprobante aprobado',
    'comprobante.rechazado': 'Comprobante rechazado',
    'lealtad.puntos_acumulados': 'Puntos ganados',
    'lealtad.puntos_por_vencer': 'Puntos por vencer',
    'lealtad.referido_calificado': 'Referido calificado',
    'lealtad.canje_reservado': 'Canje registrado',
    'lealtad.canje_aplicado': 'Canje aplicado',
    'lealtad.canje_revertido': 'Canje revertido',
    'sorteo.ganador_notificado': 'Ganador de un sorteo',
    'sorteo.premio_entregado': 'Premio de sorteo entregado',
    'bonificacion.registrada': 'Periodo o cargo sin costo',
}

const ETIQUETAS_GRUPO: Record<string, string> = {
    evento: 'Evento',
    empresa: 'Empresa',
    cliente: 'Cliente',
    servicio: 'Servicio',
    factura: 'Factura',
    recordatorio: 'Recordatorio',
    estado: 'Cambio de estado',
    pago: 'Pago',
    pagador: 'Quién pagó',
    cobro: 'Cobro en caja',
    promesa: 'Promesa',
    comprobante: 'Comprobante',
    lealtad: 'Lealtad',
    referido: 'Referido',
    canje: 'Canje',
    sorteo: 'Sorteo',
    bonificacion: 'Bonificación',
    alerta: 'Alerta',
}

export function grupoDeEvento(evento: string): GrupoEvento {
    if (evento.startsWith('recordatorio.')) return 'recordatorio'
    return evento.startsWith('alerta.') ? 'alerta' : 'cliente'
}

export function nombreDeEvento(evento: string): string {
    const recordatorio = /^recordatorio\.(\d+)$/.exec(evento)
    if (recordatorio) return `Recordatorio de pago ${recordatorio[1]}`
    if (evento.startsWith('alerta.')) {
        const resto = evento.slice('alerta.'.length).replaceAll('_', ' ').replaceAll('.', ' · ')
        return `Alerta al equipo · ${resto}`
    }
    return NOMBRES[evento] ?? evento
}

// ── Ejemplos ─────────────────────────────────────────────────────────────────────────────────

/** Factura de ejemplo que vence `dias` días después de hoy (negativo: ya venció). */
function facturaEjemplo(dias: number, ahora: DateTime): Variables {
    const hoy = ahora.setZone(ZONA).startOf('day')
    const vence = hoy.plus({ days: dias })
    const periodo = vence.startOf('month')
    return {
        id: 5120,
        numero: 'A1B2C3D4-1234567890',
        autorizacion: 'A1B2C3D4-4996-4A1F-B2C3-D4E5F6A7B8C9',
        certificada: true,
        estado: dias < 0 ? 'vencida' : 'emitida',
        total: '200.00',
        total_q: 'Q 200.00',
        saldo: '200.00',
        saldo_q: 'Q 200.00',
        vence: fechaCorta(vence),
        vence_iso: isoFecha(vence),
        periodo: mesAnio(periodo),
        dias_para_vencer: Math.max(dias, 0),
        dias_vencida: Math.max(-dias, 0),
        vence_hoy: dias === 0,
        vencida: dias < 0,
        vence_relativo: venceRelativo(dias),
    }
}

const SERVICIO = {
    id: 812,
    usuario: 'mlopez',
    estado: 'activo',
    direccion: 'Zona 1, Quetzaltenango',
    plan: 'Fibra 50M',
}

function pagoEjemplo(ahora: DateTime): Variables {
    return {
        id: 7310,
        monto: '200.00',
        monto_q: 'Q 200.00',
        metodo: 'caja',
        facturas: '5120',
        fecha: fechaHora(ahora.toJSDate()),
    }
}

const COBRO = {
    id: 940,
    monto: '200.00',
    monto_q: 'Q 200.00',
    partes: 1,
    repartido: false,
    otras_empresas: '',
}

const LEALTAD = {
    programa: 'Puntos Argos',
    puntos: 150,
    puntos_texto: '150 puntos',
    vence: '',
    vence_iso: '',
    saldo: 1250,
    saldo_texto: '1,250 puntos',
}

/** Árbol de variables de ejemplo del evento (mismas claves que `construirVariables`). */
function ejemploDelEvento(evento: string, ahora: DateTime): Variables {
    const v: Variables = {
        evento,
        cliente: { id: 1234, nombre: 'María López', email: 'maria.lopez@ejemplo.gt' },
    }
    const recordatorio = /^recordatorio\.(\d+)$/.exec(evento)
    if (recordatorio) {
        const orden = Number(recordatorio[1])
        const dias = orden === 1 ? -3 : orden === 2 ? 0 : 3
        v.servicio = SERVICIO
        v.factura = facturaEjemplo(-dias, ahora)
        v.recordatorio = { orden, dias }
        return v
    }
    if (evento === 'factura.emitida' || evento === 'factura.vencida') {
        v.servicio = SERVICIO
        v.factura = facturaEjemplo(evento === 'factura.vencida' ? -1 : 15, ahora)
    }
    if (evento === 'servicio.estado_cambiado') {
        v.servicio = { ...SERVICIO, estado: 'suspendido' }
        v.estado = {
            de: 'activo',
            a: 'suspendido',
            motivo: 'saldo vencido',
            es_activo: false,
            es_limitado: false,
            es_suspendido: true,
            es_retirado: false,
        }
    }
    if (evento.startsWith('pago.')) {
        v.pago = pagoEjemplo(ahora)
        v.pagador = { id: 1234, nombre: 'María López' }
        v.cobro = COBRO
        if (evento === 'pago.registrado.tercero') {
            v.pagador = { id: 1301, nombre: 'Juan Pérez' }
            Object.assign(v.pago as Variables, {
                facturas_cliente: 'A1B2C3D4-1234567890',
                varias_facturas: false,
                monto_cliente: '200.00',
                monto_cliente_q: 'Q 200.00',
            })
        }
    }
    if (evento.startsWith('promesa.')) {
        const vence = ahora
            .setZone(ZONA)
            .plus({ days: 5 })
            .set({ hour: 23, minute: 59, second: 0, millisecond: 0 })
        v.servicio = SERVICIO
        v.promesa = {
            id: 61,
            monto: '200.00',
            monto_q: 'Q 200.00',
            vence: fechaHora(vence.toJSDate()),
            vence_iso: vence.toUTC().toISO(),
        }
    }
    if (evento.startsWith('comprobante.')) {
        v.comprobante = {
            id: 3302,
            motivo: evento === 'comprobante.rechazado' ? 'la boleta no corresponde al monto' : '',
            monto: '200.00',
            monto_q: 'Q 200.00',
            referencia: '123456',
            metodo: 'deposito',
            fecha_deposito: fechaCorta(ahora.setZone(ZONA).minus({ days: 1 })),
        }
        if (evento === 'comprobante.aprobado') v.pago = { ...pagoEjemplo(ahora), metodo: 'deposito' }
    }
    if (evento.startsWith('lealtad.')) {
        const vence = ahora.setZone(ZONA).plus({ months: 12 }).startOf('day')
        v.lealtad = { ...LEALTAD, vence: fechaCorta(vence), vence_iso: isoFecha(vence) }
        if (evento === 'lealtad.puntos_acumulados') v.servicio = SERVICIO
        if (evento === 'lealtad.referido_calificado') {
            v.referido = {
                id: 77,
                cliente_id: 1402,
                nombre: 'Ana García',
                puntos: 150,
                puntos_texto: '150 puntos',
            }
        }
        if (evento.startsWith('lealtad.canje_')) {
            v.servicio = SERVICIO
            v.lealtad = {
                ...(v.lealtad as Variables),
                puntos: 500,
                puntos_texto: '500 puntos',
                saldo: 750,
                saldo_texto: '750 puntos',
            }
            v.canje = {
                id: 45,
                premio: 'Q50 de descuento',
                tipo: 'descuento_factura',
                tipo_texto: 'descuento en tu factura',
                es_descuento: true,
                es_mes_gratis: false,
                es_mejora_plan: false,
                es_bien: false,
                es_boletos: false,
                puntos: 500,
                puntos_texto: '500 puntos',
                descuento: evento === 'lealtad.canje_aplicado' ? '50.00' : '',
                descuento_q: evento === 'lealtad.canje_aplicado' ? 'Q 50.00' : '',
                periodo: '',
                motivo: evento === 'lealtad.canje_revertido' ? 'el cliente lo pidió' : '',
            }
            if (evento === 'lealtad.canje_aplicado') v.factura = facturaEjemplo(15, ahora)
        }
    }
    if (evento.startsWith('sorteo.')) {
        const reclamar = ahora
            .setZone(ZONA)
            .plus({ days: 30 })
            .set({ hour: 17, minute: 0, second: 0, millisecond: 0 })
        v.sorteo = {
            id: 12,
            nombre: 'Sorteo de aniversario',
            codigo: 'GAN-7Q4X',
            posicion: 1,
            premio: 'Router Wi-Fi 6',
            premio_tipo: 'bien',
            premio_valor_q: 'Q 300.00',
            reclamar_antes: fechaHora(reclamar.toJSDate()),
            reclamar_antes_iso: reclamar.toUTC().toISO(),
            es_suplente: false,
            sustituye: false,
        }
    }
    if (evento === 'bonificacion.registrada') {
        v.servicio = SERVICIO
        v.bonificacion = {
            id: 88,
            concepto: 'Mes gratis',
            origen: 'mes_gratis',
            origen_texto: 'Mes gratis',
            periodo: mesAnio(ahora.setZone(ZONA).plus({ months: 1 }).startOf('month')),
            bruto_q: 'Q 200.00',
            es_cargo: false,
        }
    }
    return v
}

/** Nombres de variables que usa una plantilla (con el prefijo de la sección que los contiene). */
function nombresUsados(plantilla: string): Array<{ nombre: string; secciones: string[] }> {
    const salida: Array<{ nombre: string; secciones: string[] }> = []
    const recorrer = (tokens: unknown[], secciones: string[]) => {
        for (const token of tokens as Array<[string, string, number, number, unknown[]?]>) {
            const [tipo, nombre] = token
            if (['name', '&', '{', '#', '^'].includes(tipo) && nombre !== '.') {
                salida.push({ nombre, secciones })
            }
            if ((tipo === '#' || tipo === '^') && Array.isArray(token[4])) {
                recorrer(token[4], tipo === '#' ? [nombre, ...secciones] : secciones)
            }
        }
    }
    recorrer(Mustache.parse(plantilla), [])
    return salida
}

/** Ejemplo de alertas: `alerta.*` de sus plantillas de fábrica, con el nombre como valor. */
function ejemploDeAlerta(evento: string): Variables {
    const alerta: Variables = {}
    for (const p of PLANTILLAS_BASE.filter((x) => x.evento === evento)) {
        for (const texto of [p.asunto ?? '', p.cuerpo]) {
            for (const { nombre } of nombresUsados(texto)) {
                if (nombre.startsWith('alerta.')) alerta[nombre.slice('alerta.'.length)] = `‹${nombre}›`
            }
        }
    }
    return { evento, alerta }
}

function aplanar(prefijo: string, valor: unknown, salida: VariableCatalogo[]) {
    if (valor !== null && typeof valor === 'object' && !Array.isArray(valor)) {
        for (const [clave, hijo] of Object.entries(valor)) {
            aplanar(prefijo ? `${prefijo}.${clave}` : clave, hijo, salida)
        }
        return
    }
    const tipo: TipoVariable =
        typeof valor === 'boolean' ? 'booleano' : typeof valor === 'number' ? 'numero' : 'texto'
    salida.push({
        nombre: prefijo,
        tipo,
        ejemplo: valor === null || valor === undefined ? '' : String(valor),
    })
}

/** Variables del ejemplo agrupadas por su primer nivel (evento, empresa, cliente, factura…). */
function agrupar(variables: Variables): GrupoVariables[] {
    return Object.entries(variables).map(([grupo, valor]) => {
        const lista: VariableCatalogo[] = []
        aplanar(grupo, valor, lista)
        return { grupo, etiqueta: ETIQUETAS_GRUPO[grupo] ?? grupo, variables: lista }
    })
}

async function ejemploCompleto(
    cliente: QueryClientContract,
    evento: string,
    empresaId: number | null,
    ahora: DateTime,
): Promise<Variables> {
    const base =
        grupoDeEvento(evento) === 'alerta' ? ejemploDeAlerta(evento) : ejemploDelEvento(evento, ahora)
    // la empresa va segunda, como en el aviso real
    const { evento: nombre, ...resto } = base
    return { evento: nombre, empresa: await variablesEmpresa(cliente, empresaId ?? undefined), ...resto }
}

/** Eventos de las plantillas de fábrica, en el orden en que aparecen. */
export function eventosConPlantilla(): string[] {
    return [...new Set(PLANTILLAS_BASE.map((p) => p.evento))]
}

/** `GET /notificaciones/eventos`: eventos con plantilla y sus variables. */
export async function catalogoEventos(
    cliente: QueryClientContract,
    empresaId: number | null,
    ahora: DateTime = DateTime.utc(),
): Promise<EventoCatalogo[]> {
    const salida: EventoCatalogo[] = []
    for (const evento of eventosConPlantilla()) {
        salida.push({
            evento,
            nombre: nombreDeEvento(evento),
            grupo: grupoDeEvento(evento),
            tipo_aviso: tipoDeAviso(evento),
            canales: [...new Set(PLANTILLAS_BASE.filter((p) => p.evento === evento).map((p) => p.canal))],
            variables: agrupar(await ejemploCompleto(cliente, evento, empresaId, ahora)),
        })
    }
    return salida
}

export interface EntradaVistaPrevia {
    evento: string
    canal: CanalNotificacion
    asunto?: string | null
    cuerpo: string
}

/** Ejemplo del evento ya aplanado (para pruebas y para validar variables). */
export async function ejemploDeEvento(
    cliente: QueryClientContract,
    evento: string,
    empresaId: number | null,
    ahora: DateTime = DateTime.utc(),
): Promise<Variables> {
    return ejemploCompleto(cliente, evento, empresaId, ahora)
}

function existe(variables: Variables, nombre: string): boolean {
    let actual: unknown = variables
    for (const parte of nombre.split('.')) {
        if (actual === null || typeof actual !== 'object' || !(parte in (actual as object))) return false
        actual = (actual as Record<string, unknown>)[parte]
    }
    return true
}

/**
 * `POST /notificaciones/plantillas/vista-previa`: renderiza asunto y cuerpo (sin guardar) con el
 * ejemplo del evento, igual que `crearEnvio` (`renderizar` + `trim`). 422 si el evento no tiene
 * plantilla o el Mustache no es válido (mismo mensaje que al guardar).
 */
export async function vistaPrevia(
    cliente: QueryClientContract,
    entrada: EntradaVistaPrevia,
    empresaId: number | null,
    ahora: DateTime = DateTime.utc(),
): Promise<VistaPrevia> {
    const errores = []
    if (!eventosConPlantilla().includes(entrada.evento)) {
        errores.push({
            field: 'evento',
            rule: 'evento',
            message: `El evento ${entrada.evento} no tiene plantilla`,
        })
    }
    for (const campo of ['asunto', 'cuerpo'] as const) {
        const error = entrada[campo] ? errorDeSintaxis(entrada[campo]!) : null
        if (error) errores.push({ field: campo, rule: 'mustache', message: `Plantilla inválida: ${error}` })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)

    const variables = await ejemploCompleto(cliente, entrada.evento, empresaId, ahora)
    const asunto = entrada.asunto ? renderizar(entrada.asunto, variables).trim() : null
    const cuerpo = renderizar(entrada.cuerpo, variables).trim()
    const desconocidas = new Set<string>()
    for (const texto of [entrada.asunto ?? '', entrada.cuerpo]) {
        for (const { nombre, secciones } of nombresUsados(texto)) {
            const resuelve =
                existe(variables, nombre) || secciones.some((s) => existe(variables, `${s}.${nombre}`))
            if (!resuelve) desconocidas.add(nombre)
        }
    }
    const mensaje =
        entrada.canal === 'telegram'
            ? (asunto ? `${asunto}\n\n${cuerpo}` : cuerpo).slice(0, MAXIMO_TEXTO)
            : cuerpo
    return {
        evento: entrada.evento,
        canal: entrada.canal,
        asunto,
        cuerpo,
        mensaje,
        variables_desconocidas: [...desconocidas].sort(),
    }
}

export type { PlantillaBase }
