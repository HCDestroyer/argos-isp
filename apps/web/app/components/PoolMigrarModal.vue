<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { SelectItem, TableColumn } from '@nuxt/ui'

/**
 * Mover una red IPv4 (`POST /redes-ipv4/:id/migrar`, `redes.migrar`) o un bloque IPv6 con sus pools
 * (`POST /ipv6-bloques/:id/migrar`, `ipv6.migrar`) a otro router. Primero se simula (`simular: true`)
 * y se muestran los servicios afectados con sus direcciones antes y después; luego se confirma. Un
 * servicio nunca queda en otro router que sus direcciones: con servicios hay que marcar «Mover
 * también los servicios» (si no, 422 `pool_con_servicios` con la lista).
 */
const props = defineProps<{
    tipo: 'red' | 'bloque'
    /** La red o el bloque que se muda. */
    entidad: RedIpv4 | Ipv6Bloque
    /** Lo demás del mismo router, para mudarlo junto (bloques si es una red, redes si es un bloque). */
    acompanantes: (RedIpv4 | Ipv6Bloque)[]
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    migrado: [resultado: MigracionPools]
}>()

const toast = useToast()
const { puede } = usePermisos()

const routers = shallowRef<RouterNas[]>([])
const destino = ref<number | undefined>(undefined)
const moverServicios = ref(true)
const junto = ref<number[]>([])
const simulacion = shallowRef<MigracionPools | null>(null)
const enviando = ref(false)
const problema = ref<Problem | null>(null)

const nombre = computed(() => ('cidr' in props.entidad ? `la red ${props.entidad.cidr}` : `el bloque ${props.entidad.prefijo}`))
const permisoServicios = computed(() => puede('servicios.editar'))

watch(abierto, async (valor) => {
    if (!valor) {
        return
    }
    destino.value = undefined
    moverServicios.value = permisoServicios.value
    junto.value = []
    simulacion.value = null
    problema.value = null
    const resultado = await useRouters().listar({ activo: true })
    routers.value = resultado.ok ? resultado.data.data.filter(r => r.id !== props.entidad.router_id) : []
    if (!resultado.ok) {
        problema.value = resultado.problema
    }
}, { immediate: true })

// Cualquier cambio invalida la simulación: hay que volver a revisar antes de confirmar.
watch([destino, moverServicios, junto], () => {
    simulacion.value = null
    problema.value = null
}, { deep: true })

const itemsRouter = computed<SelectItem[]>(() => routers.value.map(r => ({ label: r.nombre, value: r.id, description: r.host })))
const itemsJunto = computed(() => props.acompanantes.map(a => ({ label: 'cidr' in a ? `Red ${a.cidr}` : `Bloque ${a.prefijo}`, value: a.id })))
const nombreDestino = computed(() => routers.value.find(r => r.id === destino.value)?.nombre ?? '')

function cuerpo(simular: boolean) {
    const base = { version: props.entidad.version, router_id: destino.value ?? 0, mover_servicios: moverServicios.value, simular }
    return props.tipo === 'red' ? { ...base, bloques_ipv6: junto.value } : { ...base, redes_ipv4: junto.value }
}

async function ejecutar(simular: boolean) {
    if (!destino.value) {
        problema.value = { type: 'about:blank', title: 'Elige el router de destino', status: 422 }
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = props.tipo === 'red'
        ? await useRedesIpv4().migrar(props.entidad.id, cuerpo(simular))
        : await useIpv6Bloques().migrar(props.entidad.id, cuerpo(simular))
    enviando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        simulacion.value = null
        return
    }
    if (simular) {
        simulacion.value = resultado.data
        return
    }
    abierto.value = false
    toast.add({
        title: `Movido a ${nombreDestino.value}`,
        description: resultado.data.servicios.length ? `${resultado.data.servicios.length} ${resultado.data.servicios.length === 1 ? 'servicio pasó' : 'servicios pasaron'} con sus direcciones.` : 'No había servicios usando estas direcciones.',
        color: 'success',
        icon: 'i-lucide-circle-check',
    })
    emit('migrado', resultado.data)
}

type FilaServicio = MigracionPools['servicios'][number]

const columnas: TableColumn<FilaServicio>[] = [
    { accessorKey: 'user_ppp', header: 'Servicio' },
    { id: 'antes', header: 'Antes' },
    { id: 'despues', header: 'Después' },
]

function direcciones(d: FilaServicio['antes']): string[] {
    return [d.ipv4, d.prefijo_enlace_v6, d.prefijo_delegado_v6].filter((x): x is string => x !== null)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Mover ${nombre} a otro router`"
        description="Primero revisas qué servicios cambian de router y con qué direcciones; nada se guarda hasta que confirmas."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-4"
                data-prueba="migrar-pool"
            >
                <UFormField
                    label="Router de destino"
                    required
                    help="El router al que pasa la red o el bloque, y con ellos sus servicios."
                >
                    <USelect
                        v-model="destino"
                        :items="itemsRouter"
                        placeholder="Elige el router"
                        class="w-full"
                        data-prueba="migrar-destino"
                    />
                </UFormField>
                <UFormField
                    v-if="itemsJunto.length"
                    :label="tipo === 'red' ? 'Mover también bloques IPv6' : 'Mover también redes IPv4'"
                    hint="Opcional"
                    help="Así los servicios conservan también esas direcciones; si no, las reciben de nuevo en el destino."
                >
                    <USelectMenu
                        v-model="junto"
                        :items="itemsJunto"
                        value-key="value"
                        multiple
                        placeholder="Ninguno"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    help="Pasan al router de destino conservando las direcciones de lo que se mueve."
                >
                    <UCheckbox
                        v-model="moverServicios"
                        :disabled="!permisoServicios"
                        label="Mover también los servicios que usan estas direcciones"
                        :description="permisoServicios ? undefined : 'Necesitas permiso para editar servicios.'"
                        data-prueba="migrar-mover-servicios"
                    />
                </UFormField>

                <ProblemaPools
                    v-if="problema"
                    :problema="problema"
                />

                <section
                    v-if="simulacion"
                    class="flex flex-col gap-2"
                    data-prueba="migrar-simulacion"
                >
                    <UAlert
                        color="info"
                        variant="subtle"
                        icon="i-lucide-eye"
                        :title="simulacion.servicios.length ? `${simulacion.servicios.length} ${simulacion.servicios.length === 1 ? 'servicio pasará' : 'servicios pasarán'} a ${nombreDestino}` : 'Ningún servicio usa estas direcciones'"
                        description="Esto es una revisión: todavía no se guardó nada."
                    />
                    <UTable
                        v-if="simulacion.servicios.length"
                        :data="simulacion.servicios"
                        :columns="columnas"
                        tabindex="0"
                        aria-label="Servicios que cambian de router"
                        class="max-h-72"
                    >
                        <template #user_ppp-cell="{ row }">
                            <span class="font-mono text-sm">{{ row.original.user_ppp ?? `#${row.original.servicio_id}` }}</span>
                        </template>
                        <template #antes-cell="{ row }">
                            <ul class="font-mono text-xs text-muted">
                                <li
                                    v-for="d in direcciones(row.original.antes)"
                                    :key="d"
                                >
                                    {{ d }}
                                </li>
                            </ul>
                        </template>
                        <template #despues-cell="{ row }">
                            <ul class="font-mono text-xs">
                                <li
                                    v-for="d in direcciones(row.original.despues)"
                                    :key="d"
                                    :class="direcciones(row.original.antes).includes(d) ? 'text-muted' : 'text-warning'"
                                >
                                    {{ d }}
                                </li>
                            </ul>
                        </template>
                    </UTable>
                </section>
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
                    v-if="!simulacion"
                    label="Revisar"
                    icon="i-lucide-eye"
                    :loading="enviando"
                    data-prueba="migrar-revisar"
                    @click="ejecutar(true)"
                />
                <UButton
                    v-else
                    label="Confirmar y mover"
                    icon="i-lucide-arrow-right-left"
                    class="glow-brand"
                    :loading="enviando"
                    data-prueba="migrar-confirmar"
                    @click="ejecutar(false)"
                />
            </div>
        </template>
    </UModal>
</template>
