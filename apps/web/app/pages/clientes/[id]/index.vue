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

const cliente = shallowRef<Cliente | null>(null)
const zona = ref<string | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const servicios = shallowRef<Servicio[]>([])
const cargandoServicios = ref(false)
const problemaServicios = ref<Problem | null>(null)

useHead(() => ({ title: `${cliente.value?.nombre ?? 'Cliente'} · ArgosIsp` }))

const CANALES: Record<Cliente['canal_preferido'], string> = {
    correo: 'Correo',
    telegram: 'Telegram',
    whatsapp: 'WhatsApp',
}

const pestanas = computed<TabsItem[]>(() => {
    const lista: TabsItem[] = [
        { label: 'Datos', value: 'datos', icon: 'i-lucide-id-card' },
        { label: 'Datos fiscales', value: 'fiscal', icon: 'i-lucide-landmark' },
    ]
    if (puede('servicios.ver')) {
        lista.push({ label: 'Servicios', value: 'servicios', icon: 'i-lucide-wifi', badge: servicios.value.length || undefined })
    }
    if (puede('clientes.estado_cuenta')) {
        lista.push({ label: 'Estado de cuenta', value: 'cuenta', icon: 'i-lucide-wallet' })
    }
    if (puede('lealtad.ver')) {
        lista.push({ label: 'Puntos', value: 'puntos', icon: 'i-lucide-gem' })
    }
    if (puede('bitacora.ver')) {
        lista.push({ label: 'Línea de tiempo', value: 'linea', icon: 'i-lucide-history' })
    }
    return lista
})

const pestana = computed<string>({
    get() {
        const valor = typeof route.query.tab === 'string' ? route.query.tab : 'datos'
        return pestanas.value.some(item => item.value === valor) ? valor : 'datos'
    },
    set(valor) {
        void router.replace({ query: { ...route.query, tab: valor === 'datos' ? undefined : valor } })
    },
})

const mapa = computed(() => {
    const coordenadas = cliente.value?.coordenadas?.replace(/\s/g, '')
    return coordenadas ? `https://www.google.com/maps?q=${encodeURIComponent(coordenadas)}` : null
})

/** Cliente importado (Mikrowisp): se muestra discreto junto al número, no como campo. */
const origen = computed(() => (cliente.value ? origenCliente(cliente.value) : null))

const camposPersonalizados = computed(() => Object.entries(cliente.value?.campos_personalizados ?? {})
    .filter(([clave]) => !CAMPOS_DE_IMPORTACION.has(clave))
    .map(([clave, valor]) => ({ clave, valor: typeof valor === 'string' ? valor : JSON.stringify(valor) })))

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
    void cargarZona(resultado.data.zona_id)
    void cargarServicios()
}

watch(clienteId, cargar)
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="cliente"
        :titulo="cliente?.nombre ?? 'Cliente'"
        icono="i-lucide-user"
    >
        <template #acciones>
            <VerEnHorusBoton
                v-if="cliente"
                tipo="cliente"
                :id-externo="cliente.id"
            />
            <UButton
                to="/clientes"
                icon="i-lucide-arrow-left"
                label="Clientes"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <div
            v-if="cargando"
            class="flex flex-col gap-4"
        >
            <USkeleton class="h-8 w-64" />
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-40 w-full" />
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
            class="flex flex-col gap-6"
        >
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="flex flex-col gap-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <h2 class="text-xl font-semibold text-highlighted">
                            {{ cliente.nombre }}
                        </h2>
                        <UBadge
                            :label="cliente.tipo === 'empresa' ? 'Empresa' : 'Persona'"
                            :icon="cliente.tipo === 'empresa' ? 'i-lucide-building-2' : 'i-lucide-user'"
                            color="neutral"
                            variant="outline"
                        />
                    </div>
                    <p
                        v-if="cliente.responsable_pago_id"
                        class="flex items-center gap-1.5 text-sm text-muted"
                    >
                        <UIcon
                            name="i-lucide-hand-coins"
                            class="size-4 shrink-0"
                        />
                        Paga:
                        <ULink
                            :to="`/clientes/${cliente.responsable_pago_id}`"
                            class="text-primary"
                        >
                            {{ cliente.responsable_pago_nombre ?? `Cliente #${cliente.responsable_pago_id}` }}
                        </ULink>
                    </p>
                    <p class="text-sm text-muted">
                        Cliente #{{ cliente.id }}<template v-if="zona">
                            · {{ zona }}
                        </template> · alta {{ formatearFecha(cliente.created_at) }}
                    </p>
                    <p
                        v-if="origen"
                        class="flex items-center gap-1.5 text-xs text-dimmed"
                        data-prueba="cliente-importado"
                    >
                        <UIcon
                            name="i-lucide-import"
                            class="size-3.5 shrink-0"
                        />
                        Importado de {{ origen.sistema }} · id externo <span class="font-mono">{{ origen.idExterno }}</span>
                    </p>
                </div>

                <div class="flex flex-wrap gap-2">
                    <UButton
                        v-if="puede('pagos.registrar')"
                        :to="`/cobro?cliente=${cliente.id}`"
                        icon="i-lucide-hand-coins"
                        label="Cobrar"
                        color="success"
                    />
                    <UButton
                        v-if="puede('servicios.crear')"
                        :to="`/servicios/nuevo?cliente=${cliente.id}`"
                        icon="i-lucide-plus"
                        label="Nuevo servicio"
                        class="glow-brand"
                    />
                    <UButton
                        v-if="puede('facturas.emitir_cargo_unico') && puede('facturas.ver')"
                        icon="i-lucide-receipt"
                        label="Cargo único"
                        color="neutral"
                        variant="outline"
                        data-prueba="abrir-cargo-unico-cliente"
                        @click="cargoAbierto = true"
                    />
                    <UButton
                        v-if="puede('clientes.editar')"
                        :to="`/clientes/${cliente.id}/editar`"
                        icon="i-lucide-pencil"
                        label="Editar"
                        color="neutral"
                        variant="outline"
                    />
                </div>
            </div>

            <UTabs
                v-model="pestana"
                :items="pestanas"
                variant="link"
                :content="false"
                class="w-full"
                :ui="{
                    list: 'overflow-x-auto',
                    trigger: 'shrink-0',
                    label: 'sr-only sm:not-sr-only',
                }"
            />

            <div
                v-if="pestana === 'datos'"
                class="flex flex-col gap-8"
            >
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
                        v-for="campo in camposPersonalizados"
                        :key="campo.clave"
                        :etiqueta="campo.clave"
                        :valor="campo.valor"
                    />
                    <DatoFicha
                        etiqueta="Última edición"
                        :valor="`${formatearFechaHora(cliente.updated_at)} · versión ${cliente.version}`"
                    />
                </dl>

                <ClienteResponsablePago
                    :cliente="cliente"
                    @cambiado="cliente = $event"
                />
            </div>

            <div
                v-else-if="pestana === 'fiscal'"
                class="flex flex-col gap-4"
            >
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
            </div>

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
                />
            </template>

            <ClienteEstadoCuenta
                v-else-if="pestana === 'cuenta'"
                :cliente-id="cliente.id"
                :servicios="servicios"
            />

            <ClientePuntos
                v-else-if="pestana === 'puntos'"
                :cliente-id="cliente.id"
                :cliente-nombre="cliente.nombre"
            />

            <LineaTiempoBitacora
                v-else-if="pestana === 'linea'"
                :filtros="filtrosLinea"
                etiqueta="Línea de tiempo del cliente"
            />
        </div>
        <CargoUnicoModal
            v-if="cliente && puede('facturas.emitir_cargo_unico') && puede('facturas.ver')"
            v-model:open="cargoAbierto"
            :destino="{ cliente, empresaId: empresaActivaId }"
            @hecho="alEmitirCargo"
        />
    </PanelPagina>
</template>
