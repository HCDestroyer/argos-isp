<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta y edición de cliente. Sin `cliente` crea (`POST /clientes` con `Idempotency-Key`);
 * con `cliente` edita (`PUT /clientes/:id` con su `version`, 409 si alguien más lo cambió).
 */
const props = withDefaults(defineProps<{
    cliente?: Cliente | null
}>(), {
    cliente: null,
})

const emit = defineEmits<{
    guardado: [cliente: Cliente]
    cancelar: []
    /** El usuario pidió cargar la versión actual tras un 409. */
    recargar: []
}>()

const { puede } = usePermisos()
const clientesApi = useClientes()

const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaCliente>(entradaDesdeCliente(props.cliente ?? undefined))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
/** Una clave por formulario abierto: un doble clic o un reintento no crean dos clientes. */
const claveIdempotencia = nuevaClaveIdempotencia()

const editando = computed(() => props.cliente !== null)
const conflicto = computed(() => problema.value?.status === 409 && editando.value)

const zonas = ref<Zona[]>([])
const itemsZona = computed<SelectItem[]>(() => [
    { label: 'Sin zona', value: SIN_ZONA },
    ...zonas.value.map(zona => ({ label: zona.nombre, value: String(zona.id) })),
])

const itemsTipo: SelectItem[] = [
    { label: 'Persona', value: 'persona', icon: 'i-lucide-user' },
    { label: 'Empresa', value: 'empresa', icon: 'i-lucide-building-2' },
]

const itemsCanal: SelectItem[] = [
    { label: 'Correo', value: 'correo', icon: 'i-lucide-mail' },
    { label: 'Telegram', value: 'telegram', icon: 'i-lucide-send' },
    { label: 'WhatsApp', value: 'whatsapp', icon: 'i-lucide-message-circle' },
]

/**
 * Sin validar en `blur`/`change`: al hacer clic en "Guardar" el blur del último campo valida tarde
 * y pisa los errores del submit (UForm 4.11). Se valida al escribir en un campo ya visitado y al enviar.
 */
const VALIDAR_EN: ('input')[] = ['input']

/** Los nombres de la API que no coinciden con el campo del formulario. */
const CAMPOS_API: Record<string, keyof EntradaCliente> = {
    zona_id: 'zona',
}

function copiarAFiscal() {
    estado.nombre_fiscal = estado.nombre.trim().toUpperCase()
    estado.direccion_fiscal = estado.direccion
}

function consumidorFinal() {
    estado.nit_cui = 'CF'
}

async function alEnviar(evento: FormSubmitEvent<SalidaCliente>) {
    enviando.value = true
    problema.value = null
    const cuerpo = cuerpoCliente(evento.data)
    const resultado = props.cliente
        ? await clientesApi.editar(props.cliente.id, { ...cuerpo, version: props.cliente.version })
        : await clientesApi.crear(cuerpo, claveIdempotencia)
    enviando.value = false

    if (resultado.ok) {
        emit('guardado', resultado.data)
        return
    }
    problema.value = resultado.problema
    if (resultado.problema.status === 422) {
        formulario.value?.setErrors(erroresDeFormulario(resultado.problema).map(error => ({
            ...error,
            name: error.name ? (CAMPOS_API[error.name] ?? error.name) : error.name,
        })))
    }
}

onMounted(async () => {
    if (!puede('zonas.ver')) {
        return
    }
    const resultado = await useZonas().listar()
    if (resultado.ok) {
        zonas.value = resultado.data
    }
})
</script>

<template>
    <UForm
        ref="formulario"
        :schema="esquemaCliente"
        :state="estado"
        :validate-on="VALIDAR_EN"
        class="flex w-full max-w-3xl flex-col gap-6"
        @submit="alEnviar"
    >
        <UAlert
            v-if="conflicto"
            color="warning"
            variant="subtle"
            icon="i-lucide-git-compare"
            title="Alguien más editó este cliente"
            description="Tus cambios no se guardaron. Carga la versión actual y vuelve a aplicarlos."
            :actions="[{ label: 'Cargar versión actual', color: 'warning', variant: 'outline', onClick: () => emit('recargar') }]"
        />
        <ProblemaAlerta
            v-else-if="problema && problema.status !== 422"
            :problema="problema"
        />
        <UAlert
            v-else-if="problema"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="La API rechazó algunos campos"
            description="Corrige los campos marcados en rojo y vuelve a guardar."
        />

        <UPageCard
            title="Datos generales"
            variant="subtle"
        >
            <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                    name="nombre"
                    label="Nombre"
                    required
                    class="sm:col-span-2"
                >
                    <UInput
                        v-model="estado.nombre"
                        placeholder="Nombre completo o razón comercial"
                        autocomplete="off"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    name="tipo"
                    label="Tipo"
                >
                    <USelect
                        v-model="estado.tipo"
                        :items="itemsTipo"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    name="canal_preferido"
                    label="Canal de avisos"
                >
                    <USelect
                        v-model="estado.canal_preferido"
                        :items="itemsCanal"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    name="telefono"
                    label="Teléfono"
                >
                    <UInput
                        v-model="estado.telefono"
                        type="tel"
                        inputmode="tel"
                        placeholder="5501 2000"
                        icon="i-lucide-phone"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    name="movil"
                    label="Móvil"
                >
                    <UInput
                        v-model="estado.movil"
                        type="tel"
                        inputmode="tel"
                        icon="i-lucide-smartphone"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    name="email"
                    label="Correo"
                    class="sm:col-span-2"
                >
                    <UInput
                        v-model="estado.email"
                        type="email"
                        placeholder="cliente@correo.gt"
                        icon="i-lucide-mail"
                        class="w-full"
                    />
                </UFormField>
            </div>
        </UPageCard>

        <UPageCard
            title="Ubicación"
            variant="subtle"
        >
            <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                    v-if="puede('zonas.ver')"
                    name="zona"
                    label="Zona"
                >
                    <USelect
                        v-model="estado.zona"
                        :items="itemsZona"
                        icon="i-lucide-map-pin"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    name="coordenadas"
                    label="Coordenadas"
                    hint="Opcional"
                >
                    <UInput
                        v-model="estado.coordenadas"
                        placeholder="14.6349,-90.5069"
                        icon="i-lucide-locate"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    name="direccion"
                    label="Dirección"
                    class="sm:col-span-2"
                >
                    <UTextarea
                        v-model="estado.direccion"
                        :rows="2"
                        autoresize
                        class="w-full"
                    />
                </UFormField>
            </div>
        </UPageCard>

        <UPageCard
            title="Datos fiscales"
            description="Para el aviso de cobro y, desde la semana 5, la factura FEL."
            variant="subtle"
        >
            <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                    name="nit_cui"
                    label="NIT o CUI"
                    description="NIT con dígito verificador, CUI de 13 dígitos o CF."
                >
                    <UFieldGroup class="w-full">
                        <UInput
                            v-model="estado.nit_cui"
                            placeholder="1234567-8"
                            class="w-full font-mono"
                        />
                        <UButton
                            label="CF"
                            color="neutral"
                            variant="outline"
                            aria-label="Consumidor final"
                            @click="consumidorFinal"
                        />
                    </UFieldGroup>
                </UFormField>

                <UFormField
                    name="nombre_fiscal"
                    label="Nombre fiscal"
                >
                    <UInput
                        v-model="estado.nombre_fiscal"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    name="direccion_fiscal"
                    label="Dirección fiscal"
                    class="sm:col-span-2"
                >
                    <UInput
                        v-model="estado.direccion_fiscal"
                        class="w-full"
                    />
                </UFormField>

                <div class="sm:col-span-2">
                    <UButton
                        label="Copiar nombre y dirección"
                        icon="i-lucide-copy"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        @click="copiarAFiscal"
                    />
                </div>
            </div>
        </UPageCard>

        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <UButton
                label="Cancelar"
                color="neutral"
                variant="ghost"
                class="justify-center"
                :disabled="enviando"
                @click="emit('cancelar')"
            />
            <UButton
                type="submit"
                :label="editando ? 'Guardar cambios' : 'Crear cliente'"
                icon="i-lucide-check"
                class="glow-brand justify-center"
                :loading="enviando"
            />
        </div>
    </UForm>
</template>
