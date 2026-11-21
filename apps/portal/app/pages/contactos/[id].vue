<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Agregar (`/contactos/nuevo`) o cambiar (`/contactos/:id`) un contacto del titular (contrato Iris
 * 0.10.0 §3.5): nombre, relación, a qué servicios aplica, sus permisos (todos encendidos al crear) y
 * de 1 a 5 números con uno principal. Quitar pide confirmación. La API valida y normaliza los
 * números; un 409 pide recargar.
 */
definePageMeta({ name: 'contacto' })

const route = useRoute()
const toast = useToast()
const contactos = useContactosCliente()
const { data: cuentaLeida } = useCuenta()

const esNuevo = computed(() => route.params.id === 'nuevo')
const contactoId = computed(() => esNuevo.value ? null : Number(route.params.id))
useHead({ title: computed(() => esNuevo.value ? 'Agregar contacto' : 'Contacto') })

const servicios = computed(() => (cuentaLeida.value?.ok ? cuentaLeida.value.data.servicios : [])
    .filter(s => s.estado !== 'retirado'))

function telefonoVacio(principal: boolean) {
    return { numero: '', whatsapp: true, principal }
}

const estado = reactive<DatosContacto>({
    nombre: '',
    relacion: 'familiar',
    todos: true,
    servicios: [],
    permisos: { consultar: true, reportar: true, pagar: true, avisos: true },
    telefonos: [telefonoVacio(true)],
})
const actual = ref<ContactoCliente | null>(null)
const cargando = ref(false)
const problema = ref<string | null>(null)

async function cargar() {
    if (esNuevo.value) {
        return
    }
    cargando.value = true
    problema.value = null
    const leidos = await contactos.listar()
    cargando.value = false
    if (!leidos.ok) {
        problema.value = mensajeProblema(leidos.problema)
        return
    }
    const contacto = leidos.data.data.find(c => c.contacto_id === contactoId.value && !c.es_titular)
    if (!contacto) {
        problema.value = 'Ese contacto ya no está en tu cuenta.'
        return
    }
    actual.value = contacto
    estado.nombre = contacto.nombre
    estado.relacion = contacto.relacion === 'titular' ? 'otro' : contacto.relacion
    estado.todos = contacto.servicios === null
    estado.servicios = contacto.servicios ?? []
    estado.permisos = { ...contacto.permisos }
    estado.telefonos = contacto.telefonos.map(t => ({ numero: numeroLegible(t.numero), whatsapp: t.whatsapp, principal: t.principal }))
}
onMounted(cargar)

function agregarTelefono() {
    estado.telefonos.push(telefonoVacio(estado.telefonos.length === 0))
}
function quitarTelefono(indice: number) {
    const eraPrincipal = estado.telefonos[indice]?.principal
    estado.telefonos.splice(indice, 1)
    if (eraPrincipal && estado.telefonos[0]) {
        estado.telefonos[0].principal = true
    }
}
function marcarPrincipal(indice: number) {
    estado.telefonos.forEach((t, i) => {
        t.principal = i === indice
    })
}
function alternarServicio(id: number, marcado: boolean | 'indeterminate') {
    estado.servicios = marcado === true
        ? [...new Set([...estado.servicios, id])]
        : estado.servicios.filter(s => s !== id)
}

const guardando = ref(false)
const error = ref<string | null>(null)
const formulario = useTemplateRef('formulario')
let clave = claveIdempotencia()

async function guardar(evento: FormSubmitEvent<DatosContacto>) {
    guardando.value = true
    error.value = null
    const d = evento.data
    const cuerpo = {
        nombre: d.nombre,
        relacion: d.relacion,
        servicios: d.todos ? null : d.servicios,
        permisos: d.permisos,
        telefonos: d.telefonos.map(t => ({ numero: t.numero, whatsapp: t.whatsapp, principal: t.principal })),
    }
    const r = esNuevo.value
        ? await contactos.agregar(cuerpo, clave)
        : await contactos.cambiar(contactoId.value!, { ...cuerpo, version: actual.value!.version })
    guardando.value = false
    if (!r.ok) {
        if (r.problema.status !== 0) {
            clave = claveIdempotencia()
        }
        error.value = r.problema.status === 409
            ? 'El contacto cambió mientras lo editabas. Recarga la página e intenta de nuevo.'
            : mensajeProblema(r.problema)
        formulario.value?.setErrors(erroresDeFormulario(r.problema))
        return
    }
    toast.add({ title: esNuevo.value ? 'Contacto agregado' : 'Contacto guardado', icon: 'i-lucide-check', color: 'success' })
    await navigateTo('/cuenta?seccion=cuenta')
}

const confirmarQuitar = ref(false)
const quitando = ref(false)
async function quitar() {
    if (!actual.value) {
        return
    }
    quitando.value = true
    const r = await contactos.quitar(actual.value.contacto_id, actual.value.version)
    quitando.value = false
    confirmarQuitar.value = false
    if (!r.ok) {
        error.value = mensajeProblema(r.problema)
        return
    }
    toast.add({ title: 'Contacto quitado', icon: 'i-lucide-check', color: 'success' })
    await navigateTo('/cuenta?seccion=cuenta')
}
</script>

<template>
    <div
        class="flex flex-col gap-4"
        data-testid="contacto-formulario"
    >
        <div>
            <UButton
                label="Mi cuenta"
                icon="i-lucide-arrow-left"
                color="neutral"
                variant="ghost"
                to="/cuenta?seccion=cuenta"
            />
        </div>

        <USkeleton
            v-if="cargando"
            class="h-80 w-full"
        />
        <UAlert
            v-else-if="problema"
            color="error"
            variant="subtle"
            icon="i-lucide-cloud-off"
            title="No pudimos cargar el contacto"
            :description="problema"
            :actions="[{ label: 'Reintentar', icon: 'i-lucide-refresh-cw', color: 'error', variant: 'outline', onClick: cargar }]"
        />

        <UCard
            v-else
            :ui="{ body: 'p-4 sm:p-6' }"
        >
            <div class="flex flex-col gap-4">
                <div>
                    <h1 class="text-lg font-semibold text-highlighted">
                        {{ esNuevo ? 'Agregar contacto' : 'Contacto' }}
                    </h1>
                    <p class="text-sm text-muted">
                        Lo que le permitas aplica solo a los servicios que elijas. Cambiar el plan, el titular o el Wi-Fi siempre queda para ti.
                    </p>
                </div>

                <UAlert
                    v-if="error"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    :title="error"
                    data-testid="contacto-error"
                />

                <UForm
                    ref="formulario"
                    :schema="esquemaContacto"
                    :state="estado"
                    class="flex flex-col gap-5"
                    @submit="guardar"
                >
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                    >
                        <UInput
                            v-model="estado.nombre"
                            autocomplete="name"
                            class="w-full"
                            data-testid="contacto-nombre"
                        />
                    </UFormField>
                    <UFormField
                        label="Relación"
                        name="relacion"
                        required
                    >
                        <USelect
                            v-model="estado.relacion"
                            :items="RELACIONES"
                            class="w-full"
                            data-testid="contacto-relacion"
                        />
                    </UFormField>

                    <fieldset class="flex flex-col gap-2">
                        <legend class="mb-1 text-sm font-medium text-highlighted">
                            Teléfonos
                        </legend>
                        <div
                            v-for="(telefono, indice) in estado.telefonos"
                            :key="indice"
                            class="flex flex-col gap-2 rounded-lg border border-default p-3"
                        >
                            <UFormField
                                :name="`telefonos.${indice}.numero`"
                                :label="`Número ${indice + 1}`"
                            >
                                <UInput
                                    v-model="telefono.numero"
                                    type="tel"
                                    autocomplete="tel"
                                    placeholder="5512-3344"
                                    class="w-full"
                                    :data-testid="`contacto-telefono-${indice}`"
                                />
                            </UFormField>
                            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                                <USwitch
                                    v-model="telefono.whatsapp"
                                    label="Tiene WhatsApp"
                                />
                                <UCheckbox
                                    :model-value="telefono.principal"
                                    label="Principal"
                                    @update:model-value="marcarPrincipal(indice)"
                                />
                                <UButton
                                    v-if="estado.telefonos.length > 1"
                                    label="Quitar"
                                    icon="i-lucide-trash-2"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    class="ms-auto"
                                    @click="quitarTelefono(indice)"
                                />
                            </div>
                        </div>
                        <UFormField name="telefonos">
                            <UButton
                                v-if="estado.telefonos.length < 5"
                                label="Agregar otro número"
                                icon="i-lucide-plus"
                                color="neutral"
                                variant="outline"
                                @click="agregarTelefono"
                            />
                        </UFormField>
                    </fieldset>

                    <fieldset class="flex flex-col gap-3">
                        <legend class="mb-1 text-sm font-medium text-highlighted">
                            Qué puede hacer
                        </legend>
                        <USwitch
                            v-for="permiso in PERMISOS"
                            :key="permiso.clave"
                            v-model="estado.permisos[permiso.clave]"
                            :label="permiso.etiqueta"
                            :description="permiso.descripcion"
                            :data-testid="`contacto-permiso-${permiso.clave}`"
                        />
                    </fieldset>

                    <fieldset
                        v-if="servicios.length > 1"
                        class="flex flex-col gap-3"
                    >
                        <legend class="mb-1 text-sm font-medium text-highlighted">
                            Servicios
                        </legend>
                        <USwitch
                            v-model="estado.todos"
                            label="Todos mis servicios"
                        />
                        <UFormField
                            v-if="!estado.todos"
                            name="servicios"
                        >
                            <div class="flex flex-col gap-2">
                                <UCheckbox
                                    v-for="servicio in servicios"
                                    :key="servicio.id"
                                    :model-value="estado.servicios.includes(servicio.id)"
                                    :label="etiquetaServicio(servicio)"
                                    @update:model-value="alternarServicio(servicio.id, $event)"
                                />
                            </div>
                        </UFormField>
                    </fieldset>

                    <UButton
                        type="submit"
                        :label="esNuevo ? 'Agregar contacto' : 'Guardar'"
                        icon="i-lucide-check"
                        size="xl"
                        block
                        :loading="guardando"
                        data-testid="contacto-guardar"
                    />
                    <UButton
                        v-if="!esNuevo && actual"
                        label="Quitar contacto"
                        icon="i-lucide-user-minus"
                        color="error"
                        variant="ghost"
                        block
                        data-testid="contacto-quitar"
                        @click="confirmarQuitar = true"
                    />
                </UForm>
            </div>
        </UCard>

        <UModal
            v-model:open="confirmarQuitar"
            title="¿Quitar este contacto?"
            :description="actual ? `${actual.nombre} ya no podrá consultar, reportar ni pagar tus servicios.` : undefined"
        >
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="outline"
                        @click="confirmarQuitar = false"
                    />
                    <UButton
                        label="Quitar"
                        color="error"
                        :loading="quitando"
                        data-testid="contacto-quitar-confirmar"
                        @click="quitar"
                    />
                </div>
            </template>
        </UModal>
    </div>
</template>
