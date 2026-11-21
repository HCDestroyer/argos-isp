<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TabsItem } from '@nuxt/ui'

definePageMeta({ permiso: 'clientes.ver' })

const route = useRoute()
const router = useRouter()
const { puede } = usePermisos()
const { empresaId: empresaActivaId } = useEmpresaActiva()
const toast = useToast()

/** Cargo único sin servicio (venta de equipo, visita…): de la empresa activa. */
const cargoAbierto = ref(false)

async function alEmitirCargo(resultado: CargoUnicoEmitido) {
    if (resultado.documento === 'bonificacion' && resultado.bonificacion) {
        toast.add({ title: 'Bonificación registrada', description: `Sin costo: ${formatearQuetzales(resultado.bonificacion.bruto)} · ${resultado.bonificacion.motivo_nombre}`, icon: 'i-lucide-hand-heart', color: 'success' })
        await navigateTo(`/bonificaciones/${resultado.bonificacion.id}`)
        return
    }
    if (resultado.factura) {
        toast.add({ title: 'Cargo único emitido', description: `Factura #${resultado.factura.id} por ${formatearQuetzales(resultado.factura.total)}`, icon: 'i-lucide-receipt', color: 'success' })
        await navigateTo(`/facturas/${resultado.factura.id}`)
    }
}

const clienteId = computed(() => Number(route.params.id))

/** Alta de servicio en un panel lateral: no se pierde la ficha. `?nuevo_servicio=1` lo abre al llegar. */
const altaServicioAbierta = ref(route.query.nuevo_servicio === '1')

watch(altaServicioAbierta, (abierta) => {
    if (!abierta && route.query.nuevo_servicio) {
        const { nuevo_servicio: _quitado, ...resto } = route.query
        void router.replace({ query: resto })
    }
})

/** Edición del cliente en un panel lateral: al guardar, la ficha muestra la versión nueva. */
const edicionAbierta = ref(false)
const ediciones = ref(0)

function alEditarCliente(actualizado: Cliente) {
    cliente.value = actualizado
    ediciones.value++
    void cargarZona(actualizado.zona_id)
    toast.add({ title: 'Cambios guardados', description: actualizado.nombre, color: 'success', icon: 'i-lucide-circle-check' })
}

/** Tras una promesa o un cobro: se vuelven a leer cuenta y servicios (el estado pudo cambiar). */
function alCambiarCuenta() {
    void cargarCuenta()
    void cargarServicios()
}

async function alCrearServicio() {
    pestana.value = 'servicios'
    await cargarServicios()
}

const cliente = shallowRef<Cliente | null>(null)
const zona = ref<string | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const servicios = shallowRef<Servicio[]>([])
/** `null` mientras no se leyeron (la franja no muestra «0 servicios» sin haberlos leído). */
const serviciosLeidos = ref(false)
const cargandoServicios = ref(false)
const problemaServicios = ref<Problem | null>(null)

useHead(() => ({ title: `${cliente.value?.nombre ?? 'Cliente'} · ArgosIsp` }))

const CANALES: Record<Cliente['canal_preferido'], string> = {
    correo: 'Correo',
    telegram: 'Telegram',
    whatsapp: 'WhatsApp',
}

/*
 * Pestañas segmentadas dentro de la tarjeta (tablero NuevoClienteFicha). Los datos del cliente y
 * los fiscales se abren con el ícono de persona de la franja (`?datos=1`). Contactos con la API de
 * A1 (#281); Soporte y Documentos esperan su API (`.claude/integration/a4.md`): muestran qué falta, sin datos inventados.
 * Ids viejos de la URL: `datos`/`fiscal` abren los datos y `linea` es la bitácora.
 */
const pestanas = computed<TabsItem[]>(() => {
    const lista: TabsItem[] = [{ label: 'Resumen', value: 'resumen', icon: 'i-lucide-house' }]
    if (puede('servicios.ver')) {
        lista.push({ label: 'Servicios', value: 'servicios', icon: 'i-lucide-wifi' })
    }
    if (puede('contactos.buscar')) {
        lista.push({ label: 'Contactos', value: 'contactos', icon: 'i-lucide-user-plus', badge: cantidadContactos.value ? { label: String(cantidadContactos.value), color: 'neutral', variant: 'subtle' } : undefined })
    }
    if (puede('clientes.estado_cuenta')) {
        const vencidas = resumenCuentaCliente(cuenta.value)?.vencidas
        lista.push({ label: 'Facturación', value: 'cuenta', icon: 'i-lucide-receipt', badge: vencidas ? { label: String(vencidas), color: 'error', variant: 'subtle' } : undefined })
    }
    if (puede('pagos.ver')) {
        lista.push({ label: 'Pagos', value: 'pagos', icon: ICONOS.cobrar })
    }
    if (puede('promesas.ver')) {
        lista.push({ label: 'Promesas', value: 'promesas', icon: 'i-lucide-hand' })
    }
    if (puede('lealtad.ver')) {
        lista.push({ label: 'Puntos', value: 'puntos', icon: 'i-lucide-gem' })
    }
    lista.push({ label: 'Soporte', value: 'soporte', icon: 'i-lucide-ticket' })
    lista.push({ label: 'Documentos', value: 'documentos', icon: 'i-lucide-file-text' })
    if (puede('bitacora.ver')) {
        lista.push({ label: 'Bitácora', value: 'bitacora', icon: 'i-lucide-history' })
    }
    return lista
})

const ALIAS_PESTANA: Record<string, string> = { linea: 'bitacora', datos: 'resumen', fiscal: 'resumen' }

const pestana = computed<string>({
    get() {
        const crudo = typeof route.query.tab === 'string' ? route.query.tab : 'resumen'
        const valor = ALIAS_PESTANA[crudo] ?? crudo
        return pestanas.value.some(item => item.value === valor) ? valor : 'resumen'
    },
    set(valor) {
        void router.replace({ query: { ...route.query, tab: valor === 'resumen' ? undefined : valor } })
    },
})

/** Datos del cliente y fiscales: se abren con el ícono de persona de la franja. */
const datosAbiertos = computed<boolean>({
    get: () => route.query.datos === '1' || route.query.tab === 'datos' || route.query.tab === 'fiscal',
    set(abiertos) {
        const { datos: _datos, ...resto } = route.query
        const tab = resto.tab === 'datos' || resto.tab === 'fiscal' ? undefined : resto.tab
        void router.replace({ query: { ...resto, tab, ...(abiertos ? { datos: '1' } : {}) } })
    },
})

/** Contactos que no son el titular, para el número de la pestaña (A1, #281). */
const cantidadContactos = ref<number | null>(null)

async function cargarContactos() {
    cantidadContactos.value = null
    if (!puede('contactos.buscar')) {
        return
    }
    const resultado = await useContactos().listar(clienteId.value)
    cantidadContactos.value = resultado.ok ? resultado.data.data.filter(c => !c.es_titular).length : null
}

/** Estado de cuenta para la franja, el resumen y el número de Facturación. */
const cuenta = shallowRef<EstadoCuenta | null>(null)
const problemaCuenta = ref<Problem | null>(null)

async function cargarCuenta() {
    cuenta.value = null
    problemaCuenta.value = null
    if (!puede('clientes.estado_cuenta')) {
        return
    }
    const resultado = await useClientes().estadoCuenta(clienteId.value)
    cuenta.value = resultado.ok ? resultado.data : null
    problemaCuenta.value = resultado.ok ? null : resultado.problema
}

/** Franja compacta al bajar: un centinela arriba de la franja deja de verse. */
const centinela = useTemplateRef<HTMLElement>('centinela')
const compacta = ref(false)
let observador: IntersectionObserver | null = null

watch(centinela, (elemento) => {
    observador?.disconnect()
    if (elemento && typeof IntersectionObserver !== 'undefined') {
        observador = new IntersectionObserver(([entrada]) => {
            compacta.value = entrada ? !entrada.isIntersecting : false
        })
        observador.observe(elemento)
    }
})
onBeforeUnmount(() => observador?.disconnect())

const resumenCuenta = computed(() => resumenCuentaCliente(cuenta.value))

function abrirEdicion() {
    edicionAbierta.value = true
}

function irACuenta() {
    pestana.value = 'cuenta'
}

/** Más acciones de la franja (⋯). */
const masAcciones = computed(() => {
    const grupo = []
    if (puede('clientes.editar')) {
        grupo.push({ label: 'Editar datos del cliente', icon: ICONOS.editar, onSelect: abrirEdicion })
    }
    if (puede('clientes.estado_cuenta')) {
        grupo.push({ label: 'Estado de cuenta', icon: 'i-lucide-receipt-text', onSelect: irACuenta })
    }
    return [grupo]
})

const mapa = computed(() => {
    const coordenadas = cliente.value?.coordenadas?.replace(/\s/g, '')
    return coordenadas ? `https://www.google.com/maps?q=${encodeURIComponent(coordenadas)}` : null
})

/** Cliente importado (Mikrowisp): se muestra discreto junto al número, no como campo. */
const origen = computed(() => (cliente.value ? origenExterno(cliente.value) : null))

/** Catálogo de campos personalizados (A1): etiqueta, tipo y orden de cada dato extra. */
const catalogoCampos = shallowRef<CampoPersonalizado[] | null>(null)
const problemaCatalogo = ref<Problem | null>(null)
const cargandoCatalogo = ref(false)

async function cargarCatalogo() {
    cargandoCatalogo.value = true
    problemaCatalogo.value = null
    const resultado = await useCamposPersonalizados().listar()
    cargandoCatalogo.value = false
    catalogoCampos.value = resultado.ok ? resultado.data : null
    problemaCatalogo.value = resultado.ok ? null : resultado.problema
}

/**
 * Los campos activos del catálogo en su orden, con su etiqueta (vacíos con «—»); después los
 * valores guardados que el catálogo no tiene activos (campo desactivado: su etiqueta; clave
 * desconocida: la clave), sin repetir los del importador. Sin catálogo, solo los guardados por clave.
 */
const camposPersonalizados = computed(() => {
    if (!catalogoCampos.value && !problemaCatalogo.value) {
        // mientras carga el catálogo: sin etiquetas todavía, no se pintan claves técnicas
        return []
    }
    const valores = cliente.value?.campos_personalizados ?? {}
    const catalogo = catalogoCampos.value ?? []
    const activos = catalogo.filter(campo => campo.activo)
    const lista = activos.map(campo => ({ clave: campo.clave, etiqueta: campo.etiqueta, valor: valorCampoLegible(campo, valores[campo.clave]) }))
    for (const [clave, valor] of Object.entries(valores)) {
        if (CAMPOS_DE_IMPORTACION.has(clave) || activos.some(campo => campo.clave === clave)) {
            continue
        }
        const campo = catalogo.find(c => c.clave === clave) ?? null
        lista.push({ clave, etiqueta: campo?.etiqueta ?? clave, valor: valorCampoLegible(campo, valor) })
    }
    return lista
})

/**
 * La API junta el cliente y sus servicios, facturas, pagos y promesas (`cliente_id`); las
 * lecturas del portal (cada visita a la página de corte) no cuentan la historia del cliente.
 */
const filtrosLinea = computed<FiltrosAcciones>(() => ({ cliente_id: clienteId.value, excluir_canal: 'portal' }))

const consumidorFinal = computed(() => cliente.value?.tipo_documento_fiscal === 'cf' || cliente.value?.nit_cui?.toUpperCase() === 'CF')
/** Tipo de documento (A1 lo envía siempre; clientes de fixtures viejos: se deduce del número). */
const tipoDocumento = computed(() => cliente.value?.tipo_documento_fiscal ?? deducirTipoDocumento(cliente.value?.nit_cui))

async function cargarServicios() {
    if (!puede('servicios.ver')) {
        return
    }
    cargandoServicios.value = true
    const resultado = await useServicios().listar({ cliente_id: clienteId.value, limit: 200 })
    cargandoServicios.value = false
    servicios.value = resultado.ok ? resultado.data.data : []
    serviciosLeidos.value = resultado.ok
    problemaServicios.value = resultado.ok ? null : resultado.problema
}

async function cargarZona(id: number | null) {
    zona.value = null
    if (id === null || !puede('zonas.ver')) {
        return
    }
    const resultado = await useZonas().listar()
    if (resultado.ok) {
        zona.value = resultado.data.find(z => z.id === id)?.nombre ?? null
    }
}

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useClientes().ver(clienteId.value)
    cargando.value = false
    if (!resultado.ok) {
        problema.value = resultado.problema
        return
    }
    cliente.value = resultado.data
    void cargarCatalogo()
    void cargarZona(resultado.data.zona_id)
    void cargarServicios()
    void cargarCuenta()
    void cargarContactos()
}

watch(clienteId, cargar)
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="cliente"
        :titulo="cliente?.nombre ?? 'Cliente'"
        icono="i-lucide-user"
        encabezado-propio
    >
        <div
            v-if="cargando"
            class="flex flex-col gap-4"
        >
            <USkeleton class="h-24 w-full rounded-[1.375rem]" />
            <USkeleton class="h-80 w-full rounded-[1.375rem]" />
        </div>

        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-user-x"
            title="Cliente no encontrado"
            :description="`No existe un cliente con id ${route.params.id}.`"
            :actions="[{ label: 'Volver a clientes', to: '/clientes', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />

        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
        />

        <div
            v-else-if="cliente"
            class="flex flex-col gap-4 pb-20 sm:pb-0"
        >
            <div
                ref="centinela"
                class="-mb-4 h-px"
                aria-hidden="true"
            />
            <!-- Franja del cliente: fija arriba al bajar y se reduce a nombre, estado, saldo y Cobrar. -->
            <div class="sticky top-0 z-10 -mt-px">
                <ClienteFranja
                    :cliente="cliente"
                    :servicios="serviciosLeidos ? servicios : null"
                    :cuenta="cuenta"
                    :problema-cuenta="problemaCuenta"
                    :zona="zona"
                    :compacta="compacta"
                    :ver-cuenta="puede('clientes.estado_cuenta')"
                >
                    <template #meta>
                        <p
                            v-if="origen"
                            class="flex items-center gap-1.5 text-xs text-dimmed"
                            data-prueba="cliente-importado"
                        >
                            <UIcon
                                name="i-lucide-import"
                                class="size-3.5 shrink-0"
                            />
                            {{ textoImportado(origen) }}
                        </p>
                        <p
                            v-if="cliente.responsable_pago_id"
                            class="flex items-center gap-1.5 text-xs text-muted"
                        >
                            <UIcon
                                name="i-lucide-hand-coins"
                                class="size-3.5 shrink-0"
                            />
                            Paga:
                            <ULink
                                :to="`/clientes/${cliente.responsable_pago_id}`"
                                class="text-primary"
                            >
                                {{ cliente.responsable_pago_nombre ?? `Cliente #${cliente.responsable_pago_id}` }}
                            </ULink>
                        </p>
                    </template>
                    <template #acciones>
                        <PromesaServicioBoton
                            v-if="!compacta"
                            :servicios="serviciosLeidos ? servicios : null"
                            solo-icono
                            @creada="alCambiarCuenta"
                        />
                        <UButton
                            v-if="!compacta && puede('facturas.emitir_cargo_unico') && puede('facturas.ver')"
                            icon="i-lucide-receipt"
                            color="neutral"
                            variant="ghost"
                            class="boton-flotante boton-circulo"
                            title="Cargo único"
                            aria-label="Cargo único"
                            data-prueba="abrir-cargo-unico-cliente"
                            @click="cargoAbierto = true"
                        />
                        <UButton
                            v-if="!compacta && puede('servicios.crear')"
                            icon="i-lucide-plus"
                            color="neutral"
                            variant="ghost"
                            class="boton-flotante boton-circulo"
                            title="Nuevo servicio"
                            aria-label="Nuevo servicio"
                            data-prueba="nuevo-servicio-cliente"
                            @click="altaServicioAbierta = true"
                        />
                        <UButton
                            v-if="!compacta"
                            icon="i-lucide-user"
                            color="neutral"
                            variant="ghost"
                            class="boton-flotante boton-circulo"
                            :class="datosAbiertos ? 'bg-primary/10 text-primary' : ''"
                            :aria-pressed="datosAbiertos"
                            :aria-controls="datosAbiertos ? 'datos-cliente' : undefined"
                            title="Datos del cliente"
                            aria-label="Datos del cliente"
                            data-prueba="ver-datos-cliente"
                            @click="datosAbiertos = !datosAbiertos"
                        />
                        <UDropdownMenu
                            v-if="!compacta"
                            :items="masAcciones"
                            :content="{ align: 'end' }"
                        >
                            <UButton
                                icon="i-lucide-ellipsis"
                                color="neutral"
                                variant="ghost"
                                class="boton-flotante boton-circulo"
                                title="Más acciones"
                                aria-label="Más acciones del cliente"
                            />
                        </UDropdownMenu>
                    </template>
                </ClienteFranja>
            </div>

            <!-- Teléfono: las mismas acciones de la franja, en fila. -->
            <div class="flex flex-wrap gap-2 sm:hidden">
                <UButton
                    v-if="puede('servicios.crear')"
                    icon="i-lucide-plus"
                    label="Nuevo servicio"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    class="rounded-full"
                    @click="altaServicioAbierta = true"
                />
                <UButton
                    icon="i-lucide-user"
                    label="Datos"
                    color="neutral"
                    :variant="datosAbiertos ? 'subtle' : 'outline'"
                    size="sm"
                    class="rounded-full"
                    :aria-pressed="datosAbiertos"
                    data-prueba="ver-datos-cliente-movil"
                    @click="datosAbiertos = !datosAbiertos"
                />
                <UButton
                    v-if="puede('facturas.emitir_cargo_unico') && puede('facturas.ver')"
                    icon="i-lucide-receipt"
                    label="Cargo único"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    class="rounded-full"
                    @click="cargoAbierto = true"
                />
            </div>

            <!-- Datos del cliente y fiscales (ícono de persona). -->
            <section
                v-if="datosAbiertos"
                id="datos-cliente"
                class="flex flex-col gap-4"
                aria-label="Datos del cliente"
                data-prueba="datos-cliente"
            >
                <div class="flex items-center justify-between gap-2">
                    <h2 class="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                        Datos del cliente
                    </h2>
                    <UButton
                        v-if="puede('clientes.editar')"
                        icon="i-lucide-pencil"
                        label="Editar"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        class="rounded-full"
                        data-prueba="editar-cliente"
                        @click="edicionAbierta = true"
                    />
                </div>
                <dl class="surface-card grid gap-x-8 gap-y-5 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
                    <DatoFicha
                        etiqueta="Teléfono"
                        :valor="cliente.telefono"
                    />
                    <DatoFicha
                        etiqueta="Móvil"
                        :valor="cliente.movil"
                    />
                    <DatoFicha
                        etiqueta="Correo"
                        :valor="cliente.email"
                    />
                    <DatoFicha
                        etiqueta="Canal preferido"
                        :valor="CANALES[cliente.canal_preferido]"
                    />
                    <DatoFicha etiqueta="Telegram">
                        <ClienteTelegram
                            :cliente="cliente"
                            @cambiado="c => cliente = c"
                        />
                    </DatoFicha>
                    <DatoFicha
                        etiqueta="Zona"
                        :valor="zona ?? (cliente.zona_id ? `Zona #${cliente.zona_id}` : null)"
                    />
                    <DatoFicha
                        etiqueta="Dirección"
                        :valor="cliente.direccion"
                        class="sm:col-span-2"
                    />
                    <DatoFicha
                        etiqueta="Coordenadas"
                        :valor="cliente.coordenadas"
                        mono
                    >
                        <ULink
                            v-if="mapa"
                            :to="mapa"
                            target="_blank"
                            class="inline-flex items-center gap-1 text-primary"
                        >
                            {{ cliente.coordenadas }}
                            <UIcon
                                name="i-lucide-external-link"
                                class="size-3.5"
                            />
                        </ULink>
                    </DatoFicha>
                    <DatoFicha
                        etiqueta="Referencia"
                        :valor="cliente.referencia ?? null"
                        class="whitespace-pre-line sm:col-span-2 lg:col-span-3"
                        data-prueba="referencia-cliente"
                    />
                    <DatoFicha
                        v-for="campo in camposPersonalizados"
                        :key="campo.clave"
                        :etiqueta="campo.etiqueta"
                        :valor="campo.valor"
                        :data-prueba="`dato-campo-${campo.clave}`"
                    />
                    <DatoFicha
                        etiqueta="Última edición"
                        :valor="`${formatearFechaHora(cliente.updated_at)} · versión ${cliente.version}`"
                    />
                </dl>
                <!-- Tras cada edición (que pudo cambiar la casilla de WhatsApp) se vuelve a leer. -->
                <ClienteWhatsapp
                    v-if="puede('notificaciones.ver')"
                    :key="`${cliente.id}-${ediciones}`"
                    :cliente-id="cliente.id"
                />
                <ClientePortal :cliente-id="cliente.id" />
                <ProblemaAlerta
                    v-if="problemaCatalogo"
                    :problema="problemaCatalogo"
                    :reintentar="cargarCatalogo"
                    :reintentando="cargandoCatalogo"
                />

                <ClienteResponsablePago
                    :cliente="cliente"
                    @cambiado="cliente = $event"
                />
                <h2 class="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                    Datos fiscales
                </h2>
                <UAlert
                    v-if="cliente.nit_cui_invalido"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-badge-alert"
                    title="NIT o CUI por corregir"
                    description="El número no pasó la validación al activar la localización fiscal (se conservó tal cual). Corrígelo en «Editar»: la factura FEL lo exige válido."
                    data-prueba="nit-invalido"
                />
                <UAlert
                    v-else-if="consumidorFinal || !cliente.nit_cui"
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-info"
                    :title="consumidorFinal ? 'Consumidor final' : 'Sin NIT registrado'"
                    description="Los avisos de cobro salen a nombre de Consumidor Final (CF)."
                />
                <dl class="surface-card grid gap-x-8 gap-y-5 p-4 sm:grid-cols-2 sm:p-6">
                    <DatoFicha
                        :etiqueta="tipoDocumento ? TIPOS_DOCUMENTO_FISCAL[tipoDocumento] : 'Documento'"
                        :valor="consumidorFinal ? 'CF' : formatearDocumento(tipoDocumento, cliente.nit_cui)"
                        mono
                    />
                    <DatoFicha
                        etiqueta="País"
                        :valor="cliente.pais_fiscal ?? 'GT'"
                        mono
                    />
                    <DatoFicha
                        etiqueta="Retención y sector"
                        :valor="[cliente.agente_retencion_iva ? 'Agente de retención de IVA' : null, cliente.sector_publico ? 'Sector público' : null].filter(Boolean).join(' · ') || 'Ninguno'"
                    />
                    <DatoFicha
                        etiqueta="Nombre fiscal"
                        :valor="cliente.nombre_fiscal"
                    />
                    <DatoFicha
                        etiqueta="Dirección fiscal"
                        :valor="cliente.direccion_fiscal"
                        class="sm:col-span-2"
                    />
                </dl>
            </section>

            <!-- Pestañas segmentadas dentro de la misma tarjeta que su contenido. -->
            <section class="surface-card flex min-w-0 flex-col rounded-[1.375rem]">
                <div class="border-b border-(--ax-borde) p-3 sm:p-4">
                    <UTabs
                        v-model="pestana"
                        :items="pestanas"
                        variant="pill"
                        color="neutral"
                        :content="false"
                        class="w-full"
                        :ui="{
                            list: 'w-auto max-w-full justify-start self-start overflow-x-auto rounded-xl bg-(--ax-panel) p-1',
                            indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
                            trigger: 'shrink-0 grow-0 rounded-lg px-3 text-muted data-[state=active]:text-primary',
                            leadingIcon: 'size-4',
                        }"
                        data-prueba="pestanas-cliente"
                    />
                </div>

                <div class="flex min-w-0 flex-col gap-4 p-3 sm:p-5">
                    <ClienteResumen
                        v-if="pestana === 'resumen'"
                        :cliente="cliente"
                        :servicios="serviciosLeidos ? servicios : null"
                        :problema-servicios="problemaServicios"
                        :cuenta="cuenta"
                        :problema-cuenta="problemaCuenta"
                        @ir="pestana = $event"
                        @promesa="pestana = 'servicios'"
                        @reintentar-servicios="cargarServicios"
                        @reintentar-cuenta="cargarCuenta"
                    />

                    <template v-else-if="pestana === 'servicios'">
                        <ProblemaAlerta
                            v-if="problemaServicios"
                            :problema="problemaServicios"
                            :reintentar="cargarServicios"
                            :reintentando="cargandoServicios"
                        />
                        <ClienteServicios
                            v-else
                            :servicios="servicios"
                            :cargando="cargandoServicios"
                            :puede-agregar="puede('servicios.crear')"
                            @agregar="altaServicioAbierta = true"
                        />
                    </template>

                    <ClienteContactos
                        v-else-if="pestana === 'contactos'"
                        :cliente-id="cliente.id"
                        :servicios="serviciosLeidos ? servicios : null"
                        @cambiados="cantidadContactos = $event"
                    />

                    <ClienteEstadoCuenta
                        v-else-if="pestana === 'cuenta'"
                        :cliente-id="cliente.id"
                        :servicios="servicios"
                    />

                    <ClientePagos
                        v-else-if="pestana === 'pagos'"
                        :cliente-id="cliente.id"
                    />

                    <ClientePromesas
                        v-else-if="pestana === 'promesas'"
                        :cliente-id="cliente.id"
                        :servicios="serviciosLeidos ? servicios : null"
                    />

                    <ClientePuntos
                        v-else-if="pestana === 'puntos'"
                        :cliente-id="cliente.id"
                        :cliente-nombre="cliente.nombre"
                    />

                    <SeccionSinApi
                        v-else-if="pestana === 'soporte'"
                        icono="i-lucide-ticket"
                        titulo="Soporte"
                        descripcion="Los tickets de Iris de este cliente se muestran aquí en cuanto la API los entregue."
                    />

                    <SeccionSinApi
                        v-else-if="pestana === 'documentos'"
                        icono="i-lucide-file-text"
                        titulo="Documentos"
                        descripcion="Los documentos del cliente (DPI, contrato) se muestran aquí en cuanto la API los entregue."
                    />

                    <LineaTiempoBitacora
                        v-else-if="pestana === 'bitacora'"
                        :filtros="filtrosLinea"
                        etiqueta="Bitácora del cliente"
                    />
                </div>
            </section>

            <!-- Teléfono: la acción principal fija abajo (Promesa y «Cobrar Q …»). -->
            <div
                class="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-(--ax-borde) bg-(--ax-tarjeta) p-3 sm:hidden"
                data-prueba="barra-cobro-cliente"
            >
                <PromesaServicioBoton
                    :servicios="serviciosLeidos ? servicios : null"
                    :boton="{ size: 'lg', class: 'rounded-full' }"
                    @creada="alCambiarCuenta"
                />
                <UButton
                    v-if="puede('pagos.registrar')"
                    :to="`/cobro?cliente=${cliente.id}`"
                    :icon="ICONOS.cobrar"
                    :label="resumenCuenta?.debe ? `Cobrar ${formatearQuetzales(resumenCuenta.saldo)}` : 'Cobrar'"
                    color="success"
                    size="lg"
                    block
                    class="flex-1 rounded-full"
                />
            </div>
        </div>
        <ClienteSlideover
            v-if="cliente && puede('clientes.editar')"
            v-model:open="edicionAbierta"
            :cliente="cliente"
            @guardado="alEditarCliente"
        />
        <ServicioAltaSlideover
            v-if="cliente && puede('servicios.crear')"
            v-model:open="altaServicioAbierta"
            :cliente="cliente"
            @creado="alCrearServicio"
        />
        <CargoUnicoModal
            v-if="cliente && puede('facturas.emitir_cargo_unico') && puede('facturas.ver')"
            v-model:open="cargoAbierto"
            :destino="{ cliente, empresaId: empresaActivaId }"
            @hecho="alEmitirCargo"
        />
    </PanelPagina>
</template>
