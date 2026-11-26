<script setup lang="ts">
/**
 * Nueva promoción de velocidad en su página (tablero PendPromocionForm: tiene más de 3 campos).
 * Con `?servicio=:id` (botón «Nueva promoción» de la ficha del servicio) ese servicio sale elegido.
 * Al crear, vuelve a la lista con la promoción elegida, o a la ficha del servicio si vino de ahí.
 */
definePageMeta({ permiso: 'promociones_velocidad.crear' })

useHead({ title: 'Nueva promoción de velocidad · ArgosIsp' })

const route = useRoute()
const toast = useToast()
const { destinoPermitido, puede } = usePermisos()

const servicioId = Number(route.query.servicio) || null
const iniciales = shallowRef<Servicio[]>([])

onMounted(async () => {
    if (servicioId && puede('servicios.ver')) {
        const resultado = await useServicios().ver(servicioId)
        iniciales.value = resultado.ok ? [resultado.data] : []
    }
})

function volver() {
    void navigateTo(destinoPermitido(servicioId ? `/servicios/${servicioId}?pestana=promociones` : '/planes/promociones'))
}

function alGuardar(promocion: PromocionVelocidad) {
    toast.add({
        title: `«${promocion.nombre}» creada`,
        description: promocion.servicios ? `${promocion.servicios === 1 ? '1 servicio' : `${promocion.servicios} servicios`} · ${precioPromocion(promocion)}` : `Sin servicios todavía · ${precioPromocion(promocion)}`,
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
    if (servicioId) {
        volver()
        return
    }
    const vigencia = promocion.vigencia === 'vigente' ? '' : `vigencia=${promocion.vigencia}&`
    void navigateTo(destinoPermitido(`/planes/promociones?${vigencia}promocion=${promocion.id}`))
}
</script>

<template>
    <PanelPagina
        id="promocion-nueva"
        titulo="Nueva promoción"
        icono="i-lucide-zap"
        encabezado-propio
    >
        <PromocionFormulario
            :servicios-iniciales="iniciales"
            @guardada="alGuardar"
            @cancelar="volver"
        />
    </PanelPagina>
</template>
