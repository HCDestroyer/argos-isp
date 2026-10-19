<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem } from '@nuxt/ui'

/**
 * Elige una cuenta bancaria del libro (subcuenta `1.1.02.NN`, se manda como `cuenta_id`): las
 * cuentas propias (`GET /cuentas-bancarias`, `cuentas_bancarias.ver`) y los bancos del libro
 * (`GET /libro/bancos`, `egresos.ver`) sin repetir. Lee solo lo que el usuario puede ver; si una
 * lista falla muestra el error con "Reintentar" en lugar de ofrecer menos cuentas.
 */
const props = withDefaults(defineProps<{
    placeholder?: string
    /** Agrega una opción para "todas las cuentas" (`null`), para filtros. */
    conTodas?: boolean
    /** Sin esta cuenta (p. ej. el origen de un traslado no puede ser su destino). */
    excepto?: number | null
    disabled?: boolean
}>(), {
    placeholder: 'Elige la cuenta',
    conTodas: false,
    excepto: null,
    disabled: false,
})

const modelo = defineModel<number | null>({ default: null })

const emit = defineEmits<{
    cargadas: [cuentas: CuentaBanco[]]
}>()

const { puede } = usePermisos()
const cuentas = shallowRef<CuentaBanco[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const TODAS = 0

const items = computed<SelectItem[]>(() => [
    ...(props.conTodas ? [{ label: 'Todas las cuentas', value: TODAS }] : []),
    ...itemsCuentasBanco(cuentas.value.filter(c => c.cuenta_id !== props.excepto)),
])

/** El select trabaja con 0 para "todas"; hacia afuera es `null`. */
const seleccion = computed<number | undefined>({
    get: () => (modelo.value === null ? (props.conTodas ? TODAS : undefined) : modelo.value),
    set: (valor) => {
        modelo.value = valor === undefined || valor === TODAS ? null : valor
    },
})

async function cargar() {
    cargando.value = true
    problema.value = null
    const [propias, delLibro] = await Promise.all([
        puede('cuentas_bancarias.ver') ? useCuentasBancarias().listar({ activa: true }) : null,
        puede('egresos.ver') ? useLibro().bancos() : null,
    ])
    cargando.value = false
    const fallo = (propias && !propias.ok ? propias.problema : null) ?? (delLibro && !delLibro.ok ? delLibro.problema : null)
    if (fallo) {
        cuentas.value = []
        problema.value = fallo
        return
    }
    cuentas.value = cuentasBanco(propias?.ok ? propias.data : [], delLibro?.ok ? delLibro.data : [])
    if (modelo.value === null && !props.conTodas && cuentas.value.length === 1) {
        modelo.value = cuentas.value[0]?.cuenta_id ?? null
    }
    emit('cargadas', cuentas.value)
}

onMounted(cargar)
</script>

<template>
    <ProblemaAlerta
        v-if="problema"
        :problema="problema"
        :reintentar="cargar"
        :reintentando="cargando"
    />
    <USelect
        v-else
        v-model="seleccion"
        :items="items"
        :placeholder="placeholder"
        :loading="cargando"
        :disabled="disabled"
        class="w-full"
    />
</template>
