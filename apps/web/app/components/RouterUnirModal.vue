<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { RadioGroupItem, SelectItem } from '@nuxt/ui'

/**
 * Unir dos registros del mismo MikroTik (`POST /routers/:id/unir`, `routers.unir`, solo admin;
 * `contratos/routers.md` §3). El operador elige qué router queda; el panel pide la simulación
 * (`simular: true`) y muestra qué se mueve y que nadie se desconecta. Confirmar manda la misma
 * petición sin `simular`, con la `version` del que queda e `Idempotency-Key`.
 */
const props = defineProps<{
    grupo: GrupoRoutersDuplicados
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    unido: [resultado: UnionRouters]
}>()

const toast = useToast()

const routers = shallowRef<RouterDuplicado[]>(props.grupo.routers)
const quedaId = ref<number | null>(null)
const absorberId = ref<number | null>(null)
const vista = shallowRef<UnionRouters | null>(null)
const simulando = ref(false)
const problemaVista = ref<Problem | null>(null)
const confirmado = ref(false)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()
let consulta = 0

const queda = computed(() => routers.value.find(r => r.id === quedaId.value) ?? null)
const candidatos = computed(() => routers.value.filter(r => r.id !== quedaId.value))
const absorbido = computed(() => candidatos.value.find(r => r.id === absorberId.value) ?? null)

const itemsQueda = computed<RadioGroupItem[]>(() => routers.value.map(r => ({
    label: r.nombre,
    value: r.id,
    description: `${hostYNas(r)} · ${enPlural(r.servicios_total, 'servicio', 'servicios')} · ${enPlural(r.sesiones_abiertas, 'sesión abierta', 'sesiones abiertas')}`,
})))

const itemsAbsorber = computed<SelectItem[]>(() => candidatos.value.map(r => ({ label: r.nombre, value: r.id, description: hostYNas(r) })))

const puedeConfirmar = computed(() => Boolean(vista.value && vista.value.bloqueos.length === 0 && confirmado.value && !simulando.value))

function elegirInicial() {
    // El de más sesiones abiertas: es el registro con el que el equipo habla RADIUS.
    const sugerido = routerSugerido(routers.value)
    quedaId.value = sugerido?.id ?? null
    absorberId.value = routers.value.find(r => r.id !== quedaId.value)?.id ?? null
}

async function simular() {
    const actual = queda.value
    const otro = absorbido.value
    vista.value = null
    problemaVista.value = null
    confirmado.value = false
    if (!actual || !otro) {
        return
    }
    const turno = ++consulta
    simulando.value = true
    const resultado = await useRouters().unir(actual.id, { version: actual.version, absorber_id: otro.id, simular: true })
    if (turno !== consulta) {
        return
    }
    simulando.value = false
    vista.value = resultado.ok ? resultado.data : null
    problemaVista.value = resultado.ok ? null : resultado.problema
}

/** Lee otra vez el grupo (versiones nuevas, servicios que llegaron) y repite la simulación. */
async function recargar() {
    const id = quedaId.value ?? routers.value[0]?.id
    problema.value = null
    const resultado = id ? await useRouters().duplicados(id) : null
    if (resultado && !resultado.ok) {
        problemaVista.value = resultado.problema
        return
    }
    const grupo = resultado?.data[0]
    if (grupo) {
        routers.value = grupo.routers
    }
    await simular()
}

watch(abierto, (valor) => {
    if (valor) {
        routers.value = props.grupo.routers
        problema.value = null
        clave = nuevaClaveIdempotencia()
        elegirInicial()
        void simular()
    }
}, { immediate: true })

watch(quedaId, () => {
    if (abierto.value && absorberId.value === quedaId.value) {
        absorberId.value = candidatos.value[0]?.id ?? null
    }
})

watch([quedaId, absorberId], () => {
    if (abierto.value) {
        clave = nuevaClaveIdempotencia()
        void simular()
    }
})

async function unir() {
    const actual = queda.value
    const otro = absorbido.value
    if (!actual || !otro || !puedeConfirmar.value) {
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useRouters().unir(actual.id, { version: actual.version, absorber_id: otro.id }, clave)
    enviando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        clave = nuevaClaveIdempotencia()
        return
    }
    abierto.value = false
    toast.add({
        title: `«${resultado.data.absorbido.nombre}» quedó unido a «${resultado.data.router.nombre}»`,
        description: `Pasaron ${enPlural(resultado.data.servicios.length, 'servicio', 'servicios')} y ${enPlural(resultado.data.sesiones_abiertas, 'sesión abierta', 'sesiones abiertas')}; nadie se desconectó.`,
        icon: 'i-lucide-merge',
        color: 'success',
    })
    emit('unido', resultado.data)
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        title="Unir routers duplicados"
        :description="`${nombresGrupo(routers)} son el mismo MikroTik. Elige cuál queda: el otro le pasa servicios, sesiones, redes y planes, y queda desactivado.`"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <div
                class="flex flex-col gap-5"
                data-prueba="unir-routers"
            >
                <UFormField
                    label="Router que queda"
                    name="queda"
                    help="Conviene conservar el registro cuya IP de NAS y secreto RADIUS usa el equipo: el otro deja de ser cliente de RADIUS."
                >
                    <URadioGroup
                        v-model="quedaId"
                        :items="itemsQueda"
                        variant="card"
                        :disabled="enviando"
                        data-prueba="unir-queda"
                    />
                </UFormField>
                <UFormField
                    v-if="candidatos.length > 1"
                    label="Router que se absorbe"
                    name="absorber_id"
                    help="Se unen de dos en dos; repite la unión con el resto del grupo."
                >
                    <USelect
                        v-model="absorberId"
                        :items="itemsAbsorber"
                        class="w-full"
                        :disabled="enviando"
                        data-prueba="unir-absorber"
                    />
                </UFormField>

                <USkeleton
                    v-if="simulando"
                    class="h-48 w-full"
                    data-prueba="unir-cargando"
                />
                <ProblemaAlerta
                    v-else-if="problemaVista"
                    :problema="problemaVista"
                    :reintentar="recargar"
                    :reintentando="simulando"
                    data-prueba="unir-error-vista"
                />
                <template v-else-if="vista">
                    <RouterUnionVistaPrevia :vista="vista" />
                    <UCheckbox
                        v-if="vista.bloqueos.length === 0"
                        v-model="confirmado"
                        :label="`Confirmo que es el mismo MikroTik y que queda «${vista.router.nombre}»`"
                        description="La unión no se deshace: el absorbido queda desactivado con su historial."
                        data-prueba="unir-confirmar"
                    />
                </template>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="recargar"
                    con-errores
                    data-prueba="unir-error"
                />
            </div>
        </template>
        <template #footer>
            <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <UButton
                    label="Cancelar"
                    color="neutral"
                    variant="ghost"
                    :disabled="enviando"
                    class="justify-center"
                    @click="abierto = false"
                />
                <UButton
                    label="Unir routers"
                    icon="i-lucide-merge"
                    color="warning"
                    :loading="enviando"
                    :disabled="!puedeConfirmar"
                    class="justify-center"
                    data-prueba="unir-enviar"
                    @click="unir"
                />
            </div>
        </template>
    </UModal>
</template>
