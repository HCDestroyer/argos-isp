<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Agregar (`POST /routers/:id/ipv6-bloques`, `ipv6.crear`) o editar (`PUT /ipv6-bloques/:id`,
 * `ipv6.editar`, con `version`) un bloque IPv6: prefijo, nombre y proveedor (un router puede tener
 * bloques de varios proveedores). Mientras se escribe, la API sugiere cómo repartirlo
 * (`POST /ipv6-bloques/vista-previa`): cuántos clientes caben, los dos pools y lo que recibe cada
 * cliente. Al agregar, «Crear también los pools sugeridos» deja el bloque listo en un paso.
 */
const props = withDefaults(defineProps<{
    routerId: number
    bloque?: Ipv6Bloque | null
}>(), {
    bloque: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardado: [bloque: Ipv6Bloque]
}>()

const toast = useToast()
const { puede } = usePermisos()

const CIDR_V6 = /^[0-9a-fA-F:]+\/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$/

/** Espejo de `crearBloqueIpv6Validator` / `editarBloqueIpv6Validator`. */
const esquema = z.object({
    prefijo: z.string().trim().regex(CIDR_V6, 'Escribe el prefijo con su tamaño, como 2001:db8:100::/40'),
    nombre: z.string().trim().max(100, 'Acorta el nombre: máximo 100 caracteres'),
    proveedor: z.string().trim().max(100, 'Acorta el proveedor: máximo 100 caracteres'),
})
type Entrada = z.input<typeof esquema>

const formulario = useTemplateRef('formulario')
const actual = shallowRef<Ipv6Bloque | null>(props.bloque)
const estado = reactive<Entrada>({ prefijo: '', nombre: '', proveedor: '' })
const tamanoDelegado = ref<64 | 56 | 48>(56)
const crearPools = ref(true)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const editando = computed(() => actual.value !== null)

const previa = shallowRef<VistaPreviaBloqueIpv6 | null>(null)
const cargandoPrevia = ref(false)
let temporizador: ReturnType<typeof setTimeout> | undefined

function reiniciar(bloque: Ipv6Bloque | null) {
    actual.value = bloque
    Object.assign(estado, { prefijo: bloque?.prefijo ?? '', nombre: bloque?.nombre ?? '', proveedor: bloque?.proveedor ?? '' })
    problema.value = null
    previa.value = null
}

watch(abierto, (valor) => {
    if (valor) {
        reiniciar(props.bloque)
        crearPools.value = true
        pedirPrevia()
    }
}, { immediate: true })

const itemsDelegado: SelectItem[] = [
    { label: '/56 por cliente (256 redes en su casa)', value: 56 },
    { label: '/48 por cliente (65,536 redes, empresas)', value: 48 },
    { label: '/64 por cliente (una sola red)', value: 64 },
]

async function cargarPrevia() {
    const prefijo = estado.prefijo.trim()
    if (!CIDR_V6.test(prefijo) || !puede('ipv6.ver')) {
        previa.value = null
        return
    }
    cargandoPrevia.value = true
    const resultado = await useIpv6Bloques().vistaPrevia({ prefijo, tamano_delegado: tamanoDelegado.value })
    cargandoPrevia.value = false
    if (prefijo === estado.prefijo.trim()) {
        previa.value = resultado.ok ? resultado.data : null
    }
}

function pedirPrevia() {
    clearTimeout(temporizador)
    temporizador = setTimeout(() => void cargarPrevia(), 300)
}

watch(() => estado.prefijo, pedirPrevia)
watch(tamanoDelegado, pedirPrevia)
onBeforeUnmount(() => clearTimeout(temporizador))

/** La previa se cruza con otro bloque que no es este mismo. */
const traslapa = computed(() => (previa.value?.traslapa_con && previa.value.traslapa_con !== actual.value?.prefijo ? previa.value.traslapa_con : null))

async function recargar() {
    if (!actual.value) {
        return
    }
    const resultado = await useIpv6Bloques().ver(actual.value.id)
    if (resultado.ok) {
        reiniciar(resultado.data)
        return
    }
    problema.value = resultado.problema
}

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const datos = { prefijo: evento.data.prefijo, nombre: evento.data.nombre || null, proveedor: evento.data.proveedor || null }
    const resultado = actual.value
        ? await useIpv6Bloques().editar(actual.value.id, { version: actual.value.version, ...datos })
        : await useRouters().agregarBloque(props.routerId, datos)
    if (!resultado.ok) {
        enviando.value = false
        const errores = codigoProblema(resultado.problema) ? [] : erroresDeFormulario(resultado.problema)
        if (errores.length) {
            formulario.value?.setErrors(errores)
        }
        problema.value = resultado.problema
        return
    }
    let creados = 0
    if (!editando.value && crearPools.value && previa.value && puede('ipv6.crear')) {
        for (const sugerido of previa.value.pools_sugeridos) {
            const pool = await useIpv6Pools().crear(resultado.data.id, { prefijo: sugerido.prefijo, tipo: sugerido.tipo, tamano_entrega: sugerido.tamano_entrega })
            if (pool.ok) {
                creados++
            }
            else {
                toast.add({ title: `No se pudo crear el pool ${sugerido.prefijo}`, description: pool.problema.detail ?? pool.problema.title, color: 'warning', icon: 'i-lucide-triangle-alert' })
            }
        }
    }
    enviando.value = false
    abierto.value = false
    toast.add({
        title: editando.value ? `Bloque ${resultado.data.prefijo} guardado` : `Bloque ${resultado.data.prefijo} agregado`,
        description: creados ? `Con ${creados === 1 ? '1 pool' : `${creados} pools`}: ya puede entregar IPv6.` : undefined,
        color: 'success',
        icon: 'i-lucide-circle-check',
    })
    emit('guardado', resultado.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="editando ? `Editar bloque ${actual?.prefijo}` : 'Agregar bloque IPv6'"
        description="El bloque es el rango IPv6 que te asignó tu proveedor para este router. Si tienes rangos de varios proveedores, agrega un bloque por cada uno."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                id="form-bloque-ipv6"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                data-prueba="form-bloque"
                @submit="enviar"
            >
                <UAlert
                    v-if="problema?.status === 409 && codigoProblema(problema) === 'conflicto_version'"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="Alguien más cambió este bloque"
                    description="Tus cambios no se guardaron. Carga la versión actual y vuelve a aplicarlos."
                    :actions="[{ label: 'Recargar', icon: 'i-lucide-rotate-cw', color: 'warning', variant: 'outline', onClick: recargar }]"
                />
                <ProblemaPools
                    v-else-if="problema"
                    :problema="problema"
                />

                <UFormField
                    label="Prefijo (CIDR)"
                    name="prefijo"
                    required
                    help="Tal como te lo dio el proveedor, con su tamaño: 2001:db8:100::/40. Al editar puedes agrandarlo o achicarlo si los pools siguen cabiendo."
                >
                    <UInput
                        v-model="estado.prefijo"
                        placeholder="2001:db8:100::/40"
                        class="w-full font-mono"
                        data-prueba="bloque-prefijo"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Proveedor"
                        name="proveedor"
                        hint="Opcional"
                        help="Quién te asignó el rango."
                    >
                        <UInput
                            v-model="estado.proveedor"
                            placeholder="Tigo Business"
                            class="w-full"
                            data-prueba="bloque-proveedor"
                        />
                    </UFormField>
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        hint="Opcional"
                        help="Para reconocerlo en el panel."
                    >
                        <UInput
                            v-model="estado.nombre"
                            placeholder="Principal"
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <section
                    v-if="!editando"
                    class="flex flex-col gap-3 rounded-md border border-default p-3"
                    aria-label="Cómo se repartiría el bloque"
                    data-prueba="bloque-vista-previa"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3 class="text-sm font-semibold text-highlighted">
                            Cómo se repartiría
                        </h3>
                        <USelect
                            v-model="tamanoDelegado"
                            :items="itemsDelegado"
                            size="sm"
                            class="w-full sm:w-72"
                            aria-label="Prefijo delegado por cliente"
                        />
                    </div>
                    <USkeleton
                        v-if="cargandoPrevia && !previa"
                        class="h-20 w-full"
                    />
                    <p
                        v-else-if="!previa"
                        class="text-sm text-muted"
                    >
                        Escribe el prefijo para ver cuántos clientes caben y qué recibe cada uno.
                    </p>
                    <template v-else>
                        <UAlert
                            v-if="traslapa"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-triangle-alert"
                            :title="`Se cruza con el bloque ${traslapa}`"
                            description="No se podrá guardar: revisa el prefijo."
                        />
                        <p
                            class="flex items-center gap-2 text-sm text-success"
                            data-prueba="bloque-clientes"
                        >
                            <UIcon
                                name="i-lucide-users"
                                class="size-4 shrink-0"
                            />
                            Caben {{ previa.clientes.toLocaleString('es-GT') }} clientes, cada uno con {{ previa.redes_lan_por_cliente.toLocaleString('es-GT') }} {{ previa.redes_lan_por_cliente === 1 ? 'red' : 'redes' }} /64 en su casa.
                        </p>
                        <ul class="grid gap-2 sm:grid-cols-2">
                            <li
                                v-for="sugerido in previa.pools_sugeridos"
                                :key="sugerido.prefijo"
                                class="flex flex-col rounded-md bg-elevated/50 p-2 text-xs"
                            >
                                <span class="font-medium text-highlighted">{{ sugerido.tipo === 'enlace' ? 'Pool de enlace' : 'Pool de delegación' }} · /{{ sugerido.tamano_entrega }} por cliente</span>
                                <span class="font-mono break-all">{{ sugerido.prefijo }}</span>
                            </li>
                        </ul>
                        <ul class="flex flex-col gap-0.5 font-mono text-xs break-all text-muted">
                            <li
                                v-for="ejemplo in previa.ejemplos"
                                :key="ejemplo.servicio"
                            >
                                Cliente {{ ejemplo.servicio }}: enlace {{ ejemplo.prefijo_enlace }} · su red {{ ejemplo.prefijo_delegado }}
                            </li>
                        </ul>
                        <UCheckbox
                            v-if="puede('ipv6.crear')"
                            v-model="crearPools"
                            label="Crear también estos dos pools"
                            description="Así el bloque queda listo para entregar IPv6. Puedes cambiarlos después."
                            data-prueba="bloque-crear-pools"
                        />
                    </template>
                </section>
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
                    form="form-bloque-ipv6"
                    :label="editando ? 'Guardar' : 'Agregar'"
                    :icon="editando ? 'i-lucide-save' : 'i-lucide-plus'"
                    :loading="enviando"
                    data-prueba="bloque-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
