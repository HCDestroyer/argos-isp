<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { FormSubmitEvent, RadioGroupItem } from '@nuxt/ui'

/**
 * Configuración · Portal de corte (`GET`/`PUT /corte/configuracion`, A5): IPv4, IPv6 y puerto a los
 * que el NAT de los routers manda la navegación de los suspendidos, y cómo se suspende la sesión
 * (desconectar o CoA). Una sola para la instalación; la página por empresa es su `url_corte`.
 * `version` 0 = nunca se guardó (valores iniciales del servidor). Ver con `portal_corte.ver`,
 * guardar con `portal_corte.configurar`; 409 con «Recargar».
 */
definePageMeta({ permiso: 'portal_corte.ver' })

useHead({ title: 'Red y portal · ArgosIsp' })

const { puede } = usePermisos()
const toast = useToast()

const config = shallowRef<PortalCorte | null>(null)
const cargando = ref(false)
const problema = ref<Problem | null>(null)

const formulario = useTemplateRef('formulario')
const idFormulario = useId()
const estado = reactive<EntradaPortalCorte>({ portal_v4: '', portal_v6: '', portal_puerto: 80, modo_suspension: 'desconectar' })
const enviando = ref(false)
const problemaGuardar = ref<Problem | null>(null)
/** Datos validados que esperan la confirmación de reescribir los routers. */
const pendiente = shallowRef<SalidaPortalCorte | null>(null)
const confirmar = ref(false)

const editable = computed(() => puede('portal_corte.configurar'))
const sinGuardar = computed(() => config.value?.origen === 'entorno')
const sinCambios = computed(() => config.value !== null && JSON.stringify(entradaPortalCorte(config.value)) === JSON.stringify({ ...estado }))
const ayudaIpv4 = computed(() => (estado.portal_v4.trim() === ''
    ? ayudaIpv4Vacia(config.value?.portal_url ?? null)
    : 'Los routers mandan a los suspendidos a esta IP.'))
/** Cambió algo que reescribe las reglas de corte de los routers (IP o puerto). */
const cambiaRed = computed(() => config.value !== null && (estado.portal_v4.trim() !== (config.value.portal_v4 ?? '')
    || estado.portal_v6.trim() !== (config.value.portal_v6 ?? '') || estado.portal_puerto !== config.value.portal_puerto))
const sinDestino = computed(() => estado.portal_v4.trim() === '' && ipv4Deducida(config.value?.portal_url ?? null) === null)

const itemsModo = computed<RadioGroupItem[]>(() => (Object.keys(MODOS_SUSPENSION) as ModoSuspension[]).map(modo => ({
    label: MODOS_SUSPENSION[modo].etiqueta,
    description: MODOS_SUSPENSION[modo].descripcion,
    value: modo,
})))

function rellenar(datos: PortalCorte) {
    config.value = datos
    Object.assign(estado, entradaPortalCorte(datos))
    formulario.value?.clear()
}

async function cargar() {
    cargando.value = true
    const resultado = await usePortalCorte().ver()
    cargando.value = false
    problema.value = resultado.ok ? null : resultado.problema
    if (resultado.ok) {
        problemaGuardar.value = null
        rellenar(resultado.data)
    }
}

function alEnviar(evento: FormSubmitEvent<SalidaPortalCorte>) {
    if (!config.value) {
        return
    }
    if (cambiaReglasRouters(config.value, evento.data)) {
        pendiente.value = evento.data
        confirmar.value = true
        return
    }
    void guardar(evento.data)
}

async function guardar(datos: SalidaPortalCorte) {
    if (!config.value) {
        return
    }
    const antes = config.value
    enviando.value = true
    problemaGuardar.value = null
    const resultado = await usePortalCorte().configurar({ ...datos, version: antes.version })
    enviando.value = false
    confirmar.value = false
    pendiente.value = null
    if (!resultado.ok) {
        problemaGuardar.value = resultado.problema
        if (resultado.problema.status === 422) {
            formulario.value?.setErrors(erroresDeFormulario(resultado.problema))
        }
        return
    }
    rellenar(resultado.data)
    toast.add({
        title: 'Portal de corte guardado',
        description: cambiaReglasRouters(antes, datos)
            ? 'Los routers se están actualizando con la nueva dirección.'
            : 'El cambio aplica desde la siguiente suspensión.',
        icon: 'i-lucide-circle-check',
        color: 'success',
    })
}

/*
 * Lo que acompaña al portal de corte en el tablero OperConfigRed: routers que identifican por
 * código, contraseña inicial del portal y nodos. Cada lectura con su propio error; sin permiso no se
 * pide ni se muestra.
 */
const routersCodigo = shallowRef<RouterNas[] | null>(null)
const problemaRouters = ref<Problem | null>(null)
const contrasena = shallowRef<PortalContrasenaDefecto | null>(null)
const problemaContrasena = ref<Problem | null>(null)
const nodos = shallowRef<NodoPortal[] | null>(null)
const problemaNodos = ref<Problem | null>(null)

async function cargarRouters() {
    const resultado = await useRouters().listar()
    routersCodigo.value = resultado.ok ? resultado.data.data.filter(r => r.corte_identificacion === 'codigo') : null
    problemaRouters.value = resultado.ok ? null : resultado.problema
}

async function cargarContrasena() {
    const resultado = await usePortalContrasena().verDefecto()
    contrasena.value = resultado.ok ? resultado.data : null
    problemaContrasena.value = resultado.ok ? null : resultado.problema
}

async function cargarNodos() {
    const resultado = await useNodosPortal().listar()
    nodos.value = resultado.ok ? resultado.data.data.filter(n => !n.revocado_en) : null
    problemaNodos.value = resultado.ok ? null : resultado.problema
}

function reintentarGuardar() {
    void formulario.value?.submit()
}

onMounted(() => {
    void cargar()
    if (puede('routers.ver')) {
        void cargarRouters()
    }
    if (puede('empresa.ver')) {
        void cargarContrasena()
    }
    if (puede('nodos_portal.administrar')) {
        void cargarNodos()
    }
})
</script>

<template>
    <ConfiguracionMarco
        id="configuracion-portal-corte"
        titulo="Red y portal"
        descripcion="A dónde van los clientes suspendidos y cómo entra cada cliente a su portal"
    >
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <div
            v-else-if="!config"
            class="flex flex-col gap-3"
        >
            <USkeleton class="h-10" />
            <USkeleton class="h-56" />
        </div>
        <template v-else>
            <UAlert
                v-if="sinGuardar"
                color="info"
                variant="subtle"
                icon="i-lucide-server"
                title="Valores iniciales del servidor, todavía no guardados"
                :description="editable ? 'Así funciona hoy. Revísalos y guarda para fijarlos aquí; desde entonces solo se cambian en esta pantalla.' : 'Así funciona hoy. Un administrador puede revisarlos y guardarlos aquí.'"
                data-prueba="portal-corte-sin-guardar"
            />
            <UAlert
                v-if="!editable"
                color="neutral"
                variant="subtle"
                icon="i-lucide-lock"
                title="Solo lectura"
                description="Solo un administrador puede cambiar esta configuración."
            />

            <div class="grid gap-4 xl:grid-cols-2">
                <div class="flex min-w-0 flex-col gap-4">
                    <UForm
                        :id="idFormulario"
                        ref="formulario"
                        :schema="esquemaPortalCorte"
                        :state="estado"
                        :disabled="!editable || enviando"
                        class="flex flex-col gap-4"
                        @submit="alEnviar"
                    >
                        <ConfiguracionBloque
                            titulo="Portal de corte · a dónde van los suspendidos"
                            icono="i-lucide-ban"
                        >
                            <div class="flex flex-col gap-4 py-2">
                                <div class="grid gap-3 sm:grid-cols-3">
                                    <UFormField
                                        label="IPv4 del portal"
                                        name="portal_v4"
                                        :help="ayudaIpv4"
                                        :ui="{ help: sinDestino ? 'text-error' : undefined }"
                                    >
                                        <UInput
                                            v-model="estado.portal_v4"
                                            placeholder="Vacía = automática"
                                            inputmode="decimal"
                                            autocomplete="off"
                                            class="w-full font-mono"
                                            data-prueba="portal-corte-v4"
                                        />
                                    </UFormField>
                                    <UFormField
                                        label="IPv6 (opcional)"
                                        name="portal_v6"
                                        help="Vacía: un suspendido pasa a IPv4."
                                    >
                                        <UInput
                                            v-model="estado.portal_v6"
                                            placeholder="2001:db8::20"
                                            autocomplete="off"
                                            class="w-full font-mono"
                                            data-prueba="portal-corte-v6"
                                        />
                                    </UFormField>
                                    <UFormField
                                        label="Puerto"
                                        name="portal_puerto"
                                        required
                                        help="80, u 8088 con el puerto dedicado."
                                    >
                                        <UInputNumber
                                            v-model="estado.portal_puerto"
                                            :min="1"
                                            :max="65535"
                                            :step="1"
                                            :format-options="{ useGrouping: false }"
                                            class="w-full"
                                            data-prueba="portal-corte-puerto"
                                        />
                                    </UFormField>
                                </div>
                                <UFormField
                                    label="Al suspender un servicio"
                                    name="modo_suspension"
                                    help="Aplica desde la siguiente suspensión; los servicios ya suspendidos siguen como están."
                                >
                                    <URadioGroup
                                        v-model="estado.modo_suspension"
                                        :items="itemsModo"
                                        variant="card"
                                        class="w-full"
                                        :ui="{ fieldset: 'grid gap-2 sm:grid-cols-2' }"
                                        data-prueba="portal-corte-modo"
                                    />
                                </UFormField>
                                <ProblemaAlerta
                                    v-if="problemaGuardar && problemaGuardar.status === 409"
                                    :problema="problemaGuardar"
                                    etiqueta-reintentar="Recargar"
                                    :reintentar="cargar"
                                    :reintentando="cargando"
                                />
                                <ProblemaAlerta
                                    v-else-if="problemaGuardar && problemaGuardar.status !== 422"
                                    :problema="problemaGuardar"
                                    :reintentar="reintentarGuardar"
                                    :reintentando="enviando"
                                />
                                <ProblemaAlerta
                                    v-else-if="problemaGuardar"
                                    :problema="problemaGuardar"
                                />
                            </div>
                        </ConfiguracionBloque>
                    </UForm>

                    <ConfiguracionBloque
                        titulo="Cómo se identifica al cliente cortado"
                        icono="i-lucide-id-card"
                    >
                        <ConfiguracionFila
                            :etiqueta="CORTE_IDENTIFICACION.ip.etiqueta"
                            :ayuda="CORTE_IDENTIFICACION.ip.descripcion"
                            fuerte
                        >
                            <UIcon
                                :name="CORTE_IDENTIFICACION.ip.icono"
                                class="size-4 text-muted"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            :etiqueta="CORTE_IDENTIFICACION.codigo.etiqueta"
                            :ayuda="CORTE_IDENTIFICACION.codigo.descripcion"
                            fuerte
                        >
                            <UIcon
                                :name="CORTE_IDENTIFICACION.codigo.icono"
                                class="size-4 text-muted"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            v-if="puede('routers.ver')"
                            etiqueta="Routers que usan código"
                            ayuda="Se elige en la ficha de cada router."
                        >
                            <ProblemaAlerta
                                v-if="problemaRouters"
                                :problema="problemaRouters"
                                :reintentar="cargarRouters"
                            />
                            <span
                                v-else-if="routersCodigo"
                                data-prueba="routers-codigo"
                            >{{ routersCodigo.length ? routersCodigo.map(r => r.nombre).join(' · ') : 'Ninguno' }}</span>
                            <USkeleton
                                v-else
                                class="h-4 w-32"
                            />
                            <UButton
                                label="Cambiar"
                                variant="link"
                                size="sm"
                                class="p-0"
                                to="/routers"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionPendiente
                            etiqueta="Cuánto dura el código de corte"
                            ayuda="Pasado ese tiempo el cliente pide uno nuevo desde la página de corte."
                            fabrica="15 min de fábrica · de 5 a 60 min"
                            :decision="19"
                        />
                    </ConfiguracionBloque>

                    <ConfiguracionBloque
                        titulo="Caídas repetidas"
                        icono="i-lucide-activity"
                    >
                        <ConfiguracionPendiente
                            etiqueta="Cuándo avisar que un servicio se cae seguido"
                            ayuda="Alerta en Argos y un ticket en Iris por servicio; si caen muchos del mismo router, OLT o zona, un solo ticket general."
                            fabrica="3 caídas en 60 min de fábrica"
                            :decision="31"
                        />
                    </ConfiguracionBloque>
                </div>

                <div class="flex min-w-0 flex-col gap-4">
                    <ConfiguracionBloque
                        titulo="Portal del cliente"
                        icono="i-lucide-globe"
                    >
                        <ConfiguracionFila
                            etiqueta="Dirección"
                            :valor="config.portal_url"
                            mono
                        />
                        <ConfiguracionFila
                            v-if="puede('empresa.ver')"
                            etiqueta="Contraseña inicial"
                            ayuda="La que recibe un cliente sin contraseña propia"
                            fuerte
                        >
                            <ProblemaAlerta
                                v-if="problemaContrasena"
                                :problema="problemaContrasena"
                                :reintentar="cargarContrasena"
                            />
                            <UBadge
                                v-else-if="contrasena"
                                :label="contrasena.configurada ? 'Configurada' : 'Sin configurar'"
                                :icon="contrasena.configurada ? 'i-lucide-lock' : 'i-lucide-lock-open'"
                                :color="contrasena.configurada ? 'success' : 'warning'"
                                variant="subtle"
                                size="sm"
                            />
                            <UButton
                                label="Cambiar"
                                variant="link"
                                size="sm"
                                class="p-0"
                                to="/configuracion/portal-contrasena"
                                data-prueba="portal-contrasena-abrir"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            etiqueta="Pago en línea"
                            ayuda="Con la pasarela de los proveedores de cobro"
                            fuerte
                        >
                            <UButton
                                v-if="puede('bancos.ver')"
                                label="Abrir"
                                variant="link"
                                size="sm"
                                class="p-0"
                                to="/configuracion/proveedores-cobro"
                            />
                        </ConfiguracionFila>
                        <ConfiguracionFila
                            etiqueta="Promesas desde el portal"
                            ayuda="Según la plantilla de facturación del servicio"
                            fuerte
                        >
                            <UButton
                                v-if="puede('plantillas.ver')"
                                label="Abrir"
                                variant="link"
                                size="sm"
                                class="p-0"
                                to="/plantillas"
                            />
                        </ConfiguracionFila>
                    </ConfiguracionBloque>

                    <ConfiguracionBloque
                        v-if="puede('nodos_portal.administrar')"
                        titulo="Nodos del portal"
                        icono="i-lucide-server"
                        accion="Agregar nodo"
                        accion-a="/configuracion/nodos-portal"
                    >
                        <ProblemaAlerta
                            v-if="problemaNodos"
                            :problema="problemaNodos"
                            :reintentar="cargarNodos"
                        />
                        <template v-else-if="nodos">
                            <ConfiguracionFila
                                v-for="nodo in nodos"
                                :key="nodo.id"
                                :etiqueta="nodo.nombre"
                                :ayuda="nodo.ultimo_uso ? `Último uso ${formatearFechaHora(nodo.ultimo_uso)}` : 'Sin uso todavía'"
                            >
                                <UBadge
                                    label="Activo"
                                    icon="i-lucide-circle-check"
                                    color="success"
                                    variant="subtle"
                                    size="sm"
                                />
                            </ConfiguracionFila>
                            <p
                                v-if="!nodos.length"
                                class="py-2 text-sm text-muted"
                            >
                                Sin nodos remotos: el portal corre en el servidor de Argos.
                            </p>
                        </template>
                        <template #pie>
                            Cada nodo sirve la página de corte cerca de sus routers.
                        </template>
                    </ConfiguracionBloque>

                    <ConfiguracionBloque
                        titulo="Página de corte de cada empresa"
                        icono="i-lucide-building-2"
                        descripcion="Cada empresa decide si su cliente suspendido ve la página de corte de Argos o una propia."
                    >
                        <ConfiguracionFila
                            v-if="puede('empresas.ver')"
                            etiqueta="URL de corte por empresa"
                        >
                            <UButton
                                label="Abrir"
                                variant="link"
                                size="sm"
                                class="p-0"
                                to="/configuracion/empresas"
                                data-prueba="portal-corte-empresas"
                            />
                        </ConfiguracionFila>
                    </ConfiguracionBloque>

                    <ConfiguracionBloque
                        v-if="puede('inventario.configurar')"
                        titulo="Inventario de equipos"
                        icono="i-lucide-hexagon"
                    >
                        <ConfiguracionFila
                            etiqueta="Firma al recibir y lectura de compras con IA"
                        >
                            <UButton
                                label="Abrir"
                                variant="link"
                                size="sm"
                                class="p-0"
                                to="/configuracion/inventario"
                            />
                        </ConfiguracionFila>
                    </ConfiguracionBloque>
                </div>
            </div>
        </template>

        <template
            v-if="config"
            #pie
        >
            <span
                class="me-auto flex items-center gap-1.5 text-sm text-muted"
                data-prueba="portal-corte-aviso-routers"
            >
                <UIcon
                    name="i-lucide-triangle-alert"
                    class="size-4 shrink-0 text-warning"
                />
                Cambiar la IP o el puerto reescribe las reglas de corte en todos los routers.
                <template v-if="config.updated_at && !sinGuardar">
                    <span data-prueba="portal-corte-guardado">Guardado el {{ formatearFechaHora(config.updated_at) }}.</span>
                </template>
            </span>
            <template v-if="editable">
                <UButton
                    label="Descartar"
                    color="neutral"
                    variant="ghost"
                    :disabled="sinCambios || enviando"
                    @click="config && rellenar(config)"
                />
                <UButton
                    type="submit"
                    :form="idFormulario"
                    :label="sinGuardar && sinCambios ? 'Guardar estos valores' : cambiaRed ? 'Guardar y actualizar routers' : 'Guardar'"
                    icon="i-lucide-check"
                    :loading="enviando"
                    :disabled="!sinGuardar && sinCambios"
                    class="glow-brand"
                    data-prueba="portal-corte-guardar"
                />
            </template>
        </template>

        <UModal
            v-model:open="confirmar"
            title="¿Actualizar las reglas de corte en todos los routers?"
            description="Cambiaste la IP o el puerto del portal."
        >
            <template #body>
                <div
                    class="flex flex-col gap-2 text-sm"
                    data-prueba="portal-corte-confirmar"
                >
                    <p>Al guardar, Argos reescribe la redirección de los suspendidos en cada router con conexión.</p>
                    <p
                        v-if="pendiente"
                        class="text-muted"
                    >
                        Nuevo destino: <span class="font-mono text-highlighted">{{ pendiente.portal_v4 ?? 'la IP de la dirección pública del portal' }}:{{ pendiente.portal_puerto }}</span><template v-if="pendiente.portal_v6">
                            · IPv6 <span class="font-mono text-highlighted">[{{ pendiente.portal_v6 }}]:{{ pendiente.portal_puerto }}</span>
                        </template>
                    </p>
                </div>
            </template>
            <template #footer>
                <div class="flex w-full flex-wrap justify-end gap-2">
                    <UButton
                        label="Cancelar"
                        :icon="ICONOS.cancelar"
                        color="neutral"
                        variant="ghost"
                        :disabled="enviando"
                        @click="confirmar = false"
                    />
                    <UButton
                        label="Guardar y actualizar routers"
                        icon="i-lucide-refresh-cw"
                        :loading="enviando"
                        data-prueba="portal-corte-confirmar-guardar"
                        @click="pendiente && guardar(pendiente)"
                    />
                </div>
            </template>
        </UModal>
    </ConfiguracionMarco>
</template>
