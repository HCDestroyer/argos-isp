/**
 * ¿Hay soporte en línea con Iris para el cliente de la sesión? (`GET /portal/soporte`, contrato Iris
 * 0.9.0 §11 y §4.3). Una sola petición compartida (barra de navegación y `/cuenta`), solo en el
 * navegador y con la sesión confirmada.
 *
 * - `sin_iris`: la instalación no tiene Iris; la sección «Soporte» no aparece.
 * - Cualquier otro estado que no sea `disponible` (apagado, versión menor, sin respuesta): la sección
 *   aparece con el error y «Reintentar», nunca con listas vacías inventadas.
 */
export function useSoporte() {
    const api = useApi()
    const sesion = useSesionPortal()

    const consulta = useAsyncData<Resultado<DisponibilidadSoporte> | null>(
        'portal:soporte',
        async () => {
            if (!sesion.activa.value) {
                return null
            }
            return resolver(api.GET('/api/v1/portal/soporte'))
        },
        { server: false, dedupe: 'defer', watch: [sesion.activa] },
    )

    const disponibilidad = computed(() => consulta.data.value?.ok ? consulta.data.value.data : null)
    const problema = computed(() => consulta.data.value && !consulta.data.value.ok ? consulta.data.value.problema : null)
    const visible = computed(() => soporteVisible(disponibilidad.value))
    const disponible = computed(() => disponibilidad.value?.estado === 'disponible')
    const cargando = computed(() => consulta.status.value === 'idle' || consulta.status.value === 'pending')

    return { disponibilidad, problema, visible, disponible, cargando, recargar: consulta.refresh }
}
