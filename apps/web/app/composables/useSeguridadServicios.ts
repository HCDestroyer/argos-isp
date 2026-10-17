import type { Problem } from '@argosisp/contracts'
import type { Ref } from 'vue'

/**
 * Estado de seguridad de Horus para las filas de una lista de servicios
 * (`POST /integraciones/horus/seguridad`, una llamada por página, `contratos/horus.md` §3.5). Solo
 * con `horus.ver`; con el conector apagado no hay nada que mostrar. `modo: alternativa` o
 * `stale` = último dato conocido, con su marca "Dato de hace X".
 */
export function useSeguridadServicios(servicios: Ref<readonly { id: number }[]>) {
    const { puede } = usePermisos()
    const horus = useHorus()

    const porServicio = shallowRef<Map<number, SeguridadServicioHorus>>(new Map())
    const respuesta = shallowRef<SeguridadHorus | null>(null)
    const problema = ref<Problem | null>(null)
    const cargando = ref(false)
    const ahora = ref(Date.now())

    async function cargar() {
        const ids = servicios.value.map(s => s.id)
        if (!puede('horus.ver') || ids.length === 0) {
            porServicio.value = new Map()
            respuesta.value = null
            problema.value = null
            return
        }
        cargando.value = true
        const resultado = await horus.seguridad(ids)
        cargando.value = false
        ahora.value = Date.now()
        respuesta.value = resultado.ok ? resultado.data : null
        problema.value = resultado.ok ? null : resultado.problema
        porServicio.value = new Map(resultado.ok ? resultado.data.items.map(item => [item.servicio_id, item]) : [])
    }

    watch(() => servicios.value.map(s => s.id).join(','), () => void cargar(), { immediate: true })

    /** Hay que mostrar la insignia: Horus activo y la lectura salió bien. */
    const visible = computed(() => respuesta.value?.conector === 'activo')

    function de(servicioId: number): { estado: string | null, hallazgos: number | null, marca: string | null } | null {
        const item = porServicio.value.get(servicioId)
        // Sin estado (el servicio no tiene identidad en Horus o Horus no lo informó): sin insignia.
        if (!visible.value || !item || item.estado === null) {
            return null
        }
        const viejo = item.estado !== null && (item.stale || respuesta.value?.stale === true || (item.fuente !== null && item.fuente !== 'horus'))
        return {
            estado: item.estado,
            hallazgos: item.hallazgos_abiertos,
            marca: marcaDatoViejo(viejo, item.actualizado_en ?? respuesta.value?.actualizado_en ?? null, ahora.value),
        }
    }

    return { visible, problema, cargando, recargar: cargar, de }
}
