/**
 * «Está a cargo de» (`GET /portal/a-cargo`, contrato Iris 0.10.1 §3.8, A46): servicios de otros
 * clientes que la persona de la sesión tiene a cargo como su contacto. Solo `codigo`, `nombre`,
 * estado y, con el permiso `consultar`, lo que deben.
 */
export function useACargo() {
    const api = useApi()
    const sesion = useSesionPortal()

    const consulta = useAsyncData<Resultado<ACargo[]> | null>(
        'portal:a-cargo',
        async () => {
            if (!sesion.activa.value) {
                return null
            }
            const leido = await resolver(api.GET('/api/v1/portal/a-cargo'))
            return leido.ok ? { ok: true, data: leido.data.data } : leido
        },
        { server: false, dedupe: 'defer', watch: [sesion.activa] },
    )

    const lista = computed(() => consulta.data.value?.ok ? consulta.data.value.data : null)
    const problema = computed(() => consulta.data.value && !consulta.data.value.ok ? consulta.data.value.problema : null)
    const cargando = computed(() => consulta.status.value === 'idle' || consulta.status.value === 'pending')

    return { lista, problema, cargando, recargar: consulta.refresh }
}
