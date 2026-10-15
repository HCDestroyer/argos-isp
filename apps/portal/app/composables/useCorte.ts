import corteSuspendido from '~~/fixtures/corte/suspendido.json'

/**
 * Datos que muestra la página de corte para la IP que consulta.
 *
 * NEEDS(A5): publicar `GET /api/v1/portal/quien-soy` en el OpenAPI y reemplazar este tipo
 * por `Schema<'PortalQuienSoy'>` (o el nombre que salga del validador). Solo nombre parcial
 * y montos: nunca datos personales completos a partir de la IP.
 */
export interface DatosCorte {
    cliente: {
        nombreParcial: string
    }
    servicio: {
        estado: EstadoServicio
        plan: string
        promesaActiva: boolean
    }
    /** String decimal, como lo envía la API. */
    montoAdeudado: string
    facturasVencidas: {
        numero: string
        periodo: string
        venceEn: string
        total: string
    }[]
}

export const FIXTURE_CORTE: DatosCorte = {
    ...corteSuspendido,
    servicio: {
        ...corteSuspendido.servicio,
        estado: 'suspendido',
    },
}

/**
 * Estado del servicio para la página de corte. Se consulta solo en el navegador: la API
 * identifica al cliente por la IP de origen de la petición, no por la del servidor Nitro.
 */
export function useCorte() {
    const config = useRuntimeConfig()

    return useAsyncData<DatosCorte | null>('portal:corte', async () => {
        if (config.public.useFixtures) {
            return FIXTURE_CORTE
        }
        // NEEDS(A5): `useApi().GET('/api/v1/portal/quien-soy')` cuando exista en el contrato.
        return null
    }, {
        server: false,
        default: () => null,
    })
}
