<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Cambio de país de la localización fiscal (`POST /empresas/:id/cambiar-pais`,
 * `empresas.cambiar_pais`, solo admin). Reinstala el paquete del país nuevo; solo se permite sin
 * documentos (409 `empresa_con_documentos`). Pide confirmar escribiendo el código del país.
 */
const props = defineProps<{
    empresa: EmpresaGrupo
    paises: PaisLocalizacion[]
}>()

const abierto = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ hecho: [empresa: EmpresaGrupo] }>()

const pais = ref<string>('')
const confirmacion = ref('')
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

const actual = computed(() => props.empresa.pais ?? 'GT')
const itemsPais = computed(() => props.paises.map(p => ({ label: `${p.nombre} (${p.codigo})`, value: p.codigo, disabled: p.codigo === actual.value })))
const otros = computed(() => props.paises.filter(p => p.codigo !== actual.value))
const { puede } = usePermisos()
const listo = computed(() => puede('empresas.cambiar_pais') && pais.value !== '' && pais.value !== actual.value && confirmacion.value.trim().toUpperCase() === pais.value)

watch(abierto, (valor) => {
    if (valor) {
        pais.value = otros.value[0]?.codigo ?? ''
        confirmacion.value = ''
        problema.value = null
        clave = nuevaClaveIdempotencia()
    }
})

async function confirmar() {
    if (!listo.value) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useEmpresas().cambiarPais(props.empresa.id, pais.value, props.empresa.version, clave)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('hecho', resultado.data)
        return
    }
    problema.value = problemaFiscalLegible(resultado.problema)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Cambiar país"
        :description="`${empresa.nombre_comercial} · país actual ${actual}`"
        :dismissible="!enviando"
    >
        <template #body>
            <div class="flex flex-col gap-4">
                <UAlert
                    color="error"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    title="Reinstala la localización fiscal"
                    description="Cambia el plan de cuentas, los parámetros y los impuestos de la empresa por los del país nuevo. Solo se permite si la empresa aún no tiene facturas, pagos, asientos ni documentos fiscales."
                />
                <UAlert
                    v-if="!otros.length"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-info"
                    :description="`Por ahora solo hay paquete fiscal para ${paises.map(p => p.nombre).join(', ') || actual}: no hay otro país al que cambiar.`"
                    data-prueba="sin-otro-pais"
                />
                <template v-else>
                    <UFormField
                        label="País nuevo"
                        required
                    >
                        <USelect
                            v-model="pais"
                            :items="itemsPais"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        :label="`Escribe ${pais || 'el código'} para confirmar`"
                        required
                    >
                        <UInput
                            v-model="confirmacion"
                            class="w-full font-mono uppercase"
                            autocomplete="off"
                        />
                    </UFormField>
                </template>
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
            </div>
        </template>
        <template #footer>
            <div class="flex w-full justify-end gap-2">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    @click="abierto = false"
                />
                <UButton
                    label="Cambiar país"
                    icon="i-lucide-globe"
                    color="error"
                    :disabled="!listo"
                    :loading="enviando"
                    @click="confirmar"
                />
            </div>
        </template>
    </UModal>
</template>
