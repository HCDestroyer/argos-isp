<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Agregar (`POST /routers/:id/redes-ipv4`, `redes.crear`) o editar (`PUT /redes-ipv4/:id`,
 * `redes.editar`, con `version`) una red IPv4: nombre, red, tipo, gateway, rango que se entrega y
 * DNS. Al achicar, la API rechaza si una IP en uso queda fuera y trae la lista (`ProblemaPools`).
 */
const props = withDefaults(defineProps<{
    routerId: number
    /** Con red: edición. */
    red?: RedIpv4 | null
}>(), {
    red: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardado: [red: RedIpv4]
}>()

const toast = useToast()

const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const CIDR_V4 = /^(\d{1,3}\.){3}\d{1,3}\/([0-9]|[12][0-9]|3[0-2])$/
const ipOpcional = (ejemplo: string) => z.string().trim().refine(v => v === '' || IPV4.test(v), `Escribe una IPv4 como ${ejemplo}, o déjalo vacío`)

/** Espejo de `crearRedIpv4Validator` / `editarRedIpv4Validator`. */
const esquema = z.object({
    nombre: z.string().trim().max(100, 'Acorta el nombre: máximo 100 caracteres'),
    cidr: z.string().trim().regex(CIDR_V4, 'Escribe la red con su tamaño, como 100.64.10.0/24'),
    tipo: z.enum(['estatico', 'pool']),
    gateway: ipOpcional('100.64.10.1'),
    rango_inicio: ipOpcional('100.64.10.10'),
    rango_fin: ipOpcional('100.64.10.250'),
    dns_primario: ipOpcional('1.1.1.1'),
    dns_secundario: ipOpcional('8.8.8.8'),
}).superRefine((datos, ctx) => {
    if ((datos.rango_inicio === '') !== (datos.rango_fin === '')) {
        ctx.addIssue({ code: 'custom', path: [datos.rango_inicio ? 'rango_fin' : 'rango_inicio'], message: 'El rango lleva inicio y fin; déjalos vacíos para usar toda la red' })
    }
})
type Entrada = z.input<typeof esquema>

function entradaDe(red: RedIpv4 | null): Entrada {
    return {
        nombre: red?.nombre ?? '',
        cidr: red?.cidr ?? '',
        tipo: red?.tipo ?? 'pool',
        gateway: red?.gateway ?? '',
        rango_inicio: red?.rango_inicio ?? '',
        rango_fin: red?.rango_fin ?? '',
        dns_primario: red?.dns_primario ?? '',
        dns_secundario: red?.dns_secundario ?? '',
    }
}

const formulario = useTemplateRef('formulario')
const estado = reactive<Entrada>(entradaDe(props.red))
const actual = shallowRef<RedIpv4 | null>(props.red)
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const editando = computed(() => actual.value !== null)

watch(abierto, (valor) => {
    if (valor) {
        actual.value = props.red
        Object.assign(estado, entradaDe(props.red))
        problema.value = null
    }
}, { immediate: true })

const itemsTipo: SelectItem[] = [
    { label: 'Pool (asignación automática)', value: 'pool', description: 'El sistema toma la siguiente IP libre al dar de alta un servicio.' },
    { label: 'Estático (IP fija por servicio)', value: 'estatico', description: 'Para IP públicas o reglas por IP: la IP se escribe en el alta.' },
]

const utilizables = computed(() => (CIDR_V4.test(estado.cidr.trim()) ? capacidadIpv4(estado.cidr.trim(), estado.gateway.trim() !== '') : null))

async function recargar() {
    if (!actual.value) {
        return
    }
    const resultado = await useRedesIpv4().ver(actual.value.id)
    if (resultado.ok) {
        actual.value = resultado.data
        Object.assign(estado, entradaDe(resultado.data))
        problema.value = null
        return
    }
    problema.value = resultado.problema
}

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const datos = {
        nombre: d.nombre || null,
        cidr: d.cidr,
        tipo: d.tipo,
        gateway: d.gateway || null,
        rango_inicio: d.rango_inicio || null,
        rango_fin: d.rango_fin || null,
        dns_primario: d.dns_primario || null,
        dns_secundario: d.dns_secundario || null,
    }
    const resultado = actual.value
        ? await useRedesIpv4().editar(actual.value.id, { version: actual.value.version, ...datos })
        : await useRouters().agregarRed(props.routerId, datos)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        toast.add({ title: editando.value ? `Red ${resultado.data.cidr} guardada` : `Red ${resultado.data.cidr} agregada`, color: 'success', icon: 'i-lucide-circle-check' })
        emit('guardado', resultado.data)
        return
    }
    // Los rechazos con lista (IPs en uso fuera) van en el aviso, no junto a un campo.
    const errores = codigoProblema(resultado.problema) === 'validacion' || !codigoProblema(resultado.problema) ? erroresDeFormulario(resultado.problema) : []
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    problema.value = resultado.problema
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="editando ? `Editar red ${actual?.cidr}` : 'Agregar red IPv4'"
        description="Las IPs de los servicios salen de estas redes. Lo que quede fuera del rango se reserva para equipos propios."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                id="form-red-ipv4"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                data-prueba="form-red"
                @submit="enviar"
            >
                <UAlert
                    v-if="problema?.status === 409"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="Alguien más cambió esta red"
                    description="Tus cambios no se guardaron. Carga la versión actual y vuelve a aplicarlos."
                    :actions="[{ label: 'Recargar', icon: 'i-lucide-rotate-cw', color: 'warning', variant: 'outline', onClick: recargar }]"
                />
                <ProblemaPools
                    v-else-if="problema"
                    :problema="problema"
                />

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Red (CIDR)"
                        name="cidr"
                        required
                        :help="utilizables !== null ? `${utilizables.toLocaleString('es-GT')} IP utilizables.` : 'La red con su tamaño, como 100.64.10.0/24.'"
                    >
                        <UInput
                            v-model="estado.cidr"
                            placeholder="100.64.10.0/24"
                            class="w-full font-mono"
                            data-prueba="red-cidr"
                        />
                    </UFormField>
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        hint="Opcional"
                        help="Para reconocerla, como «Clientes zona norte»."
                    >
                        <UInput
                            v-model="estado.nombre"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Tipo"
                    name="tipo"
                    required
                >
                    <USelect
                        v-model="estado.tipo"
                        :items="itemsTipo"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    label="Gateway"
                    name="gateway"
                    hint="Opcional"
                    help="La puerta de enlace de los clientes: nunca se asigna a un servicio."
                >
                    <UInput
                        v-model="estado.gateway"
                        placeholder="100.64.10.1"
                        class="w-full font-mono"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Rango: primera IP"
                        name="rango_inicio"
                        hint="Opcional"
                        help="Vacío = toda la red."
                    >
                        <UInput
                            v-model="estado.rango_inicio"
                            placeholder="100.64.10.10"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        label="Rango: última IP"
                        name="rango_fin"
                        hint="Opcional"
                        help="Solo se entregan IPs dentro del rango."
                    >
                        <UInput
                            v-model="estado.rango_fin"
                            placeholder="100.64.10.250"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        label="DNS primario"
                        name="dns_primario"
                        hint="Opcional"
                    >
                        <UInput
                            v-model="estado.dns_primario"
                            placeholder="1.1.1.1"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        label="DNS secundario"
                        name="dns_secundario"
                        hint="Opcional"
                    >
                        <UInput
                            v-model="estado.dns_secundario"
                            placeholder="8.8.8.8"
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
                    form="form-red-ipv4"
                    :label="editando ? 'Guardar' : 'Agregar'"
                    :icon="editando ? 'i-lucide-save' : 'i-lucide-plus'"
                    :loading="enviando"
                    data-prueba="red-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
