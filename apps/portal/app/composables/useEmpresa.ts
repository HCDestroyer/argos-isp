import type { Schema } from '@argosisp/contracts'

export type EmpresaPublica = Schema<'EmpresaPublica'>
export type CuentaDeposito = Schema<'CuentaDeposito'>

/**
 * Datos de la empresa configurados en el panel (`GET /portal/empresa`): contacto, horario,
 * instrucciones de pago y cuentas para depósito (de `billing.cuentas_bancarias`, A3). Una sola
 * petición compartida por el layout, `/corte` y `/contacto` (misma clave de `useAsyncData`).
 *
 * Solo en el navegador, igual que el resto del portal (la API limita por IP de origen). Mientras
 * carga, el nombre sale de `NUXT_PUBLIC_EMPRESA_NOMBRE`; si falla, `problema` queda puesto y las
 * pantallas muestran el error con "Reintentar", nunca datos de pago inventados.
 */
export function useEmpresa() {
    const api = useApi()
    const config = useRuntimeConfig().public

    const consulta = useAsyncData<Resultado<EmpresaPublica>>(
        'portal:empresa',
        () => resolver(api.GET('/api/v1/portal/empresa')),
        { server: false },
    )

    const empresa = computed(() => consulta.data.value?.ok ? consulta.data.value.data : null)
    const problema = computed(() => consulta.data.value && !consulta.data.value.ok ? consulta.data.value.problema : null)
    const cargando = computed(() => consulta.status.value === 'idle' || consulta.status.value === 'pending')
    const nombre = computed(() => empresa.value?.nombre ?? config.empresa.nombre)

    return { empresa, problema, cargando, nombre, recargar: consulta.refresh }
}
