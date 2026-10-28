<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, SelectItem } from '@nuxt/ui'

/**
 * Alta y edición de cliente. Sin `cliente` crea (`POST /clientes` con `Idempotency-Key`);
 * con `cliente` edita (`PUT /clientes/:id` con su `version`, 409 si alguien más lo cambió).
 * "Datos adicionales": un control por cada campo activo del catálogo de campos personalizados
 * (`GET /campos-personalizados?activo=true`, A1), en su orden y con su regla; si el catálogo no se
 * pudo leer, el error se ve con "Reintentar" y el guardado no toca los valores guardados.
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

/** Catálogo activo: `null` mientras carga o si falló (entonces no se manda `campos_personalizados`). */
const catalogo = shallowRef<CampoPersonalizado[] | null>(null)
const cargandoCatalogo = ref(false)
const problemaCatalogo = ref<Problem | null>(null)
const esquema = computed(() => esquemaClienteCon(catalogo.value ?? []))

async function cargarCatalogo() {
    if (!puede('clientes.ver')) {
        // sin `clientes.ver` no se lee el catálogo; el alta queda sin campos y la API dirá si falta uno
        return
    }
    cargandoCatalogo.value = true
    problemaCatalogo.value = null
    const resultado = await useCamposPersonalizados().listar(true)
    cargandoCatalogo.value = false
    if (!resultado.ok) {
        problemaCatalogo.value = resultado.problema
        return
    }
    catalogo.value = resultado.data
    estado.campos_personalizados = entradaCampos(resultado.data, props.cliente?.campos_personalizados)
}

function opcionesDe(campo: CampoPersonalizado): SelectItem[] {
    return campo.opciones.map(opcion => ({ label: opcion, value: opcion }))
}

function numeroDe(valor: ValorCampoFormulario): number | undefined {
    return typeof valor === 'number' ? valor : undefined
}

function textoDe(valor: ValorCampoFormulario): string {
    return typeof valor === 'string' ? valor : ''
}

/** Guarda el valor de un campo personalizado y quita su error (la lista y el interruptor no validan al escribir). */
function fijarCampo(clave: string, valor: ValorCampoFormulario) {
    estado.campos_personalizados[clave] = valor
    formulario.value?.clear(`campos_personalizados.${clave}`)
}
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
    estado.tipo_documento_fiscal = 'cf'
    estado.nit_cui = ''
}

const itemsDocumento: SelectItem[] = Object.entries(TIPOS_DOCUMENTO_FISCAL).map(([value, label]) => ({ label, value }))
const PLACEHOLDER_DOCUMENTO: Record<TipoDocumentoFiscal, string> = { nit: '1234567-9', cui: '2984 56132 0101', pasaporte: 'A1234567', cf: 'Sin número' }

/** Al escribir un número con «Consumidor final» elegido, el tipo se deduce como lo hace la API. */
watch(() => estado.nit_cui, (valor) => {
    if (estado.tipo_documento_fiscal === 'cf' && valor.trim() && limpiarDocumento(valor) !== 'CF') {
        estado.tipo_documento_fiscal = deducirTipoDocumento(valor) ?? (/^\d/.test(valor.trim()) ? 'nit' : 'pasaporte')
    }
})

async function alEnviar(evento: FormSubmitEvent<SalidaCliente>) {
    enviando.value = true
    problema.value = null
    const cuerpo = cuerpoCliente(evento.data, catalogo.value ? { catalogo: catalogo.value, guardados: props.cliente?.campos_personalizados } : undefined)
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
    void cargarCatalogo()
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
        :schema="esquema"
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
            title="Hay datos por corregir"
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
                    help="Aparece en el aviso de cobro, el recibo y la búsqueda."
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
                    help="Por dónde le llegan los avisos de cobro, de corte y de reactivación."
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
                    help="Para buscarlo al cobrar y para contactarlo."
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
                    help="Para enviarle el aviso de cobro y la factura electrónica."
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
                    help="Agrupa clientes por sector para reportes, corte y la empresa que factura."
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
                    help="Se propone como dirección de instalación de sus servicios."
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
            description="Se usa en el aviso de cobro y en la factura electrónica (FEL)."
            variant="subtle"
        >
            <UAlert
                v-if="cliente?.nit_cui_invalido"
                color="warning"
                variant="subtle"
                icon="i-lucide-badge-alert"
                title="NIT o CUI por corregir"
                description="El número no pasó la validación al activar la localización fiscal (se conservó tal cual). Corrígelo o márcalo como consumidor final: la factura FEL lo exige válido."
                class="mb-4"
                data-prueba="nit-invalido"
            />
            <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                    name="tipo_documento_fiscal"
                    label="Documento"
                >
                    <USelect
                        v-model="estado.tipo_documento_fiscal"
                        :items="itemsDocumento"
                        class="w-full"
                    />
                </UFormField>
                <UFormField
                    name="nit_cui"
                    label="Número"
                    :required="estado.tipo_documento_fiscal !== 'cf'"
                    help="La factura electrónica (FEL) sale a nombre de este documento."
                    :description="estado.tipo_documento_fiscal === 'nit' ? 'Con dígito verificador (módulo 11).' : estado.tipo_documento_fiscal === 'cui' ? '13 dígitos del DPI.' : estado.tipo_documento_fiscal === 'pasaporte' ? '3 a 20 letras o dígitos.' : 'Consumidor final no lleva número.'"
                >
                    <UFieldGroup class="w-full">
                        <UInput
                            v-model="estado.nit_cui"
                            :placeholder="PLACEHOLDER_DOCUMENTO[estado.tipo_documento_fiscal]"
                            :disabled="estado.tipo_documento_fiscal === 'cf'"
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
                    name="pais_fiscal"
                    required
                    label="País"
                    description="NIT y CUI son de Guatemala; un extranjero usa pasaporte."
                >
                    <UInput
                        v-model="estado.pais_fiscal"
                        maxlength="2"
                        class="w-full font-mono uppercase"
                    />
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

                <UFormField
                    name="agente_retencion_iva"
                    description="Retiene IVA al pagar sus facturas."
                >
                    <USwitch
                        v-model="estado.agente_retencion_iva"
                        label="Agente de retención de IVA"
                    />
                </UFormField>
                <UFormField
                    name="sector_publico"
                    description="Reglas propias de retención."
                >
                    <USwitch
                        v-model="estado.sector_publico"
                        label="Sector público"
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

        <UPageCard
            v-if="problemaCatalogo || cargandoCatalogo || (catalogo && catalogo.length)"
            title="Datos adicionales"
            description="Campos propios de la empresa (catálogo de campos personalizados)."
            variant="subtle"
            data-prueba="cliente-campos-personalizados"
        >
            <ProblemaAlerta
                v-if="problemaCatalogo"
                :problema="problemaCatalogo"
                :reintentar="cargarCatalogo"
                :reintentando="cargandoCatalogo"
            />
            <USkeleton
                v-else-if="cargandoCatalogo"
                class="h-16 w-full"
            />
            <div
                v-else-if="catalogo"
                class="grid gap-4 sm:grid-cols-2"
            >
                <UFormField
                    v-for="campo in catalogo"
                    :key="campo.clave"
                    :label="campo.tipo === 'booleano' ? undefined : campo.etiqueta"
                    :name="`campos_personalizados.${campo.clave}`"
                    :required="campo.requerido && campo.tipo !== 'booleano'"
                    :data-prueba="`campo-cliente-${campo.clave}`"
                >
                    <USwitch
                        v-if="campo.tipo === 'booleano'"
                        :model-value="estado.campos_personalizados[campo.clave] === true"
                        :label="campo.etiqueta"
                        @update:model-value="valor => fijarCampo(campo.clave, valor)"
                    />
                    <UInputNumber
                        v-else-if="campo.tipo === 'numero'"
                        :model-value="numeroDe(estado.campos_personalizados[campo.clave])"
                        :format-options="{ useGrouping: false, maximumFractionDigits: 6 }"
                        class="w-full"
                        @update:model-value="valor => fijarCampo(campo.clave, typeof valor === 'number' ? valor : null)"
                    />
                    <USelect
                        v-else-if="campo.tipo === 'opcion'"
                        :model-value="textoDe(estado.campos_personalizados[campo.clave]) || undefined"
                        :items="opcionesDe(campo)"
                        placeholder="Elige una opción"
                        class="w-full"
                        @update:model-value="valor => fijarCampo(campo.clave, typeof valor === 'string' ? valor : '')"
                    />
                    <UInput
                        v-else
                        :model-value="textoDe(estado.campos_personalizados[campo.clave])"
                        :type="campo.tipo === 'fecha' ? 'date' : 'text'"
                        :maxlength="campo.tipo === 'texto' ? 500 : undefined"
                        class="w-full"
                        @update:model-value="valor => fijarCampo(campo.clave, String(valor ?? ''))"
                    />
                </UFormField>
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
