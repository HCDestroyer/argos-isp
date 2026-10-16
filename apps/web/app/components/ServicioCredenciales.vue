<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Usuario y contraseña PPPoE. La contraseña solo se pide al hacer clic (`GET
 * /servicios/:id/credenciales`, permiso `servicios.ver_credenciales`) porque cada consulta
 * queda en la bitácora; la vista `Servicio` nunca la trae.
 */
const props = defineProps<{
    servicio: Servicio
}>()

const emit = defineEmits<{
    consultado: []
}>()

const { puede } = usePermisos()
const toast = useToast()

const clave = ref<string | null>(null)
const visible = ref(false)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function mostrar() {
    if (clave.value) {
        visible.value = true
        return
    }
    cargando.value = true
    problema.value = null
    const resultado = await useServicios().credenciales(props.servicio.id)
    cargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    clave.value = resultado.data.pass_ppp
    visible.value = true
    emit('consultado')
}

async function copiar(texto: string, que: string) {
    try {
        await navigator.clipboard.writeText(texto)
        toast.add({ title: `${que} copiado`, icon: 'i-lucide-copy', color: 'success' })
    }
    catch {
        toast.add({ title: `No se pudo copiar el ${que.toLowerCase()}`, color: 'error' })
    }
}

watch(() => props.servicio.id, () => {
    clave.value = null
    visible.value = false
    problema.value = null
})
</script>

<template>
    <dl class="flex flex-col gap-4">
        <div class="flex flex-col gap-0.5">
            <dt class="text-xs font-medium text-muted">
                Usuario PPPoE
            </dt>
            <dd class="flex items-center gap-1 font-mono text-sm text-highlighted">
                <span class="break-all">{{ servicio.user_ppp }}</span>
                <UButton
                    icon="i-lucide-copy"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    aria-label="Copiar usuario"
                    @click="copiar(servicio.user_ppp ?? '', 'Usuario')"
                />
            </dd>
        </div>

        <div class="flex flex-col gap-1">
            <dt class="text-xs font-medium text-muted">
                Contraseña PPPoE
            </dt>
            <dd
                v-if="!puede('servicios.ver_credenciales')"
                class="text-sm text-muted"
            >
                Sin permiso para ver la contraseña.
            </dd>
            <dd
                v-else
                class="flex flex-col gap-2"
            >
                <div class="flex flex-wrap items-center gap-1">
                    <span class="break-all font-mono text-sm text-highlighted">{{ visible && clave ? clave : '••••••••••••' }}</span>
                    <UButton
                        v-if="visible && clave"
                        icon="i-lucide-copy"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        aria-label="Copiar contraseña"
                        @click="copiar(clave, 'Contraseña')"
                    />
                    <UButton
                        :label="visible ? 'Ocultar' : 'Mostrar'"
                        :icon="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                        color="neutral"
                        variant="outline"
                        size="xs"
                        :loading="cargando"
                        @click="visible ? (visible = false) : mostrar()"
                    />
                </div>
                <span class="text-xs text-muted">Cada consulta queda registrada en la bitácora.</span>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="mostrar"
                    :reintentando="cargando"
                />
            </dd>
        </div>
    </dl>
</template>
