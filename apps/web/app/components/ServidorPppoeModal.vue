<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { CheckboxGroupItem, FormSubmitEvent, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Crear (`POST /routers/:id/servidores-pppoe`, `servidores_pppoe.crear`) o editar
 * (`PUT /servidores-pppoe/:id`, `servidores_pppoe.editar`, con `version`) un servidor PPPoE
 * (`contratos/red-acceso.md` §1–§2): uno por VLAN o interfaz, con su red IPv4. El `local-address`
 * del perfil **sale del gateway efectivo de la red** (solo lectura): el gateway o, sin él, la primera
 * IP utilizable, marcado como derivado. Un servidor adoptado solo cambia lo de Argos (nombre, red, pools, activo).
 */
const props = withDefaults(defineProps<{
    routerId: number
    servidor?: ServidorPppoe | null
    vlans: Vlan[]
    servidores: ServidorPppoe[]
    direccionamiento: DireccionamientoRouter | null
    /** VLAN elegida al abrir desde una VLAN sin servidor. */
    vlanInicial?: number | null
}>(), {
    servidor: null,
    vlanInicial: null,
})

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    guardado: [servidor: ServidorPppoe]
}>()

const toast = useToast()

const INTERFAZ = /^[A-Za-z0-9._-]{1,64}$/
const NINGUNO = 0

/** Espejo de `crearServidorPppoeValidator` / `editarServidorPppoeValidator` (A1). */
const esquema = z.object({
    nombre: z.string().trim().min(1, 'Ponle un nombre').max(64, 'Máximo 64 caracteres'),
    vlan_id: z.number().int(),
    interfaz: z.string().trim(),
    service_name: z.string().trim().max(64, 'Máximo 64 caracteres'),
    red_ipv4_id: z.number().int(),
    ipv6_pool_enlace_id: z.number().int(),
    ipv6_pool_delegacion_id: z.number().int(),
    perfil_base: z.string().trim().min(1, 'El perfil base es obligatorio').max(64, 'Máximo 64 caracteres'),
    max_mtu: z.number({ error: 'Escribe la MTU' }).int().min(576, 'Entre 576 y 9000').max(9000, 'Entre 576 y 9000'),
    max_mru: z.number({ error: 'Escribe la MRU' }).int().min(576, 'Entre 576 y 9000').max(9000, 'Entre 576 y 9000'),
    mrru: z.number().int().min(1500, 'Entre 1500 y 65535').max(65535, 'Entre 1500 y 65535').nullable(),
    autenticacion: z.array(z.enum(AUTENTICACIONES_PPPOE)).min(1, 'Elige al menos un método'),
    keepalive_timeout: z.number({ error: 'Escribe los segundos' }).int().min(0, 'Entre 0 y 3600').max(3600, 'Entre 0 y 3600'),
    una_sesion_por_host: z.boolean(),
    max_sesiones: z.number().int().min(1, 'Al menos 1').max(100000, 'Máximo 100 000').nullable(),
    activo: z.boolean(),
    descripcion: z.string().trim().max(500, 'Máximo 500 caracteres'),
}).superRefine((datos, ctx) => {
    if (datos.vlan_id === NINGUNO && !INTERFAZ.test(datos.interfaz)) {
        ctx.addIssue({ code: 'custom', path: ['interfaz'], message: 'Sin VLAN, escribe la interfaz física o el bridge, como ether5 o bridge-clientes' })
    }
})
type Entrada = z.input<typeof esquema>

function entradaDe(servidor: ServidorPppoe | null): Entrada {
    return {
        nombre: servidor?.nombre ?? '',
        vlan_id: servidor?.vlan_id ?? props.vlanInicial ?? NINGUNO,
        interfaz: servidor?.vlan_id ? '' : (servidor?.interfaz ?? ''),
        service_name: servidor?.service_name ?? '',
        red_ipv4_id: servidor?.red_ipv4_id ?? NINGUNO,
        ipv6_pool_enlace_id: servidor?.ipv6_pool_enlace_id ?? NINGUNO,
        ipv6_pool_delegacion_id: servidor?.ipv6_pool_delegacion_id ?? NINGUNO,
        perfil_base: servidor?.perfil_base ?? 'default',
        max_mtu: servidor?.max_mtu ?? 1480,
        max_mru: servidor?.max_mru ?? 1480,
        mrru: servidor?.mrru ?? null,
        autenticacion: [...(servidor?.autenticacion ?? AUTENTICACIONES_PPPOE)],
        keepalive_timeout: servidor?.keepalive_timeout ?? 10,
        una_sesion_por_host: servidor?.una_sesion_por_host ?? true,
        max_sesiones: servidor?.max_sesiones ?? null,
        activo: servidor?.activo ?? true,
        descripcion: servidor?.descripcion ?? '',
    }
}

const formulario = useTemplateRef('formulario')
const estado = reactive<Entrada>(entradaDe(props.servidor))
const enviando = ref(false)
const problema = ref<Problem | null>(null)
const avanzadas = ref(false)
const adoptado = computed(() => props.servidor?.estado === 'adoptado')

watch(abierto, (valor) => {
    if (valor) {
        Object.assign(estado, entradaDe(props.servidor))
        problema.value = null
        avanzadas.value = false
    }
}, { immediate: true })

const itemsVlan = computed<SelectItem[]>(() => [
    { label: 'Sin VLAN (interfaz física o bridge)', value: NINGUNO },
    ...props.vlans.map((vlan) => {
        const ocupada = props.servidores.some(s => s.vlan_id === vlan.id && s.id !== props.servidor?.id)
        return {
            label: `VLAN ${vlan.vlan_id} · ${vlan.nombre}`,
            value: vlan.id,
            description: ocupada ? 'Ya tiene servidor PPPoE: uno por VLAN' : [vlan.interfaz_padre, vlan.puerto_pon ? `${vlan.puerto_pon.olt_nombre} ${vlan.puerto_pon.identificador}` : null].filter(Boolean).join(' · '),
            disabled: ocupada,
        }
    }),
])

const redes = computed(() => props.direccionamiento?.redes_ipv4 ?? [])
const itemsRed = computed<SelectItem[]>(() => [
    { label: 'Sin red', value: NINGUNO, disabled: !adoptado.value, description: adoptado.value ? 'El router asigna las direcciones' : 'Un servidor de Argos necesita su red' },
    ...redes.value.map(red => ({
        label: red.nombre ? `${red.cidr} · ${red.nombre}` : red.cidr,
        value: red.id,
        description: red.gateway ? `Gateway ${red.gateway}` : `Gateway ${red.gateway_efectivo ?? '—'}, ${MARCA_GATEWAY_DERIVADO}`,
    })),
])

function itemsPool(tipo: 'enlace' | 'delegacion'): SelectItem[] {
    const pools = (props.direccionamiento?.bloques_ipv6 ?? []).flatMap(b => b.pools).filter(p => p.tipo === tipo)
    return [
        { label: 'Los del router', value: NINGUNO },
        ...pools.map(p => ({ label: `${p.prefijo} · /${p.tamano_entrega}`, value: p.id, description: p.nombre ?? undefined })),
    ]
}

const itemsAutenticacion: CheckboxGroupItem[] = AUTENTICACIONES_PPPOE.map(a => ({ label: a.toUpperCase().replace('MSCHAP', 'MS-CHAP v'), value: a }))

/** El `local-address` que llevará el perfil: el gateway efectivo de la red elegida (nunca se teclea). */
const redElegida = computed(() => redes.value.find(r => r.id === estado.red_ipv4_id) ?? null)
const localAddress = computed(() => redElegida.value?.gateway_efectivo ?? redElegida.value?.gateway ?? null)
const localDerivado = computed(() => Boolean(redElegida.value) && !redElegida.value?.gateway)
const interfazDerivada = computed(() => props.vlans.find(v => v.id === estado.vlan_id)?.nombre ?? null)

const nulo = (valor: number) => (valor === NINGUNO ? null : valor)

async function enviar(evento: FormSubmitEvent<z.output<typeof esquema>>) {
    enviando.value = true
    problema.value = null
    const d = evento.data
    const propios = {
        nombre: d.nombre,
        red_ipv4_id: nulo(d.red_ipv4_id),
        ipv6_pool_enlace_id: nulo(d.ipv6_pool_enlace_id),
        ipv6_pool_delegacion_id: nulo(d.ipv6_pool_delegacion_id),
        descripcion: d.descripcion || null,
    }
    const deRouterOs = {
        vlan_id: nulo(d.vlan_id),
        ...(d.vlan_id === NINGUNO ? { interfaz: d.interfaz } : {}),
        ...(d.service_name ? { service_name: d.service_name } : {}),
        perfil_base: d.perfil_base,
        max_mtu: d.max_mtu,
        max_mru: d.max_mru,
        mrru: d.mrru,
        autenticacion: d.autenticacion,
        keepalive_timeout: d.keepalive_timeout,
        una_sesion_por_host: d.una_sesion_por_host,
        max_sesiones: d.max_sesiones,
    }
    const resultado = props.servidor
        ? await useRedAcceso().editarServidor(props.servidor.id, { version: props.servidor.version, ...propios, activo: d.activo, ...(adoptado.value ? {} : deRouterOs) })
        : await useRedAcceso().crearServidor(props.routerId, { ...propios, ...deRouterOs })
    enviando.value = false
    if (resultado.ok) {
        abierto.value = false
        toast.add({ title: props.servidor ? `${resultado.data.nombre} guardado` : `${resultado.data.nombre} creado`, description: resultado.data.local_address ? `local-address ${resultado.data.local_address}` : undefined, color: 'success', icon: 'i-lucide-circle-check' })
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
        :title="servidor ? `Editar ${servidor.nombre}` : 'Nuevo servidor PPPoE'"
        description="Un servidor PPPoE por VLAN. Su red IPv4 da las direcciones y el gateway que usa el perfil como local-address."
        :dismissible="!enviando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                id="form-servidor-pppoe"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                data-prueba="form-servidor-pppoe"
                @submit="enviar"
            >
                <ProblemaAlerta
                    v-if="problema"
                    :problema="problema"
                />
                <UAlert
                    v-if="adoptado"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-lock"
                    title="Adoptado del router"
                    description="Ya existía en el MikroTik: Argos no lo toca. Aquí cambias el nombre, la red, los pools IPv6 y si se ofrece a servicios nuevos."
                />
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Nombre"
                        name="nombre"
                        required
                    >
                        <UInput
                            v-model="estado.nombre"
                            placeholder="fibra-101"
                            class="w-full"
                            data-prueba="servidor-nombre"
                        />
                    </UFormField>
                    <UFormField
                        label="VLAN"
                        name="vlan_id"
                        help="Uno por VLAN: la interfaz del servidor es la de la VLAN."
                    >
                        <USelect
                            v-model="estado.vlan_id"
                            :items="itemsVlan"
                            :disabled="adoptado"
                            class="w-full"
                            data-prueba="servidor-vlan"
                        />
                    </UFormField>
                    <UFormField
                        v-if="estado.vlan_id === NINGUNO"
                        label="Interfaz"
                        name="interfaz"
                        required
                        help="Interfaz física o bridge, como ether5."
                    >
                        <UInput
                            v-model="estado.interfaz"
                            :disabled="adoptado"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        label="Service name"
                        name="service_name"
                        hint="Opcional"
                        help="Por defecto, el nombre."
                    >
                        <UInput
                            v-model="estado.service_name"
                            :disabled="adoptado"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <p
                    v-if="interfazDerivada"
                    class="text-xs text-muted"
                >
                    Interfaz: <span class="font-mono text-default">{{ interfazDerivada }}</span> (la de la VLAN).
                </p>

                <UFormField
                    label="Red IPv4"
                    name="red_ipv4_id"
                    :required="!adoptado"
                >
                    <USelect
                        v-model="estado.red_ipv4_id"
                        :items="itemsRed"
                        class="w-full"
                        data-prueba="servidor-red"
                    />
                </UFormField>
                <div
                    class="flex items-start gap-2 rounded-lg border border-default bg-elevated/50 p-3 text-sm"
                    data-prueba="servidor-local-address"
                >
                    <UIcon
                        name="i-lucide-route"
                        class="mt-0.5 size-4 shrink-0 text-primary"
                    />
                    <span v-if="localAddress">
                        local-address <span class="font-mono font-medium text-highlighted">{{ localAddress }}</span><template v-if="localDerivado">, {{ MARCA_GATEWAY_DERIVADO }}</template>: sale de la red, nunca del perfil default.
                        <span
                            v-if="redElegida?.gateway_ocupado_por"
                            class="mt-1 block text-warning"
                        >El servicio {{ redElegida.gateway_ocupado_por }} ya tenía esa IP: la conserva, pero conviene moverlo a otra.</span>
                    </span>
                    <span
                        v-else
                        class="text-muted"
                    >
                        Elige la red: su gateway (o, sin él, su primera IP) es el local-address del perfil PPP.
                    </span>
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Pool IPv6 de enlace"
                        name="ipv6_pool_enlace_id"
                    >
                        <USelect
                            v-model="estado.ipv6_pool_enlace_id"
                            :items="itemsPool('enlace')"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Pool IPv6 delegado"
                        name="ipv6_pool_delegacion_id"
                    >
                        <USelect
                            v-model="estado.ipv6_pool_delegacion_id"
                            :items="itemsPool('delegacion')"
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <USwitch
                    v-if="servidor"
                    v-model="estado.activo"
                    label="Activo"
                    description="Inactivo: no se ofrece a servicios nuevos."
                />

                <UCollapsible v-model:open="avanzadas">
                    <UButton
                        label="Opciones de RouterOS"
                        :trailing-icon="avanzadas ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        data-prueba="servidor-avanzadas"
                    />
                    <template #content>
                        <div class="grid gap-4 pt-2 sm:grid-cols-2">
                            <UFormField
                                label="Perfil base"
                                name="perfil_base"
                                help="Se copian DNS y opciones; nunca sus direcciones."
                            >
                                <UInput
                                    v-model="estado.perfil_base"
                                    :disabled="adoptado"
                                    class="w-full font-mono"
                                />
                            </UFormField>
                            <UFormField
                                label="Keepalive (s)"
                                name="keepalive_timeout"
                                help="0 = sin keepalive."
                            >
                                <UInputNumber
                                    v-model="estado.keepalive_timeout"
                                    :disabled="adoptado"
                                    :min="0"
                                    :max="3600"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Max MTU"
                                name="max_mtu"
                            >
                                <UInputNumber
                                    v-model="estado.max_mtu"
                                    :disabled="adoptado"
                                    :min="576"
                                    :max="9000"
                                    :format-options="{ useGrouping: false }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Max MRU"
                                name="max_mru"
                            >
                                <UInputNumber
                                    v-model="estado.max_mru"
                                    :disabled="adoptado"
                                    :min="576"
                                    :max="9000"
                                    :format-options="{ useGrouping: false }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="MRRU"
                                name="mrru"
                                hint="Opcional"
                                help="Vacía: deshabilitado."
                            >
                                <UInputNumber
                                    v-model="estado.mrru"
                                    :disabled="adoptado"
                                    :min="1500"
                                    :max="65535"
                                    :format-options="{ useGrouping: false }"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Máximo de sesiones"
                                name="max_sesiones"
                                hint="Opcional"
                                help="Vacía: sin límite."
                            >
                                <UInputNumber
                                    v-model="estado.max_sesiones"
                                    :disabled="adoptado"
                                    :min="1"
                                    :max="100000"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                label="Autenticación"
                                name="autenticacion"
                                class="sm:col-span-2"
                            >
                                <UCheckboxGroup
                                    v-model="estado.autenticacion"
                                    :items="itemsAutenticacion"
                                    :disabled="adoptado"
                                    orientation="horizontal"
                                />
                            </UFormField>
                            <USwitch
                                v-model="estado.una_sesion_por_host"
                                :disabled="adoptado"
                                label="Una sesión por equipo"
                                description="one-session-per-host"
                                class="sm:col-span-2"
                            />
                        </div>
                    </template>
                </UCollapsible>

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
                    form="form-servidor-pppoe"
                    :label="servidor ? 'Guardar' : 'Crear servidor'"
                    icon="i-lucide-save"
                    :loading="enviando"
                    data-prueba="servidor-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
