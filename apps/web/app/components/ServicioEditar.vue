<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem, SelectItem } from '@nuxt/ui'

/**
 * Edición de un servicio desde su ficha (`PUT /servicios/:id`, `servicios.editar`, con
 * `version`): plan del mismo router, tipo de conexión PPPoE / IP estática / DHCP fija, MAC,
 * amarre IP-MAC, modo IPv6, instalación y precio especial. Solo viaja lo que cambió; los 422 se
 * muestran junto a cada campo y el 409 ofrece recargar.
 */
const props = defineProps<{
    servicio: Servicio
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardado: [servicio: Servicio]
}>()

const { puede } = usePermisos()
const formulario = useTemplateRef('formulario')
const estado = reactive<EntradaEdicionServicio>(entradaEdicionDesde(props.servicio))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const planes = shallowRef<PlanEfectivo[]>([])

watch(abierto, async (valor) => {
    if (!valor) {
        return
    }
    Object.assign(estado, entradaEdicionDesde(props.servicio))
    problema.value = null
    if (puede('planes.ver')) {
        const resultado = await useRouters().planes(props.servicio.router_id)
        planes.value = resultado.ok ? resultado.data : []
    }
}, { immediate: true })

const conPppoe = computed(() => estado.tipo_conexion === 'pppoe')
const eraPppoe = computed(() => esPppoe(props.servicio))

const itemsTipo: RadioGroupItem[] = (Object.keys(TIPOS_CONEXION) as TipoConexion[]).map(tipo => ({
    label: TIPOS_CONEXION[tipo].etiqueta,
    value: tipo,
    description: TIPOS_CONEXION[tipo].descripcion,
}))

const itemsPlan = computed<SelectItem[]>(() => {
    const lista = planes.value.filter(p => p.activo || p.id === props.servicio.plan_id)
    if (!lista.some(p => p.id === props.servicio.plan_id)) {
        return [{ label: nombrePlan(props.servicio), value: props.servicio.plan_id }, ...lista.map(p => ({ label: p.nombre, value: p.id }))]
    }
    return lista.map(p => ({ label: `${p.nombre} · ${formatearVelocidad(p.bajada_kbps)} / ${formatearVelocidad(p.subida_kbps)}`, value: p.id }))
})

const itemsIpv6 = computed<SelectItem[]>(() => [
    { label: 'RADIUS por servicio', value: 'radius_servicio', disabled: !conPppoe.value },
    { label: 'Pool del router', value: 'radius_pool', disabled: !conPppoe.value },
    { label: 'DHCPv6-PD por DUID', value: 'duid' },
    { label: 'Prefijo estático', value: 'estatico' },
    { label: 'Sin IPv6', value: 'ninguno' },
])

watch(() => estado.tipo_conexion, (tipo) => {
    if (tipo !== 'pppoe' && modoIpv6PorRadius(estado.ipv6_modo)) {
        estado.ipv6_modo = 'ninguno'
    }
    if (tipo === 'pppoe') {
        estado.amarre_ip_mac = false
    }
})

/** Qué pasa con las credenciales al cambiar el tipo. */
const avisoTipo = computed(() => {
    if (eraPppoe.value && !conPppoe.value) {
        return 'Se borran el usuario y la contraseña PPP y se cierra su sesión: el router pasa a identificar al cliente por su IP.'
    }
    if (!eraPppoe.value && conPppoe.value) {
        return 'La API genera usuario y contraseña PPP; los verás en "Credenciales PPPoE" para configurarlos en el equipo.'
    }
    return null
})

async function enviar(evento: FormSubmitEvent<SalidaEdicionServicio>) {
    const cambios = cambiosServicio(evento.data, props.servicio)
    if (Object.keys(cambios).length === 1) {
        abierto.value = false
        return
    }
    enviando.value = true
    problema.value = null
    const resultado = await useServicios().editar(props.servicio.id, cambios)
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        emit('guardado', resultado.data)
        return
    }
    const errores = erroresDeFormulario(resultado.problema)
    if (errores.length) {
        formulario.value?.setErrors(errores)
    }
    const campos = new Set(Object.keys(estado))
    if (!errores.length || errores.some(e => !e.name || !campos.has(e.name))) {
        problema.value = resultado.problema
    }
}

async function recargar() {
    const resultado = await useServicios().ver(props.servicio.id)
    if (resultado.ok) {
        emit('guardado', resultado.data)
        Object.assign(estado, entradaEdicionDesde(resultado.data))
        problema.value = null
    }
}
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="`Editar ${etiquetaServicio(servicio)}`"
        :description="`${nombreCliente(servicio)} · ${nombreRouter(servicio)}`"
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <UForm
                id="form-editar-servicio"
                ref="formulario"
                :schema="esquemaEdicionServicio"
                :state="estado"
                class="flex flex-col gap-6"
                @submit="enviar"
            >
                <UFormField
                    v-if="puede('planes.ver')"
                    name="plan_id"
                    label="Plan"
                    description="Planes disponibles en este router."
                >
                    <USelect
                        v-model="estado.plan_id"
                        :items="itemsPlan"
                        class="w-full"
                    />
                </UFormField>

                <UFormField
                    name="tipo_conexion"
                    label="Tipo de conexión"
                >
                    <URadioGroup
                        v-model="estado.tipo_conexion"
                        :items="itemsTipo"
                        variant="card"
                        class="w-full"
                        :ui="{ fieldset: 'grid gap-2' }"
                        data-prueba="editar-tipo-conexion"
                    />
                </UFormField>
                <UAlert
                    v-if="avisoTipo"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :description="avisoTipo"
                    data-prueba="aviso-tipo"
                />

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        name="mac"
                        label="MAC del equipo"
                        :required="estado.tipo_conexion === 'dhcp_fija' || estado.amarre_ip_mac"
                    >
                        <UInput
                            v-model="estado.mac"
                            placeholder="4C:5E:0C:12:34:56"
                            class="w-full font-mono"
                            data-prueba="editar-mac"
                        />
                    </UFormField>
                    <UFormField
                        v-if="!conPppoe"
                        name="amarre_ip_mac"
                        label="Amarre IP-MAC"
                        description="ARP estático: solo esa MAC usa la IP."
                    >
                        <UCheckbox
                            v-model="estado.amarre_ip_mac"
                            label="Amarrar la IP a la MAC"
                        />
                    </UFormField>
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        name="ipv6_modo"
                        label="Modo IPv6"
                        :description="conPppoe ? undefined : 'Sin PPPoE no hay RADIUS.'"
                    >
                        <USelect
                            v-model="estado.ipv6_modo"
                            :items="itemsIpv6"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.ipv6_modo === 'duid'"
                        name="ipv6_duid"
                        label="DUID del equipo"
                        required
                    >
                        <UInput
                            v-model="estado.ipv6_duid"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.ipv6_modo === 'estatico'"
                        name="prefijo_delegado_v6"
                        label="Prefijo delegado"
                        required
                    >
                        <UInput
                            v-model="estado.prefijo_delegado_v6"
                            placeholder="2803:d100:1000:100::/56"
                            class="w-full font-mono"
                        />
                    </UFormField>
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        name="costo_override"
                        label="Precio especial"
                        description="Vacío: el precio del plan."
                    >
                        <UInput
                            v-model="estado.costo_override"
                            inputmode="decimal"
                            class="w-full"
                        >
                            <template #leading>
                                <span class="text-sm text-muted">Q</span>
                            </template>
                        </UInput>
                    </UFormField>
                    <UFormField
                        name="fecha_instalacion"
                        label="Fecha de instalación"
                    >
                        <UInput
                            v-model="estado.fecha_instalacion"
                            type="date"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="direccion"
                        label="Dirección de instalación"
                    >
                        <UInput
                            v-model="estado.direccion"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="coordenadas"
                        label="Coordenadas"
                    >
                        <UInput
                            v-model="estado.coordenadas"
                            placeholder="14.6349,-90.5069"
                            class="w-full"
                        />
                    </UFormField>
                    <USwitch
                        v-model="estado.excluir_firewall"
                        label="Excluir del firewall de corte"
                        class="sm:col-span-2"
                    />
                </div>

                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                    :reintentar="problema.status === 409 ? recargar : undefined"
                    data-prueba="editar-servicio-error"
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
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="form-editar-servicio"
                    label="Guardar cambios"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="guardar-servicio"
                />
            </div>
        </template>
    </USlideover>
</template>
