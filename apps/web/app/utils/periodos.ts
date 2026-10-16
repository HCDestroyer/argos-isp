const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** `2026-10-01` → `octubre 2026`. Cualquier otra cosa, tal cual. */
export function etiquetaPeriodo(periodo: string): string {
    const [anio, mes] = periodo.split('-')
    const nombre = MESES[Number(mes) - 1]
    return nombre && anio ? `${nombre} ${anio}` : periodo
}

/**
 * Primer día de los últimos `cantidad` meses, del más reciente al más viejo, contando desde
 * `hoy` (`AAAA-MM-DD` en Guatemala): `['2026-10-01', '2026-09-01', …]`.
 */
export function periodosRecientes(hoy: string, cantidad = 12): string[] {
    let anio = Number(hoy.slice(0, 4))
    let mes = Number(hoy.slice(5, 7))
    const periodos: string[] = []
    for (let i = 0; i < cantidad; i++) {
        periodos.push(`${anio}-${String(mes).padStart(2, '0')}-01`)
        mes -= 1
        if (mes === 0) {
            mes = 12
            anio -= 1
        }
    }
    return periodos
}

/** Último día del mes de `periodo` (`2026-02-01` → `2026-02-28`). */
export function finDePeriodo(periodo: string): string {
    const fecha = new Date(`${periodo.slice(0, 7)}-01T00:00:00Z`)
    fecha.setUTCMonth(fecha.getUTCMonth() + 1)
    fecha.setUTCDate(0)
    return fecha.toISOString().slice(0, 10)
}

/**
 * Inicio de un día de Guatemala en UTC (`2026-10-15` → `2026-10-15T06:00:00.000Z`). Guatemala
 * no tiene horario de verano: siempre UTC−6. Para filtros `desde` de instantes.
 */
export function inicioDiaGuatemala(fecha: string): string {
    return new Date(`${fecha}T00:00:00-06:00`).toISOString()
}

/** Fin de un día de Guatemala en UTC (`2026-10-15` → `2026-10-16T05:59:59.999Z`). */
export function finDiaGuatemala(fecha: string): string {
    return new Date(`${fecha}T23:59:59.999-06:00`).toISOString()
}
