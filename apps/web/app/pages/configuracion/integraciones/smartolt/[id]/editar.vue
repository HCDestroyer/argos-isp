<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Editar una instancia de SmartOLT (tablero PendSmartoltForm, modo «Editar»): el token se conserva
 * si no se cambia; cambiar subdominio o token borra la prueba.
 */
definePageMeta({ permiso: 'smartolt.editar_instancia' })

const route = useRoute()
const toast = useToast()
const { puede, enlace, destinoPermitido } = usePermisos()
const id = computed(() => Number(route.params.id))
const instancia = shallowRef<InstanciaSmartOlt | null>(null)
const problema = ref<Problem | null>(null)
const cargando = ref(false)

useHead(() => ({ title: `Editar ${instancia.value?.nombre ?? 'instancia'} · SmartOLT · ArgosIsp` }))

async function cargar() {
    if (!puede('smartolt.ver')) {
        return
    }
    cargando.value = true
    const r = await useSmartOlt().ver(id.value)
    cargando.value = false
    instancia.value = r.ok ? r.data : null
    problema.value = r.ok ? null : r.problema
}

function alGuardar(guardada: InstanciaSmartOlt) {
    toast.add({ title: 'Instancia guardada', icon: 'i-lucide-circle-check', color: 'success' })
    void navigateTo(destinoPermitido(`/configuracion/integraciones/smartolt/${guardada.id}`, '/configuracion'))
}

onMounted(cargar)
</script>

<template>
    <ConfiguracionMarco
        id="smartolt-editar"
        :titulo="instancia ? `Editar «${instancia.nombre}»` : 'Editar instancia'"
        descripcion="Una cuenta de SmartOLT (un subdominio) con su propio token"
        :volver="`/configuracion/integraciones/smartolt/${id}`"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="!instancia"
            class="h-96 w-full"
        />
        <SmartOltFormulario
            v-else
            :instancia="instancia"
            @guardada="alGuardar"
            @recargar="cargar"
        >
            <template #cancelar>
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :to="enlace(`/configuracion/integraciones/smartolt/${id}`)"
                />
            </template>
        </SmartOltFormulario>
    </ConfiguracionMarco>
</template>
