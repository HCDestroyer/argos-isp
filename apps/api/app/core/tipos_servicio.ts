/**
 * Tipos de servicio (plan v3, `contratos/tipos-servicio.md`): `internet` (por defecto), `cable`
 * (CATV por fibra, siempre con ONU; no existe TV por coaxial), `iptv` (servicio de datos con su
 * propio router y plan; nunca se limita) y `mixto` (dos o tres componentes).
 *
 * Es la única fuente de las capacidades de cada tipo para validadores, facturación, corte y
 * pantallas. Nadie compara `tipo_servicio === 'cable'` fuera de este módulo: pregunta por la
 * capacidad (`requiereRouter`, `requiereVelocidad`, `admiteLimitado`, `componentes`,
 * `corteSmartolt`).
 */

export const TIPOS_SERVICIO = ['internet', 'cable', 'iptv', 'mixto'] as const
export type TipoServicio = (typeof TIPOS_SERVICIO)[number]

/** Lo que puede componer un plan `mixto` (y el tipo simple de los demás). */
export const COMPONENTES_SERVICIO = ['internet', 'cable', 'iptv'] as const
export type ComponenteServicio = (typeof COMPONENTES_SERVICIO)[number]

export const TIPO_SERVICIO_POR_DEFECTO: TipoServicio = 'internet'

/** Las cuatro capacidades de un tipo, a partir de sus componentes. */
export interface CapacidadesServicio {
    /** router, IP y RADIUS: todo menos el cable (va por fibra, sin router) */
    requiereRouter: boolean
    /** el plan tiene velocidad (todo menos el cable) */
    requiereVelocidad: boolean
    /** puede pasar a `limitado`: solo si incluye internet (iptv y cable nunca se limitan) */
    admiteLimitado: boolean
    /** componentes del servicio: el mismo tipo en los simples; dos o tres en el mixto */
    componentes: readonly ComponenteServicio[]
    /** algún componente se corta por SmartOLT (`disable_catv` / `enable_catv`) */
    corteSmartolt: boolean
}

export function esTipoServicio(valor: unknown): valor is TipoServicio {
    return typeof valor === 'string' && (TIPOS_SERVICIO as readonly string[]).includes(valor)
}

/**
 * Capacidades de un plan o servicio. `componentes` solo cuenta en `mixto`; en los tipos simples el
 * componente es el propio tipo. Un mixto sin componentes (dato inválido, la base lo impide) no
 * tiene capacidades.
 */
export function capacidadesDe(
    tipo: TipoServicio,
    componentes?: readonly ComponenteServicio[] | null,
): CapacidadesServicio {
    const lista: readonly ComponenteServicio[] = tipo === 'mixto' ? (componentes ?? []) : [tipo]
    const tiene = (c: ComponenteServicio) => lista.includes(c)
    return {
        // el mixto siempre tiene internet o IPTV (`validarComponentes`), que van sobre IP
        requiereRouter: tiene('internet') || tiene('iptv'),
        requiereVelocidad: tiene('internet') || tiene('iptv'),
        admiteLimitado: tiene('internet'),
        componentes: lista,
        corteSmartolt: tiene('cable'),
    }
}

/** Componentes que se guardan en `network.planes.componentes` para un tipo simple. */
export function componentesPorDefecto(tipo: Exclude<TipoServicio, 'mixto'>): ComponenteServicio[] {
    return [tipo]
}

export interface ErrorTipoServicio {
    field: string
    message: string
    rule: string
}

export interface DatosTipoPlan {
    tipo_servicio: TipoServicio
    componentes: readonly string[] | null | undefined
    /** numeric como texto ("150.00") o null */
    precio: string
    precio_cable: string | null | undefined
    precio_iptv: string | null | undefined
    bajada_kbps: number | null | undefined
    subida_kbps: number | null | undefined
}

/** Centavos enteros de un monto con hasta dos decimales, sin pasar por `number` decimal. */
function centavos(monto: string): bigint {
    const [entero, fraccion = ''] = String(monto).trim().split('.')
    return BigInt(entero! || '0') * 100n + BigInt((fraccion + '00').slice(0, 2))
}

/**
 * Reglas de un plan según su tipo (422 por campo, `contratos/tipos-servicio.md` §2):
 * - `componentes`: en tipos simples vacío o el mismo tipo; en `mixto`, dos o tres distintos;
 * - `precio_cable` y `precio_iptv` solo en `mixto`, y solo para componentes que el plan trae;
 * - con internet, `precio_cable + precio_iptv` debe ser menor que el precio (la línea de internet es
 *   el resto); sin internet, no puede superarlo;
 * - velocidad nula solo en `cable`; en cualquier otro tipo la bajada y la subida son obligatorias.
 */
export function validarPlanPorTipo(datos: DatosTipoPlan): ErrorTipoServicio[] {
    const errores: ErrorTipoServicio[] = []
    const { tipo_servicio: tipo } = datos
    const componentes = datos.componentes ?? []
    for (const c of componentes) {
        if (!(COMPONENTES_SERVICIO as readonly string[]).includes(c)) {
            errores.push({
                field: 'componentes',
                message: `El componente ${c} no existe (internet, cable o iptv)`,
                rule: 'componente_invalido',
            })
        }
    }
    if (new Set(componentes).size !== componentes.length) {
        errores.push({
            field: 'componentes',
            message: 'Los componentes no se repiten',
            rule: 'componentes_repetidos',
        })
    }
    if (tipo === 'mixto') {
        if (componentes.length < 2 || componentes.length > 3) {
            errores.push({
                field: 'componentes',
                message: 'Un plan mixto combina dos o tres componentes (internet, cable e iptv)',
                rule: 'mixto_componentes',
            })
        }
    } else if (componentes.length > 0 && !(componentes.length === 1 && componentes[0] === tipo)) {
        errores.push({
            field: 'componentes',
            message: `En un plan ${tipo} los componentes son solo ${tipo}`,
            rule: 'componentes_del_tipo',
        })
    }

    const tieneInternet = componentes.includes('internet')
    const tieneCable = componentes.includes('cable')
    const tieneIptv = componentes.includes('iptv')
    const precioCable = datos.precio_cable ?? null
    const precioIptv = datos.precio_iptv ?? null
    if (tipo !== 'mixto') {
        for (const [campo, valor] of [
            ['precio_cable', precioCable],
            ['precio_iptv', precioIptv],
        ] as const) {
            if (valor !== null) {
                errores.push({
                    field: campo,
                    message: `${campo} solo aplica a un plan mixto`,
                    rule: 'solo_mixto',
                })
            }
        }
    } else {
        if (precioCable !== null && !tieneCable) {
            errores.push({
                field: 'precio_cable',
                message: 'El plan no trae el componente cable',
                rule: 'sin_componente',
            })
        }
        if (precioIptv !== null && !tieneIptv) {
            errores.push({
                field: 'precio_iptv',
                message: 'El plan no trae el componente iptv',
                rule: 'sin_componente',
            })
        }
        const suma = centavos(precioCable ?? '0') + centavos(precioIptv ?? '0')
        const precio = centavos(datos.precio)
        // con internet la línea de internet es el resto y debe quedar con precio; sin internet el
        // desglose puede cubrir todo el precio (cable + IPTV: `precio_iptv` es el resto)
        if (tieneInternet ? suma >= precio : suma > precio) {
            errores.push({
                field: 'precio_cable',
                message: tieneInternet
                    ? 'precio_cable + precio_iptv debe ser menor que el precio del plan: el resto es la línea de internet'
                    : 'precio_cable + precio_iptv no puede superar el precio del plan',
                rule: 'desglose_excede_precio',
            })
        }
    }

    const sinBajada = datos.bajada_kbps === null || datos.bajada_kbps === undefined
    const sinSubida = datos.subida_kbps === null || datos.subida_kbps === undefined
    if ((sinBajada || sinSubida) && tipo !== 'cable') {
        errores.push({
            field: sinBajada ? 'bajada_kbps' : 'subida_kbps',
            message: `La velocidad de bajada y de subida es obligatoria en un plan ${tipo}`,
            rule: 'velocidad_requerida',
        })
    }
    return errores
}
