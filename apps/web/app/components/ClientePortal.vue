<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * «Portal del cliente» en la ficha (A5): si el cliente entra con su contraseña propia (y desde
 * cuándo) o con la por defecto de su empresa, y «Restaurar contraseña por defecto»
 * (`clientes.restaurar_contrasena_portal`), que borra la propia y cierra sus sesiones del portal.
 * Con error, el error con «Reintentar»: nunca un estado supuesto.
 */
const props = defineProps<{
    clienteId: number
}>()

const { puede } = usePermisos()
const toast = useToast()

const estado = shallowRef<ClienteContrasenaPortal | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)
const confirmando = ref(false)

const puedeRestaurar = computed(() => puede('clientes.restaurar_contrasena_portal'))

const efecto = computed(() => {
    const base = 'El cliente volverá a entrar con la contraseña de la empresa y deberá elegir una nueva. Se cerrarán sus sesiones del portal.'
    return estado.value?.defecto_configurada === false
        ? `${base} Su empresa no tiene contraseña por defecto: hasta que se configure, solo podrá entrar con código.`
        : base
})

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await usePortalContrasena().verCliente(props.clienteId)
    cargando.value = false
    estado.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

function restaurar() {
    return usePortalContrasena().restaurarCliente(props.clienteId)
}

function alRestaurar(resultado: ClienteContrasenaPortal) {
    estado.value = resultado
    toast.add({
        title: 'Contraseña del portal restaurada',
        description: textoSesionesCerradas(resultado.sesiones_cerradas),
        icon: 'i-lucide-key-round',
        color: 'success',
    })
}

watch(() => props.clienteId, cargar)
onMounted(cargar)

defineExpose({ cargar })
</script>

<template>
    <UPageCard
        title="Portal del cliente"
        description="Cómo entra el cliente al portal con su número de documento."
        icon="i-lucide-key-round"
        variant="subtle"
        data-prueba="cliente-portal"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="!estado"
            class="h-12 w-full"
        />
        <div
            v-else
            class="flex flex-col gap-3"
        >
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex flex-wrap items-center gap-2">
                    <UBadge
                        :label="estado.propia ? 'Contraseña propia' : 'Contraseña por defecto'"
                        :icon="estado.propia ? 'i-lucide-user-lock' : 'i-lucide-building-2'"
                        :color="estado.propia ? 'success' : 'neutral'"
                        variant="subtle"
                        data-prueba="portal-contrasena-tipo"
                    />
                    <span
                        class="text-xs text-muted"
                        data-prueba="portal-contrasena-detalle"
                    >
                        <template v-if="estado.propia">
                            Último cambio: {{ estado.actualizada_en ? formatearFechaHora(estado.actualizada_en) : '—' }}
                        </template>
                        <template v-else-if="estado.defecto_configurada">
                            Entra con la de su empresa; el portal le pedirá elegir una propia.
                        </template>
                        <template v-else>
                            Aún no eligió una contraseña propia.
                        </template>
                    </span>
                </div>
                <UButton
                    v-if="puedeRestaurar"
                    label="Restaurar contraseña por defecto"
                    icon="i-lucide-rotate-ccw"
                    color="neutral"
                    variant="outline"
                    class="self-start sm:self-auto"
                    data-prueba="abrir-restaurar-contrasena"
                    @click="confirmando = true"
                />
            </div>
            <UAlert
                v-if="!estado.defecto_configurada"
                color="warning"
                variant="subtle"
                icon="i-lucide-lock-open"
                title="Su empresa no tiene contraseña del portal por defecto"
                :description="estado.propia
                    ? 'Si se restaura, solo podrá entrar con código hasta que se configure en Ajustes → Contraseña del portal.'
                    : 'Solo puede entrar con código (o con «Ver mi cuenta» desde la página de corte) hasta que se configure en Ajustes → Contraseña del portal.'"
                data-prueba="portal-sin-defecto"
            />
        </div>
        <ConfirmacionModal
            v-if="puedeRestaurar"
            v-model:open="confirmando"
            titulo="Restaurar contraseña del portal"
            :efecto="efecto"
            confirmar="Restaurar"
            icono="i-lucide-rotate-ccw"
            color="warning"
            :ejecutar="restaurar"
            @hecho="alRestaurar"
        />
    </UPageCard>
</template>
