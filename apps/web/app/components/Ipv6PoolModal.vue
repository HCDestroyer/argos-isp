<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Agregar (`POST /ipv6-bloques/:id/pools`, `ipv6.crear`) o editar (`PUT /ipv6-pools/:id`,
 * `ipv6.editar`, con `version`) un pool IPv6 de un bloque. Mientras se escribe, la API dice qué
 * entregaría (`POST /ipv6-pools/vista-previa`): el atributo RADIUS, cuántos clientes caben, el primer
 * y el último prefijo y si se cruza con otro pool. «Sugerir» toma un prefijo libre del bloque. Con
 * prefijos en uso, el tipo y el tamaño no se cambian.
 */
const props = withDefaults(defineProps<{
    bloque: Ipv6Bloque
    /** Los pools del bloque (para sugerir uno libre). */
    pools?: Ipv6Pool[]
    pool?: Ipv6Pool | null
}>(), {
    pools: () => [],
    pool: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardado: [pool: Ipv6Pool]
}>()

const toast = useToast()
const { puede } = usePermisos()

const CIDR_V6 = /^[0-9a-fA-F:]+\/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$/

/** Espejo de `crearPoolIpv6Validator` / `editarPoolIpv6Validator`. */
const esquema = z.object({
    prefijo: z.string().trim().regex(CIDR_V6, 'Escribe el prefijo del pool con su tamaño, como 2001:db8:180::/41'),
    tipo: z.enum(['enlace', 'delegacion']),
    tamano_entrega: z.union([z.literal(64), z.literal(56), z.literal(48)]),
    nombre: z.string().trim().max(100, 'Acorta el nombre: máximo 100 caracteres'),
    nombre_en_router: z.string().trim().max(100, 'Máximo 100 caracteres'),
})
type Entrada = z.input<typeof esquema>

const formulario = useTemplateRef('formulario')
const actual = shallowRef<Ipv6Pool | null>(props.pool)
const estado = reactive<Entrada>({ prefijo: '', tipo: 'delegacion', tamano_entrega: 56, nombre: '', nombre_en_router: '' })
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const editando = computed(() => actual.value !== null)
/** Con prefijos entregados, el tipo y el tamaño quedan fijos (422 `pool_con_asignaciones`). */
const conAsignaciones = computed(() => (actual.value?.ocupacion.asignadas ?? 0) > 0)

const previa = shallowRef<VistaPreviaPoolIpv6 | null>(null)
let temporizador: ReturnType<typeof setTimeout> | undefined

function reiniciar(pool: Ipv6Pool | null) {
    actual.value = pool
    Object.assign(estado, {
        prefijo: pool?.prefijo ?? '',
        tipo: pool?.tipo ?? 'delegacion',
        tamano_entrega: pool?.tamano_entrega ?? 56,
        nombre: pool?.nombre ?? '',
        nombre_en_router: pool?.nombre_en_router ?? '',
    })
    problema.value = null
    previa.value = null
}

watch(abierto, (valor) => {
    if (valor) {
        reiniciar(props.pool)
        pedirPrevia()
    }
}, { immediate: true })

watch(() => estado.tipo, (tipo) => {
    if (tipo === 'enlace') {
        estado.tamano_entrega = 64
    }
})

const itemsTipo: SelectItem[] = [
    { label: 'Enlace (un /64 por cliente)', value: 'enlace', description: 'La conexión PPPoE entre el router del cliente y el tuyo.' },
    { label: 'Delegación (la red del cliente)', value: 'delegacion', description: 'El prefijo (PD) que el router del cliente reparte en su casa.' },
]
const itemsTamano: SelectItem[] = [
    { label: '/56 · 256 redes por cliente', value: 56 },
    { label: '/48 · 65,536 redes por cliente', value: 48 },
    { label: '/64 · una red por cliente', value: 64 },
]

async function cargarPrevia() {
    const prefijo = estado.prefijo.trim()
    if (!CIDR_V6.test(prefijo) || !puede('ipv6.ver')) {
        previa.value = null
        return
    }
    const resultado = await useIpv6Pools().vistaPrevia({ prefijo, tipo: estado.tipo, tamano_entrega: estado.tamano_entrega })
    if (prefijo === estado.prefijo.trim()) {
        previa.value = resultado.ok ? resultado.data : null
    }
}

function pedirPrevia() {
    clearTimeout(temporizador)
    temporizador = setTimeout(() => void cargarPrevia(), 300)
}

watch(() => [estado.prefijo, estado.tipo, estado.tamano_entrega], pedirPrevia)
onBeforeUnmount(() => clearTimeout(temporizador))

const traslapa = computed(() => (previa.value?.traslapa_con && previa.value.traslapa_con !== actual.value?.prefijo ? previa.value.traslapa_con : null))
const fueraDelBloque = computed(() => {
    const bloque = prefijoV6(props.bloque.prefijo)
    const pool = prefijoV6(estado.prefijo)
    return bloque !== null && pool !== null && !contiene(bloque, pool)
})

function sugerir() {
    const otros = props.pools.filter(p => p.id !== actual.value?.id).map(p => p.prefijo)
    const sugerido = sugerirPool(props.bloque.prefijo, otros, estado.tipo, estado.tamano_entrega)
    if (sugerido) {
        estado.prefijo = sugerido
        formulario.value?.clear('prefijo')
        return
    }
    toast.add({ title: 'No hay espacio libre en el bloque', description: 'Todos los prefijos de ese tamaño ya están en otro pool.', color: 'warning', icon: 'i-lucide-triangle-alert' })
}

async function recargar() {
    if (!actual.value) {
        return
    }
    const resultado = await useIpv6Pools().ver(actual.value.id)
    if (resultado.ok) {
        reiniciar(resultado.data)
        return
    }
    problema.value = resultado.problema
}

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const comun = { prefijo: d.prefijo, nombre: d.nombre || null, nombre_en_router: d.nombre_en_router || null }
    const resultado = actual.value
        ? await useIpv6Pools().editar(actual.value.id, {
                version: actual.value.version,
                ...comun,
                ...(conAsignaciones.value ? {} : { tipo: d.tipo, tamano_entrega: d.tamano_entrega }),
            })
        : await useIpv6Pools().crear(props.bloque.id, { ...comun, tipo: d.tipo, tamano_entrega: d.tamano_entrega })
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        toast.add({ title: editando.value ? `Pool ${resultado.data.prefijo} guardado` : `Pool ${resultado.data.prefijo} agregado`, color: 'success', icon: 'i-lucide-circle-check' })
        emit('guardado', resultado.data)
        return
    }
    const errores = codigoProblema(resultado.problema) ? [] : erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="editando ? `Editar pool ${actual?.prefijo}` : `Agregar pool en ${bloque.prefijo}`"
        :description="estado.tipo === 'enlace'
            ? 'Pool de enlace: de aquí sale el /64 de la conexión PPPoE de cada cliente.'
            : 'Pool de delegación: de aquí sale el prefijo (PD) que cada cliente usa en su propia red.'"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                id="form-pool-ipv6"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                data-prueba="form-pool"
                @submit="enviar"
            >
                <UAlert
                    v-if="problema?.status === 409 && codigoProblema(problema) === 'conflicto_version'"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="Alguien más cambió este pool"
                    description="Tus cambios no se guardaron. Carga la versión actual y vuelve a aplicarlos."
                    :actions="[{ label: 'Recargar', icon: 'i-lucide-rotate-cw', color: 'warning', variant: 'outline', onClick: recargar }]"
                />
                <ProblemaPools
                    v-else-if="problema"
                    :problema="problema"
                />

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Tipo"
                        name="tipo"
                        required
                        :help="conAsignaciones ? 'Tiene prefijos en uso: no se puede cambiar.' : undefined"
                    >
                        <USelect
                            v-model="estado.tipo"
                            :items="itemsTipo"
                            :disabled="conAsignaciones"
                            class="w-full"
                            data-prueba="pool-tipo"
                        />
                    </UFormField>
                    <UFormField
                        label="Tamaño que se entrega"
                        name="tamano_entrega"
                        required
                        :help="estado.tipo === 'enlace' ? 'El enlace siempre es /64.' : '/56 es lo habitual en hogares; /48 para empresas.'"
                    >
                        <USelect
                            v-model="estado.tamano_entrega"
                            :items="itemsTamano"
                            :disabled="estado.tipo === 'enlace' || conAsignaciones"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Prefijo del pool (CIDR)"
                    name="prefijo"
                    required
                    :help="`Dentro del bloque ${bloque.prefijo} y sin cruzarse con otro pool.`"
                >
                    <UFieldGroup class="w-full">
                        <UInput
                            v-model="estado.prefijo"
                            placeholder="2001:db8:180::/41"
                            class="w-full font-mono"
                            data-prueba="pool-prefijo"
                        />
                        <UButton
                            label="Sugerir"
                            icon="i-lucide-wand-sparkles"
                            color="neutral"
                            variant="outline"
                            data-prueba="pool-sugerir"
                            @click="sugerir"
                        />
                    </UFieldGroup>
                </UFormField>

                <UAlert
                    v-if="fueraDelBloque"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    title="Este prefijo no cae dentro del bloque"
                    :description="`Usa un prefijo dentro de ${bloque.prefijo} o pulsa «Sugerir».`"
                    data-prueba="pool-vista-previa"
                />
                <UAlert
                    v-else-if="traslapa"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="`Se cruza con el pool ${traslapa}`"
                    description="Pulsa «Sugerir» para tomar un prefijo libre."
                    data-prueba="pool-vista-previa"
                />
                <UAlert
                    v-else-if="previa"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-info"
                    :title="`Caben ${previa.clientes_maximos.toLocaleString('es-GT')} clientes`"
                    data-prueba="pool-vista-previa"
                >
                    <template #description>
                        <p>
                            Cada cliente recibe un /{{ previa.tamano_entrega }} por RADIUS ({{ previa.atributo_radius }}){{ previa.tipo === 'delegacion' ? `, que su router reparte en ${previa.redes_lan_por_cliente.toLocaleString('es-GT')} redes /64` : '' }}.
                        </p>
                        <ul class="mt-1 font-mono text-xs break-all">
                            <li>Cliente 1: {{ previa.primer_prefijo }}</li>
                            <li v-if="previa.segundo_prefijo">
                                Cliente 2: {{ previa.segundo_prefijo }}
                            </li>
                            <li>Último: {{ previa.ultimo_prefijo }}</li>
                        </ul>
                    </template>
                </UAlert>

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        hint="Opcional"
                    >
                        <UInput
                            v-model="estado.nombre"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Nombre en el router"
                        name="nombre_en_router"
                        hint="Opcional"
                        help="El pool de RouterOS (ipv6/pool) si el router reparte por su cuenta."
                    >
                        <UInput
                            v-model="estado.nombre_en_router"
                            class="w-full font-mono"
                        />
                    </UFormField>
                </div>
            </UForm>
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
                    type="submit"
                    form="form-pool-ipv6"
                    :label="editando ? 'Guardar' : 'Agregar'"
                    :icon="editando ? 'i-lucide-save' : 'i-lucide-plus'"
                    :loading="enviando"
                    data-prueba="pool-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
