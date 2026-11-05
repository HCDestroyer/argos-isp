<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Crear (`POST /routers/:id/vlans`, `vlans.crear`) o editar (`PUT /vlans/:id`, `vlans.editar`, con
 * `version`) una VLAN del router (`contratos/red-acceso.md` §1). Una VLAN adoptada solo cambia lo
 * de Argos (puerto PON y descripción): lo de RouterOS se ve deshabilitado con el porqué. Máximo 2
 * VLAN por puerto PON: los puertos llenos se ven deshabilitados.
 */
const props = withDefaults(defineProps<{
    routerId: number
    /** Con VLAN: edición. */
    vlan?: Vlan | null
    olts: Olt[]
}>(), {
    vlan: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardado: [vlan: Vlan]
}>()

const toast = useToast()

const INTERFAZ = /^[A-Za-z0-9._-]{1,64}$/
const SIN_PUERTO = 0

/** Espejo de `crearVlanValidator` / `editarVlanValidator` (A1). */
const esquema = z.object({
    interfaz_padre: z.string().trim().regex(INTERFAZ, 'El nombre de la interfaz de RouterOS, sin espacios, como sfp-sfpplus1'),
    vlan_id: z.number({ error: 'Escribe el número de VLAN' }).int('Solo números enteros').min(1, 'Entre 1 y 4094').max(4094, 'Entre 1 y 4094'),
    nombre: z.string().trim().refine(v => v === '' || INTERFAZ.test(v), 'Sin espacios: letras, números, punto, guion o guion bajo'),
    puerto_pon_id: z.number().int(),
    mtu: z.number().int('Solo números enteros').min(576, 'Entre 576 y 9216').max(9216, 'Entre 576 y 9216').nullable(),
    descripcion: z.string().trim().max(500, 'Máximo 500 caracteres'),
})
type Entrada = z.input<typeof esquema>

function entradaDe(vlan: Vlan | null): Entrada {
    return {
        interfaz_padre: vlan?.interfaz_padre ?? '',
        vlan_id: vlan?.vlan_id ?? Number.NaN,
        nombre: vlan?.nombre ?? '',
        puerto_pon_id: vlan?.puerto_pon_id ?? SIN_PUERTO,
        mtu: vlan?.mtu ?? null,
        descripcion: vlan?.descripcion ?? '',
    }
}

const formulario = useTemplateRef('formulario')
const estado = reactive<Entrada>(entradaDe(props.vlan))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const adoptada = computed(() => props.vlan?.estado === 'adoptado')

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaDe(props.vlan))
        problema.value = null
    }
}, { immediate: true })

const itemsPuerto = computed<SelectItem[]>(() => [
    { label: 'Sin puerto PON', value: SIN_PUERTO },
    ...props.olts.flatMap(olt => olt.puertos.map((puerto) => {
        // La VLAN que se edita ya cuenta en su puerto.
        const propias = puerto.id === props.vlan?.puerto_pon_id ? 1 : 0
        const lleno = puerto.vlans - propias >= MAXIMO_VLANS_POR_PUERTO
        return {
            label: `${olt.nombre} · ${puerto.identificador}`,
            value: puerto.id,
            description: lleno ? `Lleno: ya tiene ${MAXIMO_VLANS_POR_PUERTO} VLAN` : `${puerto.vlans} de ${MAXIMO_VLANS_POR_PUERTO} VLAN`,
            disabled: lleno,
        }
    })),
])

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const propios = {
        puerto_pon_id: d.puerto_pon_id === SIN_PUERTO ? null : d.puerto_pon_id,
        descripcion: d.descripcion || null,
    }
    const deRouterOs = {
        interfaz_padre: d.interfaz_padre,
        vlan_id: d.vlan_id,
        ...(d.nombre ? { nombre: d.nombre } : {}),
        mtu: d.mtu,
    }
    const resultado = props.vlan
        ? await useRedAcceso().editarVlan(props.vlan.id, { version: props.vlan.version, ...propios, ...(adoptada.value ? {} : deRouterOs) })
        : await useRedAcceso().crearVlan(props.routerId, { ...deRouterOs, ...propios })
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        toast.add({ title: props.vlan ? `VLAN ${resultado.data.vlan_id} guardada` : `VLAN ${resultado.data.vlan_id} creada`, description: resultado.data.estado === 'administrado' ? 'Argos la escribe en el router.' : undefined, color: 'success', icon: 'i-lucide-circle-check' })
        emit('guardado', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="vlan ? `Editar VLAN ${vlan.vlan_id}` : 'Nueva VLAN'"
        description="Una VLAN por servicio de acceso: después le pones su servidor PPPoE. Argos la crea en el router con su comentario argosisp."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                id="form-vlan"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                data-prueba="form-vlan"
                @submit="enviar"
            >
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
                <UAlert
                    v-if="adoptada"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-lock"
                    title="Adoptada del router"
                    description="Ya existía en el MikroTik: Argos no la toca. Aquí solo cambias el puerto PON y la descripción."
                />
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Interfaz padre"
                        name="interfaz_padre"
                        required
                        help="Donde vive la VLAN, como sfp-sfpplus1 o bridge-olt."
                    >
                        <UInput
                            v-model="estado.interfaz_padre"
                            :disabled="adoptada"
                            placeholder="sfp-sfpplus1"
                            class="w-full font-mono"
                            data-prueba="vlan-interfaz"
                        />
                    </UFormField>
                    <UFormField
                        label="VLAN ID"
                        name="vlan_id"
                        required
                    >
                        <UInputNumber
                            v-model="estado.vlan_id"
                            :disabled="adoptada"
                            :min="1"
                            :max="4094"
                            :format-options="{ useGrouping: false }"
                            class="w-full"
                            data-prueba="vlan-id"
                        />
                    </UFormField>
                    <UFormField
                        label="Nombre de la interfaz"
                        name="nombre"
                        hint="Opcional"
                        :help="`Por defecto vlan${Number.isNaN(estado.vlan_id) ? '<id>' : estado.vlan_id}.`"
                    >
                        <UInput
                            v-model="estado.nombre"
                            :disabled="adoptada"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        label="MTU"
                        name="mtu"
                        hint="Opcional"
                        help="Vacía: la de RouterOS (1500)."
                    >
                        <UInputNumber
                            v-model="estado.mtu"
                            :disabled="adoptada"
                            :min="576"
                            :max="9216"
                            :format-options="{ useGrouping: false }"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Puerto PON"
                    name="puerto_pon_id"
                    help="Para ordenar y filtrar; Argos no habla con la OLT. Máximo 2 VLAN por puerto."
                >
                    <USelect
                        v-model="estado.puerto_pon_id"
                        :items="itemsPuerto"
                        class="w-full"
                        data-prueba="vlan-puerto"
                    />
                </UFormField>
                <UFormField
                    label="Descripción"
                    name="descripcion"
                    hint="Opcional"
                >
                    <UInput
                        v-model="estado.descripcion"
                        class="w-full"
                    />
                </UFormField>
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
                    form="form-vlan"
                    :label="vlan ? 'Guardar' : 'Crear VLAN'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="vlan-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
