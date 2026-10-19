import type { MaybeRefOrGetter } from 'vue'
import type { Schema } from '@argosisp/contracts'

export type EmpresaPublica = Schema<'EmpresaPublica'>
export type CuentaDeposito = Schema<'CuentaDeposito'>

/**
 * De qué empresa son los datos (multiempresa, `contratos/multiempresa.md` § Marca):
 *
 * - `{ empresaId }`: esa empresa (la de un grupo de servicios o de una factura en `/cuenta`).
 * - `{ de: 'cliente' }`: la principal del cliente de la sesión (encabezado y título de `/cuenta`).
 * - nada: la del servicio de la IP de origen (`/corte`), si no la principal de la sesión, si no la
 *   principal de la instalación. Es lo que decide la API.
 */
export interface OrigenEmpresa {
    empresaId?: MaybeRefOrGetter<number | null | undefined>
    de?: MaybeRefOrGetter<'cliente' | undefined>
}

/**
 * Datos públicos de una empresa (`GET /portal/empresa`): marca (nombre y logo), contacto, horario,
 * instrucciones de pago y SUS cuentas para depósito (de `billing.cuentas_bancarias`, A3). Una
 * petición compartida por empresa (misma clave de `useAsyncData` en el layout, `/corte`, los
 * modales y `/contacto`): los datos de una empresa nunca se mezclan con los de otra.
 *
 * Solo en el navegador, igual que el resto del portal (la API limita por IP de origen). Mientras
 * carga, el nombre sale de `NUXT_PUBLIC_EMPRESA_NOMBRE`; si falla, `problema` queda puesto y las
 * pantallas muestran el error con "Reintentar", nunca datos de pago inventados.
 */
export function useEmpresa(origen: OrigenEmpresa = {}) {
    const api = useApi()
    const config = useRuntimeConfig().public

    const empresaId = computed(() => toValue(origen.empresaId) ?? null)
    const de = computed(() => toValue(origen.de))
    // Clave reactiva: al cambiar de empresa (o de página en el layout) se lee la otra.
    const clave = computed(() => empresaId.value !== null
        ? `portal:empresa:${empresaId.value}`
        : de.value === 'cliente' ? 'portal:empresa:cliente' : 'portal:empresa')

    const consulta = useAsyncData<Resultado<EmpresaPublica>>(
        clave,
        () => resolver(api.GET('/api/v1/portal/empresa', {
            params: {
                query: empresaId.value !== null
                    ? { empresa_id: empresaId.value }
                    : de.value === 'cliente' ? { de: 'cliente' } : {},
            },
        })),
        // Varios componentes montan a la vez con la misma clave (layout, página, tarjetas): con
        // `defer` comparten la petición en vuelo; con `cancel` (por defecto) cada uno la repetía.
        { server: false, dedupe: 'defer' },
    )

    const empresa = computed(() => consulta.data.value?.ok ? consulta.data.value.data : null)
    const problema = computed(() => consulta.data.value && !consulta.data.value.ok ? consulta.data.value.problema : null)
    const cargando = computed(() => consulta.status.value === 'idle' || consulta.status.value === 'pending')
    const nombre = computed(() => empresa.value?.nombre ?? config.empresa.nombre)
    const logoUrl = computed(() => empresa.value?.logo_url ?? null)

    return { empresa, problema, cargando, nombre, logoUrl, recargar: consulta.refresh }
}
