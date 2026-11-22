<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { RadioGroupItem } from '@nuxt/ui'

/**
 * Estado del NIT de un cliente empresa en «Datos fiscales» (contrato Iris 0.14.1): «Verificado el …
 * por …» o «Sin verificar», y el botón «Verificar NIT» (`clientes.verificar_nit`, solo con NIT).
 * El botón abre un diálogo corto para elegir cómo se confirmó (documento a la vista o consulta en
 * la SAT). Solo un NIT verificado cuenta para pasar un servicio a esa empresa en el cambio de
 * titular. La marca se borra sola cuando alguien cambia el NIT.
 */
const props = defineProps<{
    cliente: Cliente
}>()

const emit = defineEmits<{
    verificado: [resultado: NitVerificado]
    /** 409: la ficha se volvió a leer porque el cliente cambió. */
    recargar: []
}>()

const { puede } = usePermisos()
const toast = useToast()

const abierto = ref(false)
const metodo = ref<DatosVerificarNit['metodo']>('documento')
const enviando = ref(false)
const problema = ref<Problem | null>(null)

const verificado = computed(() => props.cliente.nit_verificado_en !== null)
const puedeVerificar = computed(() => puede('clientes.verificar_nit') && !!props.cliente.nit_cui && props.cliente.tipo_documento_fiscal === 'nit')

const texto = computed(() => {
    if (!props.cliente.nit_verificado_en) {
        return 'Sin verificar'
    }
    const quien = props.cliente.nit_verificado_por_nombre ?? (props.cliente.nit_verificado_por ? `usuario #${props.cliente.nit_verificado_por}` : null)
    return `Verificado el ${formatearFechaHora(props.cliente.nit_verificado_en)}${quien ? ` por ${quien}` : ''}`
})

const opciones = computed<RadioGroupItem[]>(() => (Object.keys(METODOS_VERIFICAR_NIT) as DatosVerificarNit['metodo'][]).map(valor => ({
    label: METODOS_VERIFICAR_NIT[valor].etiqueta,
    description: METODOS_VERIFICAR_NIT[valor].descripcion,
    value: valor,
})))

function abrir() {
    metodo.value = 'documento'
    problema.value = null
    abierto.value = true
}

async function confirmar() {
    enviando.value = true
    problema.value = null
    const resultado = await useClientes().verificarNit(props.cliente.id, { version: props.cliente.version, metodo: metodo.value })
    enviando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    abierto.value = false
    toast.add({ title: 'NIT verificado', description: `${props.cliente.nombre} · ${formatearDocumento('nit', props.cliente.nit_cui)}`, icon: 'i-lucide-badge-check', color: 'success' })
    emit('verificado', resultado.data)
}
</script>

<template>
    <div
        class="flex flex-col gap-3 rounded-xl p-3 ring sm:flex-row sm:items-center"
        :class="verificado ? 'bg-success/8 ring-success/25' : 'bg-(--ax-panel) ring-(--ax-borde)'"
        data-prueba="nit-verificacion"
    >
        <span
            class="pastilla-icono pastilla-tono size-9 shrink-0 rounded-xl"
            :class="verificado ? 'tono-exito' : 'tono-aviso'"
        >
            <UIcon
                :name="verificado ? 'i-lucide-badge-check' : 'i-lucide-badge-help'"
                class="size-5"
            />
        </span>
        <div class="flex min-w-0 flex-1 flex-col">
            <p
                class="text-sm font-semibold"
                :class="verificado ? 'text-success' : 'text-highlighted'"
                data-prueba="nit-estado"
            >
                {{ texto }}
            </p>
            <p class="text-xs text-muted">
                {{ verificado
                    ? 'Este NIT cuenta para pasarle servicios a la empresa en un cambio de titular.'
                    : 'Mientras no se verifique, un cambio de titular a esta empresa queda en revisión.' }}
            </p>
        </div>
        <UButton
            v-if="puedeVerificar && !verificado"
            label="Verificar NIT"
            icon="i-lucide-badge-check"
            color="primary"
            variant="outline"
            size="sm"
            class="self-start rounded-full sm:self-auto"
            data-prueba="verificar-nit"
            @click="abrir"
        />

        <UModal
            v-model:open="abierto"
            title="Verificar NIT"
            :description="`${cliente.nombre} · NIT ${formatearDocumento('nit', cliente.nit_cui)}`"
            :dismissible="!enviando"
        >
            <template #body>
                <div class="flex flex-col gap-4">
                    <URadioGroup
                        v-model="metodo"
                        legend="¿Cómo lo confirmaste?"
                        :items="opciones"
                        variant="card"
                        data-prueba="metodo-nit"
                    />
                    <p class="text-sm text-muted">
                        Queda a tu nombre en la bitácora. Si después alguien cambia el NIT, la marca se borra sola.
                    </p>
                    <UAlert
                        v-if="problema"
                        color="error"
                        variant="subtle"
                        icon="i-lucide-circle-alert"
                        :title="problema.status === 409 ? 'El cliente cambió' : 'No se pudo verificar'"
                        :description="mensajeErrorVerificarNit(problema)"
                        :actions="problema.status === 409 ? [{ label: 'Recargar la ficha', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: () => { abierto = false; emit('recargar') } }] : undefined"
                        data-prueba="error-verificar-nit"
                    />
                </div>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        :icon="ICONOS.cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="enviando"
                        @click="abierto = false"
                    />
                    <UButton
                        label="Verificar NIT"
                        icon="i-lucide-badge-check"
                        :loading="enviando"
                        data-prueba="confirmar-verificar-nit"
                        @click="confirmar"
                    />
                </div>
            </template>
        </UModal>
    </div>
</template>
