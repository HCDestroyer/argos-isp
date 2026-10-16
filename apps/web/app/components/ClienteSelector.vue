<script setup lang="ts">
import type { InputMenuItem } from '@nuxt/ui'

/**
 * Busca un cliente en la API mientras se escribe (nombre, NIT, teléfono, usuario PPP o IP) y
 * devuelve su id. Emite el cliente completo para que el padre tenga nombre y dirección.
 */
const props = withDefaults(defineProps<{
    /** Cliente ya elegido, para mostrarlo como seleccionado. */
    seleccionado?: Cliente | null
    placeholder?: string
}>(), {
    seleccionado: null,
    placeholder: 'Nombre, NIT, teléfono, usuario PPP o IP',
})

const modelo = defineModel<number>({ default: 0 })

const emit = defineEmits<{
    elegido: [cliente: Cliente]
}>()

/** 0 = sin elegir; el InputMenu necesita `undefined` para no escribir "0" en el campo. */
const seleccion = computed<number | undefined>({
    get: () => modelo.value || undefined,
    set: (valor) => {
        modelo.value = valor ?? 0
    },
})

const termino = ref('')
const encontrados = shallowRef<Cliente[]>([])
const buscando = ref(false)
/** Título del Problem si la búsqueda falló: se muestra en lugar de "Ningún cliente coincide". */
const errorBusqueda = ref<string | null>(null)

const items = computed<InputMenuItem[]>(() => {
    const lista = props.seleccionado && !encontrados.value.some(c => c.id === props.seleccionado?.id)
        ? [props.seleccionado, ...encontrados.value]
        : encontrados.value
    return lista.map(cliente => ({
        label: cliente.nombre,
        value: cliente.id,
        description: [cliente.nit_cui, cliente.telefono].filter(Boolean).join(' · '),
        icon: cliente.tipo === 'empresa' ? 'i-lucide-building-2' : 'i-lucide-user',
    }))
})

/** Sin `clientes.ver` el buscador queda deshabilitado y no llama a la API (revisión de ACL, semana 3). */
const { puede } = usePermisos()
const puedeBuscar = computed(() => puede('clientes.ver'))

let temporizador: ReturnType<typeof setTimeout> | undefined
let solicitud = 0

async function buscar(q: string) {
    if (!puedeBuscar.value) {
        return
    }
    const actual = ++solicitud
    buscando.value = true
    const resultado = await useClientes().listar({ q, limit: 10 })
    if (actual !== solicitud) {
        return
    }
    buscando.value = false
    encontrados.value = resultado.ok ? resultado.data.data : []
    errorBusqueda.value = resultado.ok ? null : resultado.problema.title
}

watch(termino, (q) => {
    clearTimeout(temporizador)
    temporizador = setTimeout(() => buscar(q.trim()), 250)
})

watch(modelo, (id) => {
    const cliente = [props.seleccionado, ...encontrados.value].find(c => c?.id === id)
    if (cliente) {
        emit('elegido', cliente)
    }
})

onMounted(() => buscar(''))
onBeforeUnmount(() => clearTimeout(temporizador))
</script>

<template>
    <!--
        La `key` vuelve a montar el campo cuando llega el cliente elegido desde fuera (por ejemplo
        `?cliente=2` en la URL): el InputMenu solo calcula el texto mostrado al cambiar el valor,
        y sin esto mostraba el id ("2") en lugar del nombre.
    -->
    <UInputMenu
        :key="seleccionado?.id ?? 0"
        v-model="seleccion"
        v-model:search-term="termino"
        :items="items"
        value-key="value"
        ignore-filter
        :loading="buscando"
        :disabled="!puedeBuscar"
        icon="i-lucide-search"
        :placeholder="puedeBuscar ? placeholder : 'Sin permiso para buscar clientes (clientes.ver)'"
        class="w-full"
    >
        <template #empty>
            <span
                v-if="!buscando && errorBusqueda"
                class="text-error"
            >No se pudo buscar: {{ errorBusqueda }}</span>
            <template v-else>
                {{ buscando ? 'Buscando…' : 'Ningún cliente coincide' }}
            </template>
        </template>
    </UInputMenu>
</template>
