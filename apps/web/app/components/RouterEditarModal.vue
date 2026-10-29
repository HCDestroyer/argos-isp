<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'
import * as z from 'zod'

/**
 * Editar un router (`PUT /routers/:id`, `routers.editar`) con su `version`: nombre, host, IP del
 * NAS, seguridad, credenciales de la API y secreto RADIUS, empresa sugerida, capacidad del enlace y
 * si está activo. Las credenciales nunca se muestran: vacías = no cambiar. Un 409 ofrece cargar la
 * versión actual. La URL, el puerto y el TLS de la API se cambian en «Conexión de la API»; el modo
 * de colas, en «Control de velocidad».
 */
const props = defineProps<{
    router: RouterNas
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    actualizado: [router: RouterNas]
}>()

const toast = useToast()
const { conSelector: variasEmpresas, empresas } = useEmpresaActiva()

const IPV4 = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const KBPS = z.number().int('Escribe los kbps sin decimales').min(1, 'Escribe al menos 1 kbps, o déjalo vacío').max(100_000_000, 'Escribe como máximo 100 000 000 kbps').nullable()

/** Espejo de `editarRouterValidator` en los campos de este formulario. */
const esquema = z.object({
    nombre: z.string().trim().min(2, 'Escribe un nombre de al menos 2 caracteres').max(100, 'Acorta el nombre: máximo 100 caracteres'),
    host: z.string().trim().min(1, 'Escribe el host o la IP con la que el panel llega a la API').max(255, 'Máximo 255 caracteres'),
    nas_ip: z.string().trim().regex(IPV4, 'Escribe la IPv4 con la que el router habla con RADIUS, como 10.0.0.1'),
    modo_seguridad: z.enum(['radius', 'api']),
    api_usuario: z.string().trim().max(100, 'Máximo 100 caracteres'),
    api_password: z.string().max(200, 'Máximo 200 caracteres'),
    radius_secret: z.string().max(200, 'Máximo 200 caracteres'),
    empresa_sugerida_id: z.number().int().nullable(),
    capacidad_bajada_kbps: KBPS,
    capacidad_subida_kbps: KBPS,
    activo: z.boolean(),
})
type Entrada = z.input<typeof esquema>
type Salida = z.output<typeof esquema>

function entradaDe(router: RouterNas): Entrada {
    return {
        nombre: router.nombre,
        host: router.host,
        nas_ip: router.nas_ip,
        modo_seguridad: router.modo_seguridad,
        api_usuario: router.api_usuario ?? '',
        api_password: '',
        radius_secret: '',
        empresa_sugerida_id: router.empresa_sugerida_id,
        capacidad_bajada_kbps: router.capacidad_bajada_kbps,
        capacidad_subida_kbps: router.capacidad_subida_kbps,
        activo: router.activo,
    }
}

const formulario = useTemplateRef('formulario')
const actual = shallowRef<RouterNas>(props.router)
const estado = reactive<Entrada>(entradaDe(props.router))
const guardando = ref(false)
const problema = ref<Problem | null>(null)
const conflicto = computed(() => problema.value?.status === 409)

function reiniciar(router: RouterNas) {
    actual.value = router
    Object.assign(estado, entradaDe(router))
    problema.value = null
}

watch(abierto, (valor) => {
    if (valor) {
        reiniciar(props.router)
    }
}, { immediate: true })

const itemsSeguridad: SelectItem[] = [
    { label: 'RADIUS', value: 'radius', description: 'Recomendado: el router autentica y corta por RADIUS' },
    { label: 'API de RouterOS', value: 'api', description: 'El panel corta y reactiva con comandos a la API' },
]

const SIN_EMPRESA = 0
const itemsEmpresa = computed<SelectItem[]>(() => [
    { label: 'Sin empresa sugerida', value: SIN_EMPRESA },
    ...empresas.value.map(e => ({ label: e.nombre_comercial, value: e.id })),
])
const empresaSugerida = computed({
    get: () => estado.empresa_sugerida_id ?? SIN_EMPRESA,
    set: (valor: number) => {
        estado.empresa_sugerida_id = valor === SIN_EMPRESA ? null : valor
    },
})

/** Solo lo que cambió (más `version`); las credenciales solo si se escribió una nueva. */
function cambios(datos: Salida): CambiosRouter {
    const anterior = actual.value
    const salida: CambiosRouter = { version: anterior.version }
    if (datos.nombre !== anterior.nombre) salida.nombre = datos.nombre
    if (datos.host !== anterior.host) salida.host = datos.host
    if (datos.nas_ip !== anterior.nas_ip) salida.nas_ip = datos.nas_ip
    if (datos.modo_seguridad !== anterior.modo_seguridad) salida.modo_seguridad = datos.modo_seguridad
    if ((datos.api_usuario || null) !== anterior.api_usuario) salida.api_usuario = datos.api_usuario || null
    if (datos.api_password) salida.api_password = datos.api_password
    if (datos.radius_secret) salida.radius_secret = datos.radius_secret
    if (variasEmpresas.value && datos.empresa_sugerida_id !== anterior.empresa_sugerida_id) salida.empresa_sugerida_id = datos.empresa_sugerida_id
    if (datos.capacidad_bajada_kbps !== anterior.capacidad_bajada_kbps) salida.capacidad_bajada_kbps = datos.capacidad_bajada_kbps
    if (datos.capacidad_subida_kbps !== anterior.capacidad_subida_kbps) salida.capacidad_subida_kbps = datos.capacidad_subida_kbps
    if (datos.activo !== anterior.activo) salida.activo = datos.activo
    return salida
}

async function recargar() {
    const resultado = await useRouters().ver(actual.value.id)
    if (resultado.ok) {
        reiniciar(resultado.data)
        emit('actualizado', resultado.data)
        return
    }
    problema.value = resultado.problema
}

async function guardar(evento: FormSubmitEvent<Salida>) {
    guardando.value = true
    problema.value = null
    const resultado = await useRouters().editar(actual.value.id, cambios(evento.data))
    guardando.value = false
    if (!resultado.ok) {
        const errores = erroresDeFormulario(resultado.problema)
        if (errores.length) {
            formulario.value?.setErrors(errores)
        }
        problema.value = resultado.problema
        return
    }
    reiniciar(resultado.data)
    emit('actualizado', resultado.data)
    abierto.value = false
    toast.add({ title: `${resultado.data.nombre} guardado`, icon: 'i-lucide-circle-check', color: 'success' })
}
</script>

<template>
    <UModal
        v-model:open="abierto"
        :title="`Editar ${actual.nombre}`"
        description="Las contraseñas y el secreto guardados no se muestran: déjalos vacíos para no cambiarlos."
        :dismissible="!guardando"
        :ui="{ content: 'sm:max-w-2xl' }"
    >
        <template #body>
            <UForm
                id="form-router-editar"
                ref="formulario"
                :schema="esquema"
                :state="estado"
                class="flex flex-col gap-4"
                data-prueba="router-editar"
                @submit="guardar"
            >
                <UAlert
                    v-if="conflicto"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="Alguien más cambió este router"
                    description="Tus cambios no se guardaron. Carga la versión actual y vuelve a aplicarlos."
                    :actions="[{ label: 'Recargar', icon: 'i-lucide-rotate-cw', color: 'warning', variant: 'outline', onClick: recargar }]"
                    data-prueba="router-conflicto"
                />
                <ProblemaAlerta
                    v-else-if="problema && problema.status !== 422"
                    :problema="problema"
                />

                <UFormField
                    label="Nombre"
                    name="nombre"
                    required
                    help="Así aparece en el alta de servicios, en la lista y en los reportes."
                >
                    <UInput
                        v-model="estado.nombre"
                        class="w-full"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Host de la API"
                        name="host"
                        required
                        help="IP o nombre con el que el panel llega al router. El puerto se cambia en «Conexión de la API»."
                    >
                        <UInput
                            v-model="estado.host"
                            class="w-full font-mono"
                        />
                    </UFormField>
                    <UFormField
                        label="IP del NAS"
                        name="nas_ip"
                        required
                        help="La IP con la que el router se presenta ante RADIUS; si no coincide, los clientes no se autentican."
                    >
                        <UInput
                            v-model="estado.nas_ip"
                            class="w-full font-mono"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Seguridad"
                    name="modo_seguridad"
                    required
                >
                    <USelect
                        v-model="estado.modo_seguridad"
                        :items="itemsSeguridad"
                        class="w-full"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Usuario de la API"
                        name="api_usuario"
                        help="Usuario de RouterOS con permiso de lectura y escritura por la API REST."
                    >
                        <UInput
                            v-model="estado.api_usuario"
                            autocomplete="off"
                            class="w-full"
                            data-prueba="router-editar-usuario"
                        />
                    </UFormField>
                    <UFormField
                        label="Contraseña de la API"
                        name="api_password"
                        :hint="actual.tiene_api_password ? 'Guardada' : 'Sin guardar'"
                        help="Vacía = se mantiene la actual."
                    >
                        <UInput
                            v-model="estado.api_password"
                            type="password"
                            autocomplete="new-password"
                            :placeholder="actual.tiene_api_password ? 'Escribe una nueva para cambiarla' : ''"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <UFormField
                    label="Secreto RADIUS"
                    name="radius_secret"
                    :hint="actual.tiene_radius_secret ? 'Guardado' : 'Sin guardar'"
                    help="Debe ser el mismo que tiene el router en /radius. Vacío = se mantiene el actual."
                >
                    <UInput
                        v-model="estado.radius_secret"
                        type="password"
                        autocomplete="new-password"
                        :placeholder="actual.tiene_radius_secret ? 'Escribe uno nuevo para cambiarlo' : ''"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    v-if="variasEmpresas"
                    label="Empresa sugerida"
                    name="empresa_sugerida_id"
                    help="Empresa que se propone al dar de alta servicios en este router (después de la de la zona del cliente)."
                >
                    <USelect
                        v-model="empresaSugerida"
                        :items="itemsEmpresa"
                        class="w-full"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        label="Capacidad de bajada (kbps)"
                        name="capacidad_bajada_kbps"
                        :help="estado.capacidad_bajada_kbps ? formatearVelocidad(estado.capacidad_bajada_kbps) : 'Vacía: sin techo para el enlace.'"
                    >
                        <UInputNumber
                            v-model="estado.capacidad_bajada_kbps"
                            :min="1"
                            :step="1000"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        label="Capacidad de subida (kbps)"
                        name="capacidad_subida_kbps"
                        :help="estado.capacidad_subida_kbps ? formatearVelocidad(estado.capacidad_subida_kbps) : 'Vacía: sin techo para el enlace.'"
                    >
                        <UInputNumber
                            v-model="estado.capacidad_subida_kbps"
                            :min="1"
                            :step="1000"
                            class="w-full"
                        />
                    </UFormField>
                </div>
                <UFormField
                    name="activo"
                    help="Un router inactivo no aparece al dar de alta servicios."
                >
                    <USwitch
                        v-model="estado.activo"
                        label="Activo"
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
                    :disabled="guardando"
                    @click="abierto = false"
                />
                <UButton
                    type="submit"
                    form="form-router-editar"
                    label="Guardar"
                    icon="i-lucide-save"
                    :loading="guardando"
                    data-prueba="router-editar-guardar"
                />
            </div>
        </template>
    </UModal>
</template>
