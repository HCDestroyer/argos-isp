import type { Schema } from '@argosisp/contracts'

export type EmpresaResumen = Schema<'EmpresaResumen'>

/** Empresa elegida en el selector: una empresa, o `todas` (consolidado, solo con alcance global). */
export type EleccionEmpresa = number | 'todas'

const PREFIJO = 'argos_empresa_activa:'

/**
 * Rutas GET que aceptan `?empresas=todas` (consolidado, `contratos/multiempresa.md`). Con "Todas"
 * el plugin `empresa` lo agrega; una prueba la compara con el OpenAPI.
 */
export const LISTAS_CONSOLIDABLES: readonly string[] = [
    '/api/v1/cajas',
    '/api/v1/clientes',
    '/api/v1/comprobantes',
    '/api/v1/cuentas-bancarias',
    '/api/v1/dashboard/resumen',
    '/api/v1/egresos',
    '/api/v1/facturas',
    '/api/v1/libro/balance',
    '/api/v1/libro/bancos',
    '/api/v1/libro/cuentas',
    '/api/v1/libro/diario',
    '/api/v1/libro/estado-resultados',
    '/api/v1/libro/mayor',
    '/api/v1/libro/periodos',
    '/api/v1/notas-credito',
    '/api/v1/pagos',
    '/api/v1/pasarela/cobros',
    '/api/v1/promesas',
    '/api/v1/reportes/altas-bajas',
    '/api/v1/reportes/cartera-vencida',
    '/api/v1/reportes/cierres-caja',
    '/api/v1/reportes/cobranza-diaria',
    '/api/v1/reportes/egresos',
    '/api/v1/reportes/facturado-vs-cobrado',
    '/api/v1/reportes/ingresos',
    '/api/v1/reportes/iva',
    '/api/v1/reportes/promesas',
    '/api/v1/routers',
    '/api/v1/servicios',
]

function leerGuardada(usuarioId: number): EleccionEmpresa | null {
    try {
        const valor = window.localStorage.getItem(`${PREFIJO}${usuarioId}`)
        if (valor === 'todas') {
            return 'todas'
        }
        const id = Number(valor)
        return Number.isInteger(id) && id > 0 ? id : null
    }
    catch {
        return null
    }
}

function guardar(usuarioId: number, eleccion: EleccionEmpresa): void {
    try {
        window.localStorage.setItem(`${PREFIJO}${usuarioId}`, String(eleccion))
    }
    catch {
        // Sin almacenamiento: la elección dura la visita.
    }
}

/**
 * La elección que vale para el usuario: la guardada si sigue en su alcance; si no, la activa que
 * dio `GET /me`, su única empresa, "Todas" con alcance global o la primera de sus empresas.
 */
export function eleccionInicial(usuario: Pick<Schema<'Me'>, 'empresas' | 'alcance_global' | 'empresa_activa_id'>, guardada: EleccionEmpresa | null): EleccionEmpresa | null {
    const empresas = usuario.empresas ?? []
    const valida = (e: EleccionEmpresa | null | undefined): e is EleccionEmpresa =>
        e === 'todas' ? usuario.alcance_global === true && empresas.length > 1 : empresas.some(x => x.id === e)
    if (valida(guardada)) {
        return guardada
    }
    if (valida(usuario.empresa_activa_id)) {
        return usuario.empresa_activa_id
    }
    if (empresas.length === 1) {
        return empresas[0]?.id ?? null
    }
    if (usuario.alcance_global && empresas.length > 1) {
        return 'todas'
    }
    return empresas[0]?.id ?? null
}

/**
 * Empresa activa del panel (multiempresa). La cabecera `X-Empresa-Id` la pone `plugins/empresa.ts`
 * en cada petición; con "Todas" no va cabecera y las listas consolidables piden `empresas=todas`.
 * Con una sola empresa el selector no aparece y todo sigue como antes.
 */
export function useEmpresaActiva() {
    const usuario = useUsuarioActual()
    const eleccion = useState<EleccionEmpresa | null>('empresa:eleccion', () => null)

    const empresas = computed<EmpresaResumen[]>(() => usuario.value?.empresas ?? [])
    const alcanceGlobal = computed(() => usuario.value?.alcance_global === true)
    const conSelector = computed(() => empresas.value.length > 1)
    const empresaId = computed<number | null>(() => (typeof eleccion.value === 'number' ? eleccion.value : null))
    const empresa = computed(() => empresas.value.find(e => e.id === empresaId.value) ?? null)

    function inicializar(): void {
        const actual = usuario.value
        eleccion.value = actual ? eleccionInicial(actual, leerGuardada(actual.id)) : null
    }

    function elegir(nueva: EleccionEmpresa): void {
        const actual = usuario.value
        if (!actual || eleccionInicial(actual, nueva) !== nueva) {
            return
        }
        eleccion.value = nueva
        guardar(actual.id, nueva)
    }

    /** Nombre comercial de una empresa del usuario (o `Empresa N` si no está en su lista). */
    function nombre(id: number | null | undefined): string {
        if (id === null || id === undefined) {
            return '—'
        }
        return empresas.value.find(e => e.id === id)?.nombre_comercial ?? `Empresa ${id}`
    }

    return { eleccion, empresas, empresa, empresaId, alcanceGlobal, conSelector, inicializar, elegir, nombre }
}

/** URL absoluta del logo (`/api/v1/empresas/:id/logo?v=…`); en modo fixtures no hay archivo. */
export function urlLogoEmpresa(logoUrl: string | null | undefined): string | undefined {
    const config = useRuntimeConfig()
    if (!logoUrl || config.public.useFixtures) {
        return undefined
    }
    return /^https?:\/\//.test(logoUrl) ? logoUrl : `${String(config.public.apiBase).replace(/\/$/, '')}${logoUrl}`
}
