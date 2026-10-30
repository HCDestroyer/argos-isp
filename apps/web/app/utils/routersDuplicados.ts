import type { Problem, Schema } from '@argosisp/contracts'

/** Clave por la que dos routers parecen el mismo MikroTik (`contratos/routers.md` §1). */
export type MotivoDuplicado = Schema<'GrupoRoutersDuplicados'>['motivos'][number]

type RouterDeGrupo = Schema<'GrupoRoutersDuplicados'>['routers'][number]

/** Cómo se explica cada clave al operador: qué comparten y por qué eso es el mismo equipo. */
export const MOTIVOS_DUPLICADO: Record<MotivoDuplicado, { etiqueta: string, explicacion: string, icono: string }> = {
    api: {
        etiqueta: 'Misma dirección de la API',
        explicacion: 'Argos le habla por REST al mismo host y puerto: los dos registros mandan comandos al mismo equipo.',
        icono: 'i-lucide-plug',
    },
    nas_ip: {
        etiqueta: 'Misma IP del NAS',
        explicacion: 'Las sesiones RADIUS llegan con esa nas_ip y solo se pueden atribuir a uno de los dos.',
        icono: 'i-lucide-network',
    },
    serial: {
        etiqueta: 'Mismo número de serie',
        explicacion: 'El sondeo leyó el mismo serial (o software-id en un CHR) en los dos: es el mismo equipo físico.',
        icono: 'i-lucide-fingerprint',
    },
}

/** «Misma dirección de la API (10.10.0.1:443)» por cada valor compartido del grupo. */
export function razonesDuplicado(grupo: Schema<'GrupoRoutersDuplicados'>): { motivo: MotivoDuplicado, texto: string }[] {
    return grupo.claves.map(clave => ({
        motivo: clave.motivo,
        texto: `${MOTIVOS_DUPLICADO[clave.motivo].etiqueta} (${clave.valor})`,
    }))
}

/** «RB-Centro» y «RB-Centro 2» / «A», «B» y «C». */
export function nombresGrupo(routers: readonly Pick<RouterDeGrupo, 'nombre'>[]): string {
    const nombres = routers.map(r => `«${r.nombre}»`)
    if (nombres.length <= 1) {
        return nombres.join('')
    }
    return `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}`
}

/**
 * Router que se sugiere conservar al unir: el que tiene más sesiones abiertas (es el que el
 * MikroTik usa con RADIUS), luego más servicios, luego el más antiguo. El operador puede cambiarlo.
 */
export function routerSugerido(routers: readonly RouterDeGrupo[], preferido?: number): RouterDeGrupo | undefined {
    const fijo = routers.find(r => r.id === preferido)
    if (fijo) {
        return fijo
    }
    return [...routers].sort((a, b) => b.sesiones_abiertas - a.sesiones_abiertas || b.servicios_total - a.servicios_total || a.id - b.id)[0]
}

export function enPlural(cantidad: number, singular: string, varios: string): string {
    return `${cantidad} ${cantidad === 1 ? singular : varios}`
}

const CODIGOS = {
    duplicado: 'urn:argosisp:problema:router_duplicado',
    unido: 'urn:argosisp:problema:router_unido',
    secreto: 'urn:argosisp:problema:secreto_radius_distinto',
} as const

/** 409 `router_duplicado` de `POST /routers` o `PUT /routers/:id`: el MikroTik ya está registrado. */
export function esRouterDuplicado(problema: Problem | null | undefined): boolean {
    return problema?.type === CODIGOS.duplicado
}

/** 422 `router_unido`: el router ya se unió a otro y no se reactiva ni se vuelve a unir. */
export function esRouterUnido(problema: Problem | null | undefined): boolean {
    return problema?.type === CODIGOS.unido
}

/** 422 `secreto_radius_distinto` al unir: primero el mismo secreto en el equipo y en Argos. */
export function esSecretoDistinto(problema: Problem | null | undefined): boolean {
    return problema?.type === CODIGOS.secreto
}

/** Bloqueos de la simulación de `routers.unir`, en palabras del operador. */
export const BLOQUEOS_UNION: Record<Schema<'UnionRouters'>['bloqueos'][number], { titulo: string, paso: string }> = {
    secreto_radius_distinto: {
        titulo: 'Los secretos RADIUS no coinciden',
        paso: 'Deja el mismo secreto en el MikroTik (/radius) y en Argos (en el router que queda) y vuelve a revisar.',
    },
}
