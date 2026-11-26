<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent } from '@nuxt/ui'

/**
 * Formulario de una instancia de SmartOLT en su página (tableros PendSmartoltForm y
 * PendSmartoltFormMovil): 1 · la cuenta (nombre, subdominio, token), 2 · quién la usa (una empresa o
 * compartida), 3 · nota y 4 · encendida. A la derecha, «¿Dónde saco el token?». Errores del tablero:
 * 409 subdominio repetido, 409 otra persona la cambió y 403 compartida sin acceso global. El token se
 * escribe una vez y nunca vuelve: al editar se ve «***» con «Cambiar».
 */
const props = defineProps<{
    /** Sin instancia: alta. */
    instancia?: InstanciaSmartOlt | null
}>()

const emit = defineEmits<{ guardada: [instancia: InstanciaSmartOlt], recargar: [] }>()

const { empresas, empresaId, alcanceGlobal } = useEmpresaActiva()
const editando = computed(() => Boolean(props.instancia))

const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaInstancia>({ nombre: '', subdominio: '', compartida: false, empresa_id: null, nota: '', activo: true })
const token = ref('')
const cambiarToken = ref(false)
const errorToken = ref<string | null>(null)
const enviando = ref(false)
const problema = ref<Problem | null>(null)

function rellenar() {
    const i = props.instancia
    Object.assign(estado, i
        ? { nombre: i.nombre, subdominio: subdominioDe(i.url), compartida: i.compartida, empresa_id: i.empresa_id ?? empresaId.value, nota: i.nota ?? '', activo: i.activo }
        : { nombre: '', subdominio: '', compartida: false, empresa_id: empresaId.value, nota: '', activo: true })
    token.value = ''
    cambiarToken.value = false
    errorToken.value = null
}
watch(() => props.instancia, rellenar, { immediate: true })

const itemsEmpresas = computed(() => empresas.value.map(e => ({ label: e.id === empresaId.value ? `${e.nombre_comercial} · empresa activa` : e.nombre_comercial, value: e.id })))
const sinAccesoGlobal = computed(() => estado.compartida && !alcanceGlobal.value)
const codigo = computed(() => (problema.value ? codigoProblema(problema.value) : null))
const quien = computed({
    get: () => (estado.compartida ? 'compartida' : 'una'),
    set: (v: string) => {
        estado.compartida = v === 'compartida'
    },
})

async function guardar(evento: FormSubmitEvent<SalidaInstancia>) {
    errorToken.value = null
    const conToken = !editando.value || cambiarToken.value
    if (conToken && token.value.trim().length < 8) {
        errorToken.value = 'Pega aquí el token de SmartOLT (es más largo)'
        return
    }
    enviando.value = true
    problema.value = null
    const datos = {
        nombre: evento.data.nombre,
        url: urlDeSubdominio(evento.data.subdominio),
        compartida: evento.data.compartida,
        empresa_id: evento.data.compartida ? null : evento.data.empresa_id,
        nota: evento.data.nota || null,
        activo: evento.data.activo,
        ...(conToken ? { token: token.value.trim() } : {}),
    }
    const r = props.instancia
        ? await useSmartOlt().editar(props.instancia.id, props.instancia.version, datos)
        : await useSmartOlt().crear({ ...datos, token: token.value.trim() })
    enviando.value = false
    if (!r.ok) {
        problema.value = r.problema
        if (r.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(r.problema).map(e => (e.name === 'url' ? { ...e, name: 'subdominio' } : e)))
        }
        if (codigoProblema(r.problema) === 'subdominio_duplicado') {
            formulario.value?.setErrors([{ name: 'subdominio', message: r.problema.detail ?? 'Ese subdominio ya está registrado' }])
        }
        return
    }
    emit('guardada', r.data)
}
</script>

<template>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
            class="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row"
            data-prueba="smartolt-formulario"
        >
            <div class="min-w-0 flex-1 px-1 pb-4 sm:px-4">
                <UAlert
                    v-if="codigo === 'subdominio_duplicado'"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    title="No se guardó."
                    :description="problema?.detail"
                    class="my-3"
                    data-prueba="error-subdominio"
                />
                <UAlert
                    v-else-if="problema && problema.status === 409"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    title="Otra persona cambió esta instancia mientras la editabas."
                    description="Recarga para ver sus cambios y vuelve a aplicar los tuyos."
                    class="my-3"
                    :actions="[{ label: 'Recargar', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => emit('recargar') }]"
                    data-prueba="error-version"
                />
                <ProblemaAlerta
                    v-else-if="problema && problema.status !== 422 && problema.status !== 403"
                    :problema="problema"
                    class="my-3"
                />
                <UAlert
                    v-if="editando"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    class="my-3"
                >
                    <template #description>
                        Si cambias el <b>subdominio</b> o el <b>token</b>, se borra la última prueba y la instancia queda «Sin probar» hasta que pruebes la conexión.
                    </template>
                </UAlert>

                <UForm
                    :id="idFormulario"
                    ref="formulario"
                    :schema="esquemaInstancia"
                    :state="estado"
                    :disabled="enviando"
                    class="flex flex-col"
                    @submit="guardar"
                >
                    <div class="grid gap-4 border-b border-(--ax-borde) py-4 md:grid-cols-[13rem_minmax(0,1fr)]">
                        <div>
                            <p class="text-sm font-semibold text-highlighted">
                                1 · La cuenta
                            </p>
                            <p class="text-xs text-muted">
                                Los datos de tu cuenta de SmartOLT. El token se guarda cifrado y nunca se vuelve a mostrar.
                            </p>
                        </div>
                        <div class="flex min-w-0 flex-col gap-3">
                            <div class="grid gap-3 sm:grid-cols-2">
                                <UFormField
                                    label="Nombre en Argos"
                                    name="nombre"
                                    required
                                    help="Para reconocerla en las listas. No puede repetirse en la empresa."
                                >
                                    <UInput
                                        v-model="estado.nombre"
                                        placeholder="Zona norte"
                                        class="w-full"
                                        data-prueba="instancia-nombre"
                                    />
                                </UFormField>
                                <UFormField
                                    label="Subdominio"
                                    name="subdominio"
                                    required
                                    :help="editando ? undefined : 'Solo la parte antes de «.smartolt.com».'"
                                >
                                    <UInput
                                        v-model="estado.subdominio"
                                        placeholder="miempresa"
                                        autocomplete="off"
                                        class="w-full font-mono"
                                        :ui="{ trailing: 'pe-2.5 text-xs text-muted' }"
                                        data-prueba="instancia-subdominio"
                                    >
                                        <template #trailing>
                                            .smartolt.com
                                        </template>
                                    </UInput>
                                </UFormField>
                            </div>
                            <UFormField
                                label="Token (clave de API)"
                                name="token"
                                :required="!editando"
                                :error="errorToken ?? undefined"
                                :help="editando ? 'Para conservarlo, déjalo así. Si lo cambias o cambias el subdominio, hay que probar la conexión otra vez.' : undefined"
                            >
                                <div
                                    v-if="editando && !cambiarToken"
                                    class="flex h-9 w-full items-center gap-2 rounded-md bg-(--ax-panel) px-3 ring ring-default"
                                >
                                    <UIcon
                                        name="i-lucide-key-round"
                                        class="size-4 text-dimmed"
                                    />
                                    <span class="font-mono">***</span>
                                    <UButton
                                        label="Cambiar"
                                        variant="link"
                                        size="sm"
                                        class="ms-auto"
                                        data-prueba="instancia-cambiar-token"
                                        @click="cambiarToken = true"
                                    />
                                </div>
                                <div
                                    v-else
                                    class="flex gap-2"
                                >
                                    <UInput
                                        v-model="token"
                                        type="password"
                                        autocomplete="new-password"
                                        icon="i-lucide-key-round"
                                        placeholder="Pega aquí el token de SmartOLT"
                                        class="w-full"
                                        data-prueba="instancia-token"
                                    />
                                    <UButton
                                        v-if="editando"
                                        label="Deshacer"
                                        icon="i-lucide-undo-2"
                                        color="neutral"
                                        variant="ghost"
                                        @click="cambiarToken = false; token = ''"
                                    />
                                </div>
                            </UFormField>
                        </div>
                    </div>

                    <div class="grid gap-4 border-b border-(--ax-borde) py-4 md:grid-cols-[13rem_minmax(0,1fr)]">
                        <div>
                            <p class="text-sm font-semibold text-highlighted">
                                2 · Quién la usa
                            </p>
                            <p class="text-xs text-muted">
                                Una cuenta puede ser de una sola empresa o de todas.
                            </p>
                        </div>
                        <div class="flex min-w-0 flex-col gap-3">
                            <RedPestanas
                                v-model="quien"
                                :items="[{ label: 'Una empresa', value: 'una', icon: 'i-lucide-building' }, { label: 'Compartida', value: 'compartida', icon: 'i-lucide-globe' }]"
                                etiqueta="Quién la usa"
                                data-prueba="instancia-quien"
                            />
                            <UFormField
                                v-if="!estado.compartida"
                                label="Empresa"
                                name="empresa_id"
                                required
                            >
                                <USelect
                                    :model-value="estado.empresa_id ?? undefined"
                                    :items="itemsEmpresas"
                                    icon="i-lucide-building"
                                    class="w-full"
                                    data-prueba="instancia-empresa"
                                    @update:model-value="v => estado.empresa_id = typeof v === 'number' ? v : null"
                                />
                            </UFormField>
                            <UAlert
                                v-else-if="!sinAccesoGlobal"
                                color="info"
                                variant="subtle"
                                icon="i-lucide-globe"
                            >
                                <template #description>
                                    Todas las empresas de la instalación podrán usar esta cuenta. Úsala cuando una misma OLT atiende a varias empresas. <b>Solo la crea y la cambia quien tiene acceso a todas las empresas.</b>
                                </template>
                            </UAlert>
                            <UAlert
                                v-if="sinAccesoGlobal || (problema && problema.status === 403)"
                                color="error"
                                variant="subtle"
                                icon="i-lucide-triangle-alert"
                                data-prueba="error-sin-alcance"
                            >
                                <template #description>
                                    <b>No tienes acceso a todas las empresas.</b> Pide a un administrador global que la cree como compartida, o elige «Una empresa».
                                </template>
                            </UAlert>
                        </div>
                    </div>

                    <div class="grid gap-4 border-b border-(--ax-borde) py-4 md:grid-cols-[13rem_minmax(0,1fr)]">
                        <div>
                            <p class="text-sm font-semibold text-highlighted">
                                3 · Nota
                            </p>
                            <p class="text-xs text-muted">
                                Opcional. Para ti y tu equipo, el cliente no la ve.
                            </p>
                        </div>
                        <UFormField name="nota">
                            <UTextarea
                                v-model="estado.nota"
                                :rows="2"
                                autoresize
                                placeholder="Ej.: cuenta de las OLT de la zona norte. La renueva Luis en enero."
                                class="w-full"
                                data-prueba="instancia-nota"
                            />
                        </UFormField>
                    </div>

                    <div class="grid gap-4 py-4 md:grid-cols-[13rem_minmax(0,1fr)]">
                        <div>
                            <p class="text-sm font-semibold text-highlighted">
                                4 · {{ editando ? 'Encendida' : 'Al guardar' }}
                            </p>
                            <p class="text-xs text-muted">
                                Puedes dejarla apagada y encenderla cuando estés listo.
                            </p>
                        </div>
                        <USwitch
                            v-model="estado.activo"
                            :label="editando ? 'Encendida' : 'Encenderla al guardar'"
                            description="Argos la usa solo cuando está encendida y la prueba salió bien"
                            data-prueba="instancia-activo"
                        />
                    </div>
                </UForm>
            </div>

            <aside class="flex w-full shrink-0 flex-col gap-3 border-(--ax-borde) bg-(--ax-panel)/50 p-4 lg:w-80 lg:border-s">
                <p class="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                    ¿Dónde saco el token?
                </p>
                <ol class="flex flex-col gap-1 rounded-xl border border-(--ax-borde) bg-(--ax-tarjeta) p-3 text-sm">
                    <li><b>1.</b> Entra a tu cuenta de SmartOLT.</li>
                    <li><b>2.</b> Ve a <b>General › API key</b>.</li>
                    <li><b>3.</b> Copia la clave y pégala aquí.</li>
                </ol>
                <UAlert
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                >
                    <template #description>
                        Si la clave está <b>limitada a una zona</b>, Argos solo verá las OLT de esa zona.
                    </template>
                </UAlert>
                <UAlert
                    color="info"
                    variant="subtle"
                    icon="i-lucide-info"
                >
                    <template #description>
                        Después de guardar, pulsa <b>Probar conexión</b>: se comprueba el token y se traen las OLT de la cuenta.
                    </template>
                </UAlert>
            </aside>
        </div>

        <div class="flex flex-wrap items-center gap-2 border-t border-(--ax-borde) px-1 pt-3 sm:px-4">
            <span class="me-auto text-xs text-muted">Los cambios quedan en la bitácora; el token siempre como «***».</span>
            <slot name="cancelar" />
            <UButton
                type="submit"
                :form="idFormulario"
                label="Guardar"
                icon="i-lucide-check"
                :loading="enviando"
                :disabled="sinAccesoGlobal"
                class="glow-brand"
                data-prueba="instancia-guardar"
            />
        </div>
    </div>
</template>
