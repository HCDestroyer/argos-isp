<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'

/**
 * Configuración del inventario de la empresa activa (A3, `contratos/inventario.md` D.1 y D.5):
 * - si recibir una orden de traslado exige firma (`inventario.configurar`; sin firma obligatoria se
 *   permite la aceptación simple);
 * - la IA que lee facturas de compra en PDF o imagen (`inventario.configurar_ia`): proveedor, modelo,
 *   URL base y clave. La clave se escribe y nunca vuelve: solo se ve si hay una guardada.
 *
 * Con «Todas las empresas» la firma no se lee (es de cada empresa: se pide elegir una) y la IA que se
 * ve y se guarda es la global (`global: true`). Los 409 y 422 se explican en palabras simples.
 */
definePageMeta({ permiso: 'inventario.configurar' })

useHead({ title: 'Inventario · Configuración · ArgosIsp' })

const toast = useToast()
const { puede } = usePermisos()
const { eleccion } = useEmpresaActiva()
/** El selector está en «Todas las empresas» (solo con alcance global): no hay empresa activa. */
const enTodas = computed(() => eleccion.value === 'todas')

/** El problema de la API en palabras simples (409 de versión, 422 de empresa o de datos). */
function problemaClaro(problema: Problem): Problem {
    if (problema.status === 409) {
        return { ...problema, title: 'Alguien más cambió esta configuración', detail: 'Ya se cargó la versión actual. Revísala y vuelve a guardar.' }
    }
    if (problema.status === 422 && codigoProblema(problema) === 'empresa_requerida') {
        return { ...problema, title: 'Elige una empresa', detail: 'Esta configuración es de cada empresa: elige una en el selector de empresa de arriba.' }
    }
    if (problema.status === 422) {
        const mensajes = (problema.errors ?? []).map(e => e.message).filter(Boolean)
        return { ...problema, title: 'Revisa los datos', detail: mensajes.length ? mensajes.join('. ') : problema.detail }
    }
    return problema
}

/* Firma al recibir */
const configuracion = shallowRef<ConfiguracionInventario | null>(null)
const problemaConfiguracion = ref<Problem | null>(null)
const cargandoConfiguracion = ref(false)
const guardandoFirma = ref(false)
const problemaFirma = ref<Problem | null>(null)
/** Sin empresa activa la firma no se puede leer ni guardar: se pide elegir una (no es un error). */
const firmaPideEmpresa = computed(() => enTodas.value || (problemaConfiguracion.value !== null && codigoProblema(problemaConfiguracion.value) === 'empresa_requerida'))

async function cargarConfiguracion() {
    problemaFirma.value = null
    if (enTodas.value) {
        configuracion.value = null
        problemaConfiguracion.value = null
        return
    }
    // `GET /inventario/configuracion` pide `inventario.ver` (todos los roles que configuran lo tienen).
    if (!puede('inventario.ver')) {
        problemaConfiguracion.value = { type: 'about:blank', title: 'Sin permiso', status: 403, detail: 'Falta el permiso inventario.ver.' }
        return
    }
    cargandoConfiguracion.value = true
    const resultado = await useConfiguracionInventario().ver()
    cargandoConfiguracion.value = false
    configuracion.value = resultado.ok ? resultado.data : null
    problemaConfiguracion.value = resultado.ok ? null : resultado.problema
}

async function cambiarFirma(valor: boolean) {
    if (!configuracion.value) {
        return
    }
    guardandoFirma.value = true
    problemaFirma.value = null
    const resultado = await useConfiguracionInventario().guardar(valor, configuracion.value.version, nuevaClaveIdempotencia())
    guardandoFirma.value = false
    if (!resultado.ok) {
        if (resultado.problema.status === 409) {
            await cargarConfiguracion()
        }
        problemaFirma.value = problemaClaro(resultado.problema)
        return
    }
    configuracion.value = resultado.data
    toast.add({ title: valor ? 'La firma es obligatoria al recibir' : 'Se permite recibir sin firma', icon: 'i-lucide-circle-check', color: 'success' })
}

/* IA */
const puedeIa = computed(() => puede('inventario.configurar_ia'))
const ia = shallowRef<ConfiguracionIa | null>(null)
/** Sin configuración la API responde 404: se configura desde cero (`version` 0). */
const sinIa = ref(false)
const problemaIa = ref<Problem | null>(null)
const cargandoIa = ref(false)
const formularioIa = useTemplateRef('formularioIa')
const estadoIa = reactive<EntradaIa>({ proveedor: 'anthropic', modelo: PROVEEDORES_IA.anthropic.modelo, url_base: '', activo: true })
const clave = ref<Secreto>({ accion: 'conservar', valor: '' })
const guardandoIa = ref(false)
const problemaGuardarIa = ref<Problem | null>(null)

function llenarIa(c: ConfiguracionIa | null) {
    Object.assign(estadoIa, c
        ? { proveedor: c.proveedor, modelo: c.modelo, url_base: c.url_base ?? '', activo: c.activo }
        : { proveedor: 'anthropic', modelo: PROVEEDORES_IA.anthropic.modelo, url_base: '', activo: true })
    clave.value = { accion: 'conservar', valor: '' }
}

async function cargarIa() {
    if (!puedeIa.value) {
        return
    }
    cargandoIa.value = true
    problemaGuardarIa.value = null
    const resultado = await useConfiguracionInventario().verIa(enTodas.value)
    cargandoIa.value = false
    sinIa.value = !resultado.ok && resultado.problema.status === 404
    ia.value = resultado.ok ? resultado.data : null
    problemaIa.value = resultado.ok || sinIa.value ? null : resultado.problema
    llenarIa(ia.value)
}

onMounted(() => {
    void cargarConfiguracion()
    void cargarIa()
})

// Cambiar de empresa en el selector relee las dos secciones.
watch(eleccion, () => {
    void cargarConfiguracion()
    void cargarIa()
})

const itemsProveedor = computed<RadioGroupItem[]>(() => (Object.keys(PROVEEDORES_IA) as ProveedorIa[]).map(p => ({ label: PROVEEDORES_IA[p].etiqueta, description: PROVEEDORES_IA[p].descripcion, value: p })))

watch(() => estadoIa.proveedor, (nuevo, anterior) => {
    if (anterior && estadoIa.modelo === PROVEEDORES_IA[anterior].modelo) {
        estadoIa.modelo = PROVEEDORES_IA[nuevo].modelo
    }
})

async function guardarIa(evento: FormSubmitEvent<EntradaIa>) {
    guardandoIa.value = true
    problemaGuardarIa.value = null
    const d = evento.data
    const resultado = await useConfiguracionInventario().guardarIa({
        proveedor: d.proveedor,
        modelo: d.modelo,
        url_base: d.url_base || null,
        activo: d.activo,
        version: ia.value?.version ?? 0,
        // En «Todas las empresas» se guarda la global (la API la permite solo con alcance global).
        ...(enTodas.value ? { global: true } : {}),
        // La clave solo viaja si se cambió: sin el campo se conserva, null la borra.
        ...(clave.value.accion === 'reemplazar' ? { api_key: clave.value.valor } : {}),
        ...(clave.value.accion === 'borrar' ? { api_key: null } : {}),
    }, nuevaClaveIdempotencia())
    guardandoIa.value = false
    if (!resultado.ok) {
        if (resultado.problema.status === 409) {
            await cargarIa()
        }
        const errores = erroresDeFormulario(resultado.problema)
        if (errores.length) {
            formularioIa.value?.setErrors(errores)
        }
        problemaGuardarIa.value = problemaClaro(resultado.problema)
        return
    }
    ia.value = resultado.data
    sinIa.value = false
    llenarIa(resultado.data)
    toast.add({ title: 'IA guardada', description: resultado.data.clave_configurada ? 'Con su clave guardada.' : 'Sin clave guardada.', icon: 'i-lucide-circle-check', color: 'success' })
}
</script>

<template>
    <ConfiguracionMarco
        id="configuracion-inventario"
        empresas
    >
        <div class="flex w-full max-w-3xl flex-col gap-4">
            <ConfiguracionBloque
                titulo="Recibir órdenes de traslado"
                descripcion="Con la firma obligatoria se recibe con firma digital en pantalla o en papel. Sin ella, también por aceptación simple."
                icono="i-lucide-pen-line"
            >
                <UAlert
                    v-if="firmaPideEmpresa"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-building-2"
                    title="Elige una empresa"
                    description="La firma al recibir traslados es de cada empresa: elige una en el selector de empresa de arriba para verla o cambiarla."
                    data-prueba="config-firma-elige-empresa"
                />
                <ProblemaAlerta
                    v-else-if="problemaConfiguracion"
                    :problema="problemaConfiguracion"
                    :reintentar="cargarConfiguracion"
                    :reintentando="cargandoConfiguracion"
                />
                <USkeleton
                    v-else-if="!configuracion"
                    class="h-8 w-64"
                />
                <div
                    v-else
                    class="flex flex-col gap-3"
                >
                    <USwitch
                        :model-value="configuracion.traslado_firma_obligatoria"
                        label="Firma obligatoria al recibir"
                        :description="configuracion.traslado_firma_obligatoria ? 'Nadie recibe sin firmar.' : 'Se permite la aceptación simple, sin firma.'"
                        :loading="guardandoFirma"
                        :disabled="guardandoFirma"
                        data-prueba="config-firma-obligatoria"
                        @update:model-value="cambiarFirma"
                    />
                    <ProblemaAlerta
                        v-if="problemaFirma"
                        :problema="problemaFirma"
                    />
                </div>
            </ConfiguracionBloque>

            <ConfiguracionBloque
                v-if="puedeIa"
                titulo="IA para facturas de compra"
                descripcion="Lee las facturas en PDF o imagen y propone el borrador. El XML FEL no la necesita. Sin IA, el borrador se captura a mano."
                icono="i-lucide-sparkles"
            >
                <ProblemaAlerta
                    v-if="problemaIa"
                    :problema="problemaIa"
                    :reintentar="cargarIa"
                    :reintentando="cargandoIa"
                />
                <USkeleton
                    v-else-if="cargandoIa"
                    class="h-40 w-full"
                />
                <UForm
                    v-else
                    ref="formularioIa"
                    :schema="esquemaIa"
                    :state="estadoIa"
                    class="flex flex-col gap-4"
                    @submit="guardarIa"
                >
                    <UAlert
                        v-if="enTodas"
                        color="info"
                        variant="subtle"
                        icon="i-lucide-globe"
                        title="Configuración global"
                        description="Con «Todas las empresas» se ve y se guarda la global: la usan las empresas que no tienen una propia."
                        data-prueba="config-ia-global"
                    />
                    <UAlert
                        v-if="sinIa"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-sparkles"
                        title="Todavía no hay IA configurada"
                        description="Las facturas en PDF o imagen se cargarán vacías para capturarlas a mano."
                        data-prueba="config-ia-sin"
                    />
                    <UAlert
                        v-else-if="ia && ia.empresa_id === null && !enTodas"
                        color="info"
                        variant="subtle"
                        icon="i-lucide-globe"
                        title="La empresa usa la configuración global"
                        description="Al guardar aquí se crea una propia para la empresa activa."
                    />
                    <UFormField
                        label="Proveedor"
                        name="proveedor"
                    >
                        <URadioGroup
                            v-model="estadoIa.proveedor"
                            :items="itemsProveedor"
                            variant="card"
                            class="w-full"
                            :ui="{ fieldset: 'grid gap-2 sm:grid-cols-2' }"
                            data-prueba="config-ia-proveedor"
                        />
                    </UFormField>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <UFormField
                            label="Modelo"
                            name="modelo"
                            required
                        >
                            <UInput
                                v-model="estadoIa.modelo"
                                class="w-full font-mono"
                                data-prueba="config-ia-modelo"
                            />
                        </UFormField>
                        <UFormField
                            label="URL base"
                            name="url_base"
                            :required="estadoIa.proveedor === 'privada'"
                            :help="estadoIa.proveedor === 'privada' ? 'Compatible con OpenAI, p. ej. http://ollama:11434/v1' : 'Opcional: vacío = la del proveedor.'"
                        >
                            <UInput
                                v-model="estadoIa.url_base"
                                type="url"
                                class="w-full font-mono"
                                data-prueba="config-ia-url"
                            />
                        </UFormField>
                    </div>
                    <CampoSecreto
                        v-model="clave"
                        :guardado="ia?.clave_configurada ? '***' : null"
                        etiqueta="Clave de API"
                        nombre="api_key"
                        placeholder="La clave del proveedor"
                    />
                    <USwitch
                        v-model="estadoIa.activo"
                        label="Activa"
                        description="Apagada, las facturas en PDF o imagen se capturan a mano."
                    />
                    <ProblemaAlerta
                        v-if="problemaGuardarIa"
                        :problema="problemaGuardarIa"
                    />
                    <div class="flex justify-end">
                        <UButton
                            type="submit"
                            label="Guardar IA"
                            icon="i-lucide-check"
                            :loading="guardandoIa"
                            data-prueba="config-ia-guardar"
                        />
                    </div>
                </UForm>
            </ConfiguracionBloque>
        </div>
    </ConfiguracionMarco>
</template>
