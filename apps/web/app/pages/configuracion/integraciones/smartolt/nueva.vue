<script setup lang="ts">
/**
 * Agregar instancia de SmartOLT (tablero PendSmartoltForm, modo «Agregar»): formulario en su
 * página. Al guardar abre el detalle para «Probar conexión».
 */
definePageMeta({ permiso: 'smartolt.crear_instancia' })

useHead({ title: 'Agregar instancia · SmartOLT · ArgosIsp' })

const toast = useToast()
const { enlace, destinoPermitido } = usePermisos()

function alGuardar(instancia: InstanciaSmartOlt) {
    toast.add({ title: 'Instancia guardada', description: 'Prueba la conexión para traer sus OLT.', icon: 'i-lucide-circle-check', color: 'success' })
    void navigateTo(destinoPermitido(`/configuracion/integraciones/smartolt/${instancia.id}`, '/configuracion'))
}
</script>

<template>
    <ConfiguracionMarco
        id="smartolt-nueva"
        titulo="Agregar instancia de SmartOLT"
        descripcion="Una cuenta de SmartOLT (un subdominio) con su propio token"
        volver="/configuracion/integraciones?ver=smartolt"
    >
        <SmartOltFormulario @guardada="alGuardar">
            <template #cancelar>
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :to="enlace('/configuracion/integraciones?ver=smartolt')"
                />
            </template>
        </SmartOltFormulario>
    </ConfiguracionMarco>
</template>
