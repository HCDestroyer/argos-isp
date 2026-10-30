import type { Schema, paths } from '@argosisp/contracts'
import * as z from 'zod'
import { formatearBytes } from './sesion'

type ClaseApi = Schema<'ClaseQos'>
type ReglaApi = Schema<'ReglaQos'>
type DatosClaseApi = paths['/api/v1/qos/perfiles/{id}/clases']['post']['requestBody']['content']['application/json']
type CambiosClaseApi = paths['/api/v1/qos/clases/{id}']['put']['requestBody']['content']['application/json']
type DatosPerfilApi = paths['/api/v1/qos/perfiles']['post']['requestBody']['content']['application/json']

/**
 * QoS por clases (`contratos/qos.md`): textos, resumen de reglas y los formularios de perfil y clase
 * (zod espejo de `crearClaseQosValidator` / `editarClaseQosValidator` y de `problemasReglas()` de A2,
 * con los mismos nombres de campo que los `field` de los 422: `reglas.0.puertos_destino`).
 */

export type ProtocoloQos = NonNullable<ReglaApi['protocolo']>
export const CUALQUIERA = 'cualquiera'
export type ProtocoloFormulario = ProtocoloQos | typeof CUALQUIERA

export const PROTOCOLOS_QOS = ['tcp', 'udp', 'icmp'] as const satisfies readonly ProtocoloQos[]
export const QOS_MAX_REGLAS = 10
export const QOS_MAX_CLASES = 8

export const ETIQUETAS_PROTOCOLO: Record<ProtocoloFormulario, string> = {
    cualquiera: 'Cualquiera',
    tcp: 'TCP',
    udp: 'UDP',
    icmp: 'ICMP',
}

/**
 * Ayuda corta de la pantalla (§2 y §3.5). La última línea es la decisión §3.5: la prioridad ordena
 * el tráfico cuando el nodo del plan (reuso) o el enlace del router se llenan; dentro del MIR de un
 * cliente solo no hay cuello y no reordena nada.
 */
export const AYUDA_QOS = [
    'Funciona con el control «Árbol de colas con PCQ» y exige «Verificar FastTrack»: lo acelerado por FastTrack no pasa por mangle y no se clasifica. Se prende por router (o por plan) con el extra «Prioridad por clases (QoS)».',
    'La prioridad actúa cuando el plan o el router se llenan (reuso o capacidad del enlace): ahí lo interactivo y la web pasan antes que las descargas; si sobra ancho, cada clase usa lo que quiera.',
    'Un cliente que usa varias clases a la vez puede pasar la velocidad de su plan, salvo que los topes sumen 100 % o menos. «Web» y «Streaming» no se separan por puerto (TLS y QUIC): usa la lista de destino que mantienes en el router.',
] as const

/** Clase de descargas pesadas: reclasifica por `connection-bytes`. */
export const esDescargaQos = (c: Pick<ClaseApi, 'bytes_minimo'>): boolean => c.bytes_minimo !== null

/** «UDP 53,123» · «TCP 443 → argosisp-qos-streaming» · «DSCP 46». */
export function textoRegla(r: ReglaApi): string {
    const partes = [
        r.protocolo ? ETIQUETAS_PROTOCOLO[r.protocolo] : null,
        r.puertos_destino ? `destino ${r.puertos_destino}` : null,
        r.puertos_origen ? `origen ${r.puertos_origen}` : null,
        r.dscp !== null ? `DSCP ${r.dscp}` : null,
        r.lista_destino ? `→ ${r.lista_destino}` : null,
    ].filter(Boolean)
    return partes.length ? partes.join(' ') : 'sin criterio'
}

/** Resumen de una clase para la tabla: lo que la identifica. */
export function resumenReglas(clase: ClaseApi, clases: readonly ClaseApi[]): string {
    if (clase.es_resto) {
        return 'Todo lo que no coincide con otra clase'
    }
    if (esDescargaQos(clase)) {
        const origenes = clase.reclasifica_de.map(id => clases.find(c => c.id === id)?.nombre ?? `clase ${id}`).join(' y ')
        const extra = clase.reglas.length ? ` (${clase.reglas.map(textoRegla).join(' · ')})` : ''
        return `Conexiones de ${origenes || '—'} que pasan ${formatearBytes(clase.bytes_minimo ?? 0)}${extra}`
    }
    return clase.reglas.map(textoRegla).join(' · ') || 'Sin reglas'
}

/** Tipo de clase para la etiqueta de la tabla. */
export function tipoClase(clase: Pick<ClaseApi, 'es_resto' | 'bytes_minimo'>): { etiqueta: string, icono: string } {
    if (clase.es_resto) {
        return { etiqueta: 'Resto', icono: 'i-lucide-asterisk' }
    }
    return esDescargaQos(clase) ? { etiqueta: 'Descargas', icono: 'i-lucide-download' } : { etiqueta: 'Por reglas', icono: 'i-lucide-filter' }
}

/* Formulario de clase. */

const PUERTOS = /^(\d{1,5})(?:-(\d{1,5}))?$/
const LISTA = /^[A-Za-z0-9._-]+$/

/** `errorPuertos()` de A2: n o n-m separados por coma, 1–65535, máx. 15. */
export function errorPuertos(valor: string): string | null {
    const partes = valor.split(',').map(p => p.trim())
    if (partes.length > 15) {
        return 'Máximo 15 puertos o rangos'
    }
    for (const p of partes) {
        const m = PUERTOS.exec(p)
        if (!m) {
            return `«${p}» no es un puerto ni un rango (n o n-m)`
        }
        const a = Number(m[1])
        const b = m[2] === undefined ? a : Number(m[2])
        if (a < 1 || b > 65535 || a > b) {
            return `«${p}» fuera de 1–65535 o rango invertido`
        }
    }
    return null
}

const reglaFormulario = z.object({
    protocolo: z.enum([CUALQUIERA, ...PROTOCOLOS_QOS]),
    puertos_destino: z.string().trim().max(200, 'Máximo 200 caracteres'),
    puertos_origen: z.string().trim().max(200, 'Máximo 200 caracteres'),
    dscp: z.number().int('Solo enteros').min(0, 'DSCP va de 0 a 63').max(63, 'DSCP va de 0 a 63').nullable(),
    lista_destino: z.string().trim().max(63, 'Máximo 63 caracteres').refine(v => v === '' || LISTA.test(v), 'Solo letras, dígitos, punto, guion y guion bajo'),
}).superRefine((r, ctx) => {
    if (r.protocolo === CUALQUIERA && !r.puertos_destino && !r.puertos_origen && r.dscp === null && !r.lista_destino) {
        ctx.addIssue({ code: 'custom', path: ['protocolo'], message: 'La regla no tiene ningún criterio: elige al menos uno' })
    }
    for (const campo of ['puertos_destino', 'puertos_origen'] as const) {
        if (!r[campo]) {
            continue
        }
        if (r.protocolo !== 'tcp' && r.protocolo !== 'udp') {
            ctx.addIssue({ code: 'custom', path: [campo], message: 'Los puertos solo aplican a TCP o UDP: elige el protocolo' })
            continue
        }
        const error = errorPuertos(r[campo])
        if (error) {
            ctx.addIssue({ code: 'custom', path: [campo], message: error })
        }
    }
})

export type ReglaFormulario = z.input<typeof reglaFormulario>

/** Espejo del validador y de las reglas de la clase; `resto` no lleva reglas ni descargas. */
export function esquemaClaseQos(esResto: boolean) {
    return z.object({
        nombre: z.string().trim().min(1, 'Escribe un nombre').max(80, 'Máximo 80 caracteres'),
        orden: z.number({ message: 'Escribe el orden' }).int('Solo enteros').min(1, 'Desde 1').max(1000, 'Hasta 1000'),
        prioridad: z.number({ message: 'Elige la prioridad' }).int().min(1, 'De 1 a 8').max(8, 'De 1 a 8'),
        garantizado_pct: z.number({ message: 'Escribe el garantizado' }).int('Solo enteros').min(0, 'De 0 a 100').max(100, 'De 0 a 100'),
        tope_pct: z.number().int('Solo enteros').min(1, 'De 1 a 100').max(100, 'De 1 a 100').nullable(),
        descargas: z.boolean(),
        bytes_minimo: z.number().int('Solo bytes enteros').min(1, 'Al menos 1 byte').max(1_000_000_000_000, 'Hasta 1 TB').nullable(),
        reclasifica_de: z.array(z.number().int()),
        reglas: z.array(reglaFormulario).max(QOS_MAX_REGLAS, `Máximo ${QOS_MAX_REGLAS} reglas por clase`),
    }).superRefine((c, ctx) => {
        if (esResto) {
            return
        }
        if (c.descargas) {
            if (c.bytes_minimo === null) {
                ctx.addIssue({ code: 'custom', path: ['bytes_minimo'], message: 'Escribe desde cuántos bytes una conexión es una descarga pesada' })
            }
            if (c.reclasifica_de.length === 0) {
                ctx.addIssue({ code: 'custom', path: ['reclasifica_de'], message: 'Elige de qué clases toma las conexiones (p. ej. Web y Resto)' })
            }
        }
        else if (c.reglas.length === 0) {
            ctx.addIssue({ code: 'custom', path: ['reglas'], message: 'La clase necesita al menos una regla (protocolo, puertos, DSCP o lista de destino)' })
        }
    })
}

export type EntradaClaseQos = z.input<ReturnType<typeof esquemaClaseQos>>
export type SalidaClaseQos = z.output<ReturnType<typeof esquemaClaseQos>>

export function reglaVacia(): ReglaFormulario {
    return { protocolo: 'tcp', puertos_destino: '', puertos_origen: '', dscp: null, lista_destino: '' }
}

export function entradaClaseQos(clase: ClaseApi | null, ordenSugerido: number): EntradaClaseQos {
    return {
        nombre: clase?.nombre ?? '',
        orden: clase?.orden ?? ordenSugerido,
        prioridad: clase?.prioridad ?? 5,
        garantizado_pct: clase?.garantizado_pct ?? 0,
        tope_pct: clase?.tope_pct ?? null,
        descargas: clase ? esDescargaQos(clase) : false,
        bytes_minimo: clase?.bytes_minimo ?? null,
        reclasifica_de: [...(clase?.reclasifica_de ?? [])],
        reglas: (clase?.reglas ?? (clase ? [] : [reglaVacia()])).map(r => ({
            protocolo: r.protocolo ?? CUALQUIERA,
            puertos_destino: r.puertos_destino ?? '',
            puertos_origen: r.puertos_origen ?? '',
            dscp: r.dscp,
            lista_destino: r.lista_destino ?? '',
        })),
    }
}

function reglaApi(r: z.output<typeof reglaFormulario>): ReglaApi {
    const conPuertos = r.protocolo === 'tcp' || r.protocolo === 'udp'
    return {
        protocolo: r.protocolo === CUALQUIERA ? null : r.protocolo,
        puertos_destino: conPuertos && r.puertos_destino ? r.puertos_destino : null,
        puertos_origen: conPuertos && r.puertos_origen ? r.puertos_origen : null,
        dscp: r.dscp,
        lista_destino: r.lista_destino || null,
    }
}

/** Cuerpo de `POST /qos/perfiles/:id/clases`. */
export function cuerpoClaseQos(datos: SalidaClaseQos): DatosClaseApi {
    return {
        nombre: datos.nombre,
        orden: datos.orden,
        prioridad: datos.prioridad,
        garantizado_pct: datos.garantizado_pct,
        tope_pct: datos.tope_pct,
        reglas: datos.reglas.map(reglaApi),
        bytes_minimo: datos.descargas ? datos.bytes_minimo : null,
        reclasifica_de: datos.descargas ? datos.reclasifica_de : [],
    }
}

/** Cuerpo de `PUT /qos/clases/:id`; la clase resto solo cambia nombre, prioridad y porcentajes. */
export function cambiosClaseQos(datos: SalidaClaseQos, clase: ClaseApi): CambiosClaseApi {
    if (clase.es_resto) {
        return { version: clase.version, nombre: datos.nombre, prioridad: datos.prioridad, garantizado_pct: datos.garantizado_pct, tope_pct: datos.tope_pct }
    }
    return { version: clase.version, ...cuerpoClaseQos(datos) }
}

/* Formulario de perfil. */

export const SIN_EMPRESA = 0

export const esquemaPerfilQos = z.object({
    nombre: z.string().trim().min(1, 'Escribe un nombre').max(120, 'Máximo 120 caracteres'),
    descripcion: z.string().trim().max(500, 'Máximo 500 caracteres'),
    /** `SIN_EMPRESA` = común a todas las empresas. */
    empresa_id: z.number().int(),
    copiar_de: z.number().int().positive('Elige de qué perfil copiar las clases'),
})

export type EntradaPerfilQos = z.input<typeof esquemaPerfilQos>
export type SalidaPerfilQos = z.output<typeof esquemaPerfilQos>

export function cuerpoPerfilQos(datos: SalidaPerfilQos): DatosPerfilApi {
    return {
        nombre: datos.nombre,
        descripcion: datos.descripcion || null,
        empresa_id: datos.empresa_id === SIN_EMPRESA ? null : datos.empresa_id,
        copiar_de: datos.copiar_de,
    }
}

/** Advertencias de un perfil en lenguaje simple (el mensaje de la API va debajo). */
export const TITULOS_ADVERTENCIA_QOS: Record<string, string> = {
    tope_por_cliente: 'Un cliente puede pasar la velocidad de su plan',
    orden_repetido: 'Hay clases con el mismo orden',
    qos_sin_cuello: 'Las clases nunca compiten',
    qos_costo: 'El router pasaría del límite de QoS',
}

/** Campos del formulario de clase: los `field` del 422 que se muestran junto a su campo. */
const CAMPOS_FORMULARIO_CLASE = ['nombre', 'orden', 'prioridad', 'garantizado_pct', 'tope_pct', 'bytes_minimo', 'reclasifica_de', 'reglas']

/**
 * Reparte los `errors[]` de un 422 de QoS: los de un campo del formulario (incluidos
 * `reglas.<n>.<campo>`) van junto al campo; los del perfil (`activa`, `es_resto`, `id`: resto, máximo
 * de clases, costo) se muestran arriba con su mensaje.
 */
export function separarErroresQos(errores: { field: string, message: string }[]): { campos: { name: string, message: string }[], generales: string[] } {
    const campos: { name: string, message: string }[] = []
    const generales: string[] = []
    for (const error of errores) {
        const raiz = error.field.split('.')[0] ?? ''
        if (CAMPOS_FORMULARIO_CLASE.includes(raiz)) {
            campos.push({ name: error.field, message: error.message })
        }
        else {
            generales.push(error.message)
        }
    }
    return { campos, generales }
}
