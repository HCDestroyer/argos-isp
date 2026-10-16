<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Responsable de pago del cliente (A1, día 4): quién paga por él y de quiénes es responsable.
 * Es solo una sugerencia para el cobro: cualquiera puede pagar cualquier factura. Un solo nivel:
 * un dependiente no puede ser responsable ni un responsable tener responsable (422 de la API).
 */
const props = defineProps<{
    cliente: Cliente
}>()

const emit = defineEmits<{
    cambiado: [cliente: Cliente]
}>()

const { puede } = usePermisos()
const toast = useToast()

// Dependientes ("Responsable de pago de: …")
const dependientes = shallowRef<DependientePago[]>([])
const siguiente = ref<string | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

async function cargarDependientes(cursor?: string) {
    cargando.value = true
    const resultado = await useClientes().dependientes(props.cliente.id, cursor)
    cargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    problema.value = null
    dependientes.value = cursor ? [...dependientes.value, ...resultado.data.data] : resultado.data.data
    siguiente.value = resultado.data.nextCursor
}

// Asignar
const asignando = ref(false)
const idFormulario = useId()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaResponsable>({ responsable_id: 0, motivo: '' })
const enviando = ref(false)
const problemaAsignar = ref<Problem | null>(null)
let claveIdempotencia = nuevaClaveIdempotencia()

function abrirAsignar() {
    estado.responsable_id = 0
    estado.motivo = ''
    problemaAsignar.value = null
    claveIdempotencia = nuevaClaveIdempotencia()
    asignando.value = true
}

async function asignar(evento: FormSubmitEvent<SalidaResponsable>) {
    enviando.value = true
    problemaAsignar.value = null
    const resultado = await useClientes().asignarResponsable(props.cliente.id, evento.data.responsable_id, evento.data.motivo, claveIdempotencia)
    enviando.value = false
    if (!resultado.ok) {
        problemaAsignar.value = resultado.problema
        if (resultado.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
            claveIdempotencia = nuevaClaveIdempotencia()
        }
        return
    }
    asignando.value = false
    toast.add({ title: 'Responsable de pago asignado', description: `${resultado.data.responsable_pago_nombre ?? ''} paga por ${resultado.data.nombre}`, icon: 'i-lucide-user-check', color: 'success' })
    emit('cambiado', resultado.data)
}

// Quitar
const quitando = ref(false)

function quitar(motivo: string, clave: string) {
    return useClientes().quitarResponsable(props.cliente.id, motivo, clave)
}

function alQuitar(cliente: Cliente) {
    toast.add({ title: 'Responsable de pago quitado', description: `${cliente.nombre} paga sus propias facturas`, icon: 'i-lucide-user-minus', color: 'success' })
    emit('cambiado', cliente)
}

watch(() => props.cliente.id, () => cargarDependientes())
onMounted(() => cargarDependientes())
</script>

<template>
    <section
        class="flex flex-col gap-4"
        aria-label="Responsable de pago"
    >
        <UPageCard
            variant="subtle"
            :ui="{ container: 'gap-3 sm:p-4' }"
        >
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex min-w-0 flex-col gap-1">
                    <p class="text-sm font-semibold text-highlighted">
                        Responsable de pago
                    </p>
                    <p
                        v-if="cliente.responsable_pago_id"
                        class="text-sm"
                        data-prueba="responsable-actual"
                    >
                        Paga por este cliente:
                        <ULink
                            :to="`/clientes/${cliente.responsable_pago_id}`"
                            class="font-medium text-primary"
                        >
                            {{ cliente.responsable_pago_nombre ?? `Cliente #${cliente.responsable_pago_id}` }}
                        </ULink>
                    </p>
                    <p
                        v-else
                        class="text-sm text-muted"
                    >
                        Paga sus propias facturas.
                    </p>
                    <p class="text-xs text-muted">
                        {{ dependientes.length
                            ? 'Al cobrarle, aparecen también las facturas de los clientes de los que es responsable.'
                            : 'En el cobro, al buscar al responsable aparecen también las facturas de este cliente.' }}
                    </p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <UButton
                        v-if="puede('clientes.asignar_responsable_pago') && !dependientes.length"
                        :label="cliente.responsable_pago_id ? 'Cambiar' : 'Asignar responsable'"
                        icon="i-lucide-user-plus"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        @click="abrirAsignar"
                    />
                    <UButton
                        v-if="puede('clientes.quitar_responsable_pago') && cliente.responsable_pago_id"
                        label="Quitar"
                        icon="i-lucide-user-minus"
                        color="error"
                        variant="ghost"
                        size="sm"
                        @click="quitando = true"
                    />
                </div>
            </div>
        </UPageCard>

        <div class="flex flex-col gap-2">
            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                :reintentar="() => cargarDependientes()"
                :reintentando="cargando"
            />
            <USkeleton
                v-else-if="cargando && !dependientes.length"
                class="h-12"
            />
            <template v-else-if="dependientes.length">
                <p class="text-sm font-semibold text-highlighted">
                    Responsable de pago de:
                </p>
                <ul
                    class="flex flex-col divide-y divide-default rounded-md border border-default"
                    aria-label="Dependientes de pago"
                >
                    <li
                        v-for="dependiente in dependientes"
                        :key="dependiente.id"
                        class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                        :data-dependiente="dependiente.id"
                    >
                        <div class="flex min-w-0 flex-col">
                            <ULink
                                :to="`/clientes/${dependiente.id}`"
                                class="text-sm font-medium text-highlighted hover:text-primary"
                            >
                                {{ dependiente.nombre }}
                            </ULink>
                            <span class="text-xs text-muted">
                                NIT {{ dependiente.nit_cui ?? 'CF' }} · {{ dependiente.servicios }} {{ dependiente.servicios === 1 ? 'servicio' : 'servicios' }}
                            </span>
                        </div>
                        <EstadoServicioBadge
                            v-if="dependiente.estado_servicio"
                            :estado="dependiente.estado_servicio"
                            size="sm"
                        />
                    </li>
                </ul>
                <UButton
                    v-if="siguiente"
                    label="Ver más"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :loading="cargando"
                    class="self-start"
                    @click="cargarDependientes(siguiente ?? undefined)"
                />
            </template>
        </div>

        <UModal
            v-model:open="asignando"
            title="Asignar responsable de pago"
            :description="`Quién paga las facturas de ${cliente.nombre}`"
            :dismissible="!enviando"
        >
            <template #body>
                <UForm
                    :id="idFormulario"
                    ref="formulario"
                    :schema="esquemaResponsable"
                    :state="estado"
                    class="flex flex-col gap-4"
                    @submit="asignar"
                >
                    <UFormField
                        label="Responsable"
                        name="responsable_id"
                        required
                        description="Nombre, NIT, teléfono, usuario PPP o IP"
                    >
                        <ClienteSelector
                            v-model="estado.responsable_id"
                            placeholder="Buscar cliente responsable…"
                        />
                    </UFormField>
                    <UFormField
                        label="Motivo"
                        name="motivo"
                        required
                        help="Queda en la bitácora junto con tu usuario."
                    >
                        <UTextarea
                            v-model="estado.motivo"
                            :rows="2"
                            placeholder="Ej.: la mamá paga el servicio de la hija"
                            class="w-full"
                        />
                    </UFormField>
                    <ProblemaAlerta
                        v-if="problemaAsignar && problemaAsignar.status !== 422"
                        :problema="problemaAsignar"
                    />
                </UForm>
            </template>
            <template #footer>
                <div class="flex w-full justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="enviando"
                        @click="asignando = false"
                    />
                    <UButton
                        type="submit"
                        :form="idFormulario"
                        label="Asignar"
                        icon="i-lucide-user-check"
                        :loading="enviando"
                    />
                </div>
            </template>
        </UModal>

        <AccionMotivoModal
            v-model:open="quitando"
            titulo="Quitar responsable de pago"
            :efecto="`${cliente.nombre} volverá a pagar sus propias facturas; ${cliente.responsable_pago_nombre ?? 'el responsable'} ya no las verá al cobrar.`"
            confirmar="Quitar responsable"
            icono="i-lucide-user-minus"
            placeholder="Ej.: ahora paga por su cuenta"
            :ejecutar="quitar"
            @hecho="alQuitar"
        />
    </section>
</template>
