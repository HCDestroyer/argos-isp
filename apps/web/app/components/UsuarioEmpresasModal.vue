<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Empresas de un usuario (`PUT /usuarios/:id/empresas`, `usuarios.asignar_empresas`): alcance global
 * (todas las empresas y los consolidados) o una lista de empresas. Solo quien tiene alcance global
 * puede darlo y nadie reparte empresas fuera de su alcance: la lista solo trae las propias.
 */
const props = defineProps<{
    usuario: UsuarioPanel
    /** Empresas que quien asigna puede repartir (las activas de su alcance). */
    empresas: { id: number, nombre_comercial: string, nit: string | null }[]
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ guardado: [usuario: UsuarioPanel] }>()

const { alcanceGlobal: yoGlobal } = useEmpresaActiva()

const global = ref(false)
const elegidas = ref<string[]>([])
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const conflicto = ref(false)
const errorEmpresas = ref<string | null>(null)

watch(abierto, (valor) => {
    if (valor) {
        global.value = props.usuario.alcance_global === true
        elegidas.value = (props.usuario.empresas ?? []).map(String)
        problema.value = null
        conflicto.value = false
        errorEmpresas.value = null
    }
}, { immediate: true })

const items = computed(() => props.empresas.map(e => ({
    label: e.nombre_comercial,
    description: e.nit ? `NIT ${e.nit}` : undefined,
    value: String(e.id),
})))

async function guardar() {
    errorEmpresas.value = null
    if (!global.value && !elegidas.value.length) {
        errorEmpresas.value = 'Elige al menos una empresa'
        return
    }
    enviando.value = true
    problema.value = null
    conflicto.value = false
    const resultado = await useUsuarios().asignarEmpresas(props.usuario.id, {
        version: props.usuario.version,
        alcance_global: global.value,
        ...(global.value ? {} : { empresas: elegidas.value.map(Number) }),
    })
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
        return
    }
    if (resultado.problema.status === 409) {
        conflicto.value = true
        return
    }
    const campo = resultado.problema.errors?.find(e => e.field.startsWith('empresas'))
    if (campo) {
        errorEmpresas.value = campo.message
        return
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Empresas de ${usuario.nombre}`"
        description="En qué empresas (NIT) trabaja. El rol sigue siendo el mismo; la empresa acota dónde aplica."
    >
        <template #body>
            <div class="flex flex-col gap-4">
                <UAlert
                    v-if="conflicto"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="Alguien más cambió este usuario"
                    description="No se guardó. Cierra, vuelve a abrirlo y repite el cambio."
                />
                <ProblemaAlerta
                    v-else-if="problema"
                    :problema="problema"
                />

                <USwitch
                    v-model="global"
                    :disabled="!yoGlobal"
                    label="Alcance global"
                    :description="yoGlobal ? 'Ve y opera todas las empresas y los consolidados.' : 'Solo quien tiene alcance global puede darlo.'"
                    data-prueba="alcance-global"
                />

                <UFormField
                    v-if="!global"
                    label="Empresas"
                    :error="errorEmpresas ?? undefined"
                    required
                >
                    <UCheckboxGroup
                        v-model="elegidas"
                        :items="items"
                        data-prueba="empresas-usuario"
                    />
                </UFormField>
            </div>
        </template>

        <template #footer>
            <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    class="justify-center"
                    @click="abierto = false"
                />
                <UButton
                    label="Guardar empresas"
                    icon="i-lucide-check"
                    :loading="enviando"
                    class="justify-center"
                    data-prueba="guardar-empresas-usuario"
                    @click="guardar"
                />
            </div>
        </template>
    </UModal>
</template>
