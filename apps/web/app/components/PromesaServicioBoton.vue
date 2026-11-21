<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'

/**
 * Botón «Promesa» de un cliente: la promesa es por servicio (decisión del PM), así que con un
 * servicio abre el alta de promesa directo y con varios pregunta cuál. Sin servicios que puedan
 * tener deuda (pendientes de instalación o retirados) no se muestra. Requiere `promesas.crear`.
 */
const props = withDefaults(defineProps<{
    servicios: Servicio[] | null
    boton?: ButtonProps
    /** Círculo flotante con solo el ícono (franja de la ficha); el nombre va en `aria-label` y `title`. */
    soloIcono?: boolean
}>(), {
    boton: () => ({}),
    soloIcono: false,
})

const emit = defineEmits<{
    creada: []
}>()

const { puede } = usePermisos()
const toast = useToast()

const elegibles = computed(() => props.servicios?.filter(s => s.estado !== 'pendiente_instalacion' && s.estado !== 'retirado') ?? [])
const servicio = shallowRef<Servicio | null>(null)
const abierto = ref(false)

function abrir(elegido: Servicio) {
    servicio.value = elegido
    abierto.value = true
}

const items = computed(() => elegibles.value.map(s => ({
    label: etiquetaServicio(s),
    description: s.plan_nombre,
    icon: 'i-lucide-wifi',
    onSelect: () => abrir(s),
})))

function alCrear() {
    toast.add({ title: 'Promesa registrada', icon: 'i-lucide-hand', color: 'success' })
    emit('creada')
}

const propsBoton = computed<ButtonProps>(() => (props.soloIcono
    ? { icon: 'i-lucide-hand', color: 'neutral', variant: 'ghost', class: 'boton-flotante boton-circulo', ...props.boton }
    : { label: 'Promesa', icon: 'i-lucide-hand', color: 'neutral', variant: 'outline', ...props.boton }))
const atributos = computed(() => (props.soloIcono ? { 'aria-label': 'Promesa de pago', 'title': 'Promesa de pago' } : {}))
</script>

<template>
    <template v-if="puede('promesas.crear') && elegibles.length">
        <UButton
            v-if="elegibles.length === 1"
            v-bind="{ ...propsBoton, ...atributos }"
            data-prueba="promesa-cliente"
            @click="abrir(elegibles[0]!)"
        />
        <UDropdownMenu
            v-else
            :items="[[{ type: 'label', label: '¿De qué servicio?' }, ...items]]"
        >
            <UButton
                v-bind="{ ...propsBoton, ...atributos }"
                data-prueba="promesa-cliente"
            />
        </UDropdownMenu>
        <PromesaCrearModal
            v-if="servicio"
            v-model:open="abierto"
            :servicio="servicio"
            @creada="alCrear"
        />
    </template>
</template>
