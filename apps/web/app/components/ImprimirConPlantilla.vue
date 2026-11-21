<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Botón para imprimir un documento en PDF con su plantilla predeterminada y, al lado, «Imprimir
 * con…» para elegir otra plantilla activa del mismo tipo (p. ej. «POS 80 mm» para la impresora
 * térmica). Las plantillas se leen con `documentos.ver`; sin ese permiso, o si solo hay una, queda
 * solo el botón. Emite `imprimir` con el id de la plantilla elegida (null = la predeterminada); la
 * página abre el PDF.
 */
const props = withDefaults(defineProps<{
    tipo: TipoDocumento
    etiqueta?: string
    generando?: boolean
    variant?: 'solid' | 'outline'
}>(), {
    etiqueta: 'Imprimir',
    generando: false,
    variant: 'outline',
})

const emit = defineEmits<{ imprimir: [plantillaId: number | null] }>()

const { puede } = usePermisos()
const plantillas = shallowRef<PlantillaDocumentoResumen[]>([])
const problema = ref<Problem | null>(null)
const cargando = ref(false)

async function cargar() {
    if (!puede('documentos.ver')) {
        return
    }
    cargando.value = true
    const resultado = await usePlantillasDocumentos().listar({ tipo: props.tipo, activa: true })
    cargando.value = false
    plantillas.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
}

onMounted(cargar)

const opciones = computed<DropdownMenuItem[][]>(() => {
    if (problema.value) {
        return [[{
            label: 'No se pudieron leer las plantillas',
            description: 'Toca para reintentar',
            icon: 'i-lucide-refresh-cw',
            onSelect: (evento: Event) => {
                evento.preventDefault()
                void cargar()
            },
        }]]
    }
    return [plantillas.value.map(p => ({
        label: p.nombre,
        description: `${etiquetaFormato(p.formato)}${p.predeterminada ? ' · predeterminada' : ''}`,
        icon: p.formato === 'pos_80' ? 'i-lucide-receipt' : 'i-lucide-file-text',
        onSelect: () => emit('imprimir', p.predeterminada ? null : p.id),
    }))]
})

const conOpciones = computed(() => problema.value !== null || plantillas.value.length > 1)
</script>

<template>
    <UFieldGroup>
        <UButton
            :label="etiqueta"
            icon="i-lucide-printer"
            :color="variant === 'solid' ? 'primary' : 'neutral'"
            :variant="variant"
            :loading="generando"
            :data-prueba="`imprimir-${tipo}`"
            @click="emit('imprimir', null)"
        />
        <UDropdownMenu
            v-if="conOpciones"
            :items="opciones"
            :content="{ align: 'end' }"
        >
            <UButton
                icon="i-lucide-chevron-down"
                :color="variant === 'solid' ? 'primary' : 'neutral'"
                :variant="variant"
                :disabled="generando || cargando"
                aria-label="Elegir otra plantilla"
                title="Imprimir con…"
                :data-prueba="`imprimir-con-${tipo}`"
            />
        </UDropdownMenu>
    </UFieldGroup>
</template>
