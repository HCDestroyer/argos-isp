<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { DropdownMenuItem, FormSubmitEvent } from '@nuxt/ui'

/**
 * Configuración › Empresa y fiscal › Datos de la empresa (tablero OperConfigEmpresa, pestaña
 * «Datos de la empresa»; multiempresa, `contratos/multiempresa.md`). La empresa se elige con las
 * pastillas de arriba (la empresa activa); sus datos se editan en la misma tarjeta con «Guardar»
 * abajo (edición con `version`, 409 si otra persona la cambió). El logo va en su recuadro. «Nueva»
 * abre el alta en un panel lateral; «Más» lleva las sugerencias por zona y router y desactivar.
 */
definePageMeta({ permiso: 'empresas.ver' })

useHead({ title: 'Empresa y fiscal · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const { empresaId } = useEmpresaActiva()

const empresas = shallowRef<EmpresaGrupo[]>([])
const cargando = ref(false)
const problema = ref<Problem | null>(null)

/** La empresa de la tarjeta: la activa, o la principal si la activa es «Todas». */
const empresa = computed(() => empresas.value.find(e => e.id === empresaId.value)
    ?? empresas.value.find(e => e.principal) ?? empresas.value[0] ?? null)

const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaEmpresaGrupo>(entradaEmpresaGrupo(null))
const guardando = ref(false)
const problemaGuardar = ref<Problem | null>(null)
const conflicto = ref(false)
const masDatos = ref(false)

const editable = computed(() => puede('empresas.editar'))
const cambios = computed(() => empresa.value !== null && JSON.stringify(entradaEmpresaGrupo(empresa.value)) !== JSON.stringify({ ...estado }))

function rellenar() {
    Object.assign(estado, entradaEmpresaGrupo(empresa.value))
    problemaGuardar.value = null
    conflicto.value = false
    formulario.value?.clear()
}

async function cargar() {
    cargando.value = true
    const resultado = await useEmpresas().listar()
    cargando.value = false
    empresas.value = resultado.ok ? resultado.data : []
    problema.value = resultado.ok ? null : resultado.problema
    rellenar()
}

onMounted(cargar)

async function guardar(evento: FormSubmitEvent<SalidaEmpresaGrupo>) {
    const actual = empresa.value
    if (!actual) {
        return
    }
    guardando.value = true
    problemaGuardar.value = null
    conflicto.value = false
    const resultado = await useEmpresas().editar(actual.id, { ...evento.data, version: actual.version })
    guardando.value = false
    if (!resultado.ok) {
        if (resultado.problema.type.endsWith(':nit_duplicado')) {
            formulario.value?.setErrors([{ name: 'nit', message: resultado.problema.detail ?? 'Ya existe una empresa activa con ese NIT' }])
            return
        }
        if (resultado.problema.status === 409) {
            conflicto.value = true
            return
        }
        problemaGuardar.value = resultado.problema
        if (resultado.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        }
        return
    }
    reemplazar(resultado.data, 'Empresa actualizada')
}

/* Alta («Nueva» en las pastillas: `?nueva=1`), logo y desactivar. */
const altaAbierta = computed({
    get: () => route.query.nueva === '1' && puede('empresas.crear'),
    set: (valor) => {
        void router.replace({ query: { ...route.query, nueva: valor ? '1' : undefined } })
    },
})
const logoAbierto = ref(false)
const desactivarAbierto = ref(false)
const sugerenciasAbiertas = ref(false)

function reemplazar(nueva: EmpresaGrupo, mensaje: string) {
    const existe = empresas.value.some(e => e.id === nueva.id)
    empresas.value = existe ? empresas.value.map(e => (e.id === nueva.id ? nueva : e)) : [...empresas.value, nueva]
    rellenar()
    toast.add({ title: mensaje, description: nueva.nombre_comercial, color: 'success', icon: 'i-lucide-circle-check' })
    // Las pastillas, el selector y `GET /me` traen el nombre y el logo: se releen.
    void useAuth().cargarMe()
}

function desactivar(motivo: string, clave: string) {
    const actual = empresa.value
    if (!actual) {
        return Promise.resolve<Resultado<EmpresaGrupo>>({ ok: false, problema: { type: 'about:blank', title: 'Sin empresa', status: 400 } })
    }
    return useEmpresas().desactivar(actual.id, actual.version, motivo, clave)
}

const masAcciones = computed<DropdownMenuItem[][]>(() => [
    [{ label: 'Empresa sugerida por zona y router', icon: 'i-lucide-route', onSelect: () => { sugerenciasAbiertas.value = true } }],
    ...(puede('empresas.desactivar') && empresa.value?.activa && !empresa.value.principal
        ? [[{ label: 'Desactivar empresa', icon: 'i-lucide-circle-pause', color: 'error' as const, onSelect: () => { desactivarAbierto.value = true } }]]
        : []),
])

/** NIT con forma pero sin módulo 11: aviso, no bloquea Guardar (fel-establecimientos R1). */
const avisoNit = computed(() => avisoDocumentoFiscal('nit', estado.nit ?? ''))

const pais = computed(() => (empresa.value?.pais === 'GT' ? 'Guatemala · GTQ' : empresa.value?.pais ?? '—'))
</script>

<template>
    <ConfiguracionMarco
        id="empresas"
        empresas
    >
        <template #acciones>
            <UDropdownMenu :items="masAcciones">
                <UButton
                    label="Más"
                    icon="i-lucide-ellipsis"
                    color="neutral"
                    variant="outline"
                    data-prueba="empresa-mas"
                />
            </UDropdownMenu>
        </template>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="cargando && !empresa"
            class="h-64 w-full"
        />
        <UEmpty
            v-else-if="!empresa"
            icon="i-lucide-building-2"
            title="Sin empresas"
            description="Crea la primera con «Nueva»."
            variant="naked"
        />
        <UForm
            v-else
            :id="idFormulario"
            ref="formulario"
            :schema="esquemaEmpresaGrupo"
            :state="estado"
            :disabled="!editable"
            class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]"
            data-prueba="empresa-datos"
            @submit="guardar"
        >
            <div class="flex min-w-0 flex-col gap-4">
                <UAlert
                    v-if="conflicto"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-git-compare"
                    title="Alguien más editó esta empresa"
                    description="Tus cambios no se guardaron. Recarga los datos y aplícalos otra vez."
                    :actions="[{ label: 'Recargar', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: cargar }]"
                />
                <ProblemaAlerta
                    v-else-if="problemaGuardar && problemaGuardar.status !== 422"
                    :problema="problemaGuardar"
                />
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        name="nombre_comercial"
                        label="Nombre comercial"
                        required
                    >
                        <UInput
                            v-model="estado.nombre_comercial"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="razon_social"
                        label="Razón social"
                        required
                    >
                        <UInput
                            v-model="estado.razon_social"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="nit"
                        label="NIT"
                        required
                    >
                        <template #hint>
                            <UBadge
                                v-if="empresa.nit_valido === false"
                                label="NIT sin verificar"
                                color="warning"
                                variant="subtle"
                                icon="i-lucide-badge-alert"
                                data-prueba="nit-sin-verificar"
                            />
                        </template>
                        <UInput
                            v-model="estado.nit"
                            class="w-full font-mono"
                            autocomplete="off"
                        />
                        <UAlert
                            v-if="avisoNit"
                            color="warning"
                            variant="subtle"
                            icon="i-lucide-triangle-alert"
                            :description="avisoNit"
                            class="mt-2"
                            data-prueba="aviso-nit-empresa"
                        />
                    </UFormField>
                    <UFormField
                        label="País"
                        help="Cambiarlo es una acción aparte (Régimen e impuestos)."
                    >
                        <UInput
                            :model-value="pais"
                            disabled
                            class="w-full"
                            :ui="{ base: 'border-dashed' }"
                        />
                    </UFormField>
                </div>
                <UFormField
                    name="direccion_fiscal"
                    label="Dirección fiscal"
                >
                    <UInput
                        v-model="estado.direccion_fiscal"
                        icon="i-lucide-map-pin"
                        class="w-full"
                    />
                </UFormField>
                <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField
                        name="telefono"
                        label="Teléfono de atención"
                    >
                        <UInput
                            v-model="estado.telefono"
                            icon="i-lucide-phone"
                            class="w-full"
                        />
                    </UFormField>
                    <UFormField
                        name="correo"
                        label="Correo de facturación"
                    >
                        <UInput
                            v-model="estado.correo"
                            icon="i-lucide-mail"
                            type="email"
                            class="w-full"
                        />
                    </UFormField>
                </div>

                <UCollapsible v-model:open="masDatos">
                    <UButton
                        :label="masDatos ? 'Menos datos' : 'Más datos: municipio, WhatsApp, horario, página de corte'"
                        :icon="masDatos ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                        color="neutral"
                        variant="link"
                        class="px-0"
                        data-prueba="empresa-mas-datos"
                    />
                    <template #content>
                        <div class="grid gap-4 pt-3 sm:grid-cols-2">
                            <UFormField
                                name="municipio"
                                label="Municipio"
                            >
                                <UInput
                                    v-model="estado.municipio"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                name="departamento"
                                label="Departamento"
                            >
                                <UInput
                                    v-model="estado.departamento"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                name="telefono_alterno"
                                label="Teléfono alterno"
                            >
                                <UInput
                                    v-model="estado.telefono_alterno"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                name="whatsapp"
                                label="WhatsApp"
                            >
                                <UInput
                                    v-model="estado.whatsapp"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                name="sitio_web"
                                label="Sitio web"
                            >
                                <UInput
                                    v-model="estado.sitio_web"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                name="horario"
                                label="Horario"
                            >
                                <UInput
                                    v-model="estado.horario"
                                    class="w-full"
                                />
                            </UFormField>
                            <UFormField
                                name="color_marca"
                                label="Color de marca"
                                hint="#RRGGBB"
                            >
                                <UInput
                                    v-model="estado.color_marca"
                                    class="w-full font-mono"
                                />
                            </UFormField>
                            <UFormField
                                name="url_corte"
                                label="Página de corte propia"
                                :help="AYUDA_URL_CORTE"
                            >
                                <UInput
                                    v-model="estado.url_corte"
                                    class="w-full font-mono"
                                    data-prueba="url-corte-empresa"
                                />
                            </UFormField>
                        </div>
                    </template>
                </UCollapsible>
            </div>

            <aside class="flex h-fit flex-col items-center gap-3 rounded-2xl border border-(--ax-borde) p-4 text-center">
                <p class="flex items-center gap-2 self-start text-xs font-bold tracking-[0.06em] text-muted uppercase">
                    <UIcon
                        name="i-lucide-image"
                        class="size-4"
                    />
                    Logo en documentos
                </p>
                <UAvatar
                    :src="urlLogoEmpresa(empresa.logo_url)"
                    :alt="empresa.nombre_comercial"
                    class="size-24 rounded-2xl text-2xl"
                />
                <p class="text-xs text-muted">
                    PNG o SVG · se usa en facturas, recibos y portal
                </p>
                <UButton
                    v-if="puede('empresas.cambiar_logo')"
                    label="Cambiar logo"
                    icon="i-lucide-upload"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    data-prueba="empresa-logo"
                    @click="logoAbierto = true"
                />
                <UBadge
                    :label="empresa.activa ? 'Activa' : 'Inactiva'"
                    :icon="empresa.activa ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                    :color="empresa.activa ? 'success' : 'neutral'"
                    variant="subtle"
                    size="sm"
                />
            </aside>
        </UForm>

        <template #pie>
            <span class="me-auto text-sm text-muted">Cada empresa tiene su NIT, sus cuentas y su libro. Nada se mezcla entre empresas.</span>
            <template v-if="editable && empresa">
                <UButton
                    label="Descartar"
                    color="neutral"
                    variant="ghost"
                    :disabled="!cambios || guardando"
                    @click="rellenar"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    label="Guardar"
                    icon="i-lucide-check"
                    :loading="guardando"
                    :disabled="!cambios"
                    class="glow-brand"
                    data-prueba="empresa-guardar"
                />
            </template>
        </template>

        <EmpresaFormulario
            v-model:open="altaAbierta"
            :empresa="null"
            @guardada="nueva => reemplazar(nueva, 'Empresa creada')"
        />
        <EmpresaLogoModal
            v-if="empresa"
            v-model:open="logoAbierto"
            :empresa="empresa"
            @guardada="nueva => reemplazar(nueva, 'Logo actualizado')"
        />
        <AccionMotivoModal
            v-model:open="desactivarAbierto"
            titulo="Desactivar empresa"
            :descripcion="empresa ? `${empresa.nombre_comercial} · NIT ${empresa.nit ?? '—'}` : undefined"
            efecto="La empresa deja de aparecer en el selector y su NIT queda libre. No se borra: sus documentos siguen. Si tiene servicios sin retirar, primero hay que pasarlos a otra empresa."
            confirmar="Desactivar empresa"
            icono="i-lucide-circle-pause"
            placeholder="Ej.: el NIT dejó de operar"
            :ejecutar="desactivar"
            @hecho="nueva => reemplazar(nueva, 'Empresa desactivada')"
        />
        <USlideover
            v-model:open="sugerenciasAbiertas"
            title="Empresa sugerida por zona y router"
            description="Para los servicios nuevos: servicio › zona › router › empresa activa."
            :ui="{ content: 'sm:max-w-2xl' }"
        >
            <template #body>
                <EmpresasSugeridas :empresas="empresas.filter(e => e.activa)" />
            </template>
        </USlideover>
    </ConfiguracionMarco>
</template>
