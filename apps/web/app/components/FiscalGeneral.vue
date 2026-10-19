<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Configuración → Fiscal · General de la empresa activa: país y paquete de localización, régimen
 * de ISR (con su aviso de ley e historial) y banderas de la empresa (sí/no con vigencia). Cada
 * bloque se lee por separado: si uno falla, muestra su error con «Reintentar» y nada inventado.
 */
const props = defineProps<{
    empresaId: number
}>()

const { puede } = usePermisos()
const toast = useToast()

const localizacion = shallowRef<LocalizacionEmpresa | null>(null)
const problemaLocalizacion = ref<Problem | null>(null)
const empresa = shallowRef<EmpresaGrupo | null>(null)
const paises = shallowRef<PaisLocalizacion[]>([])
const problemaEmpresa = ref<Problem | null>(null)
const parametros = shallowRef<ParametroFiscal[] | null>(null)
const problemaParametros = ref<Problem | null>(null)
const historialRegimen = shallowRef<HistorialParametroFiscal | null>(null)
const problemaRegimen = ref<Problem | null>(null)
const cargando = ref(false)
const actualizando = ref(false)

const paisAbierto = ref(false)
const regimenAbierto = ref(false)
const bandera = shallowRef<ParametroFiscal | null>(null)
const propuesto = ref<boolean | null>(null)
const banderaAbierta = ref(false)

const regimen = computed(() => parametros.value?.find(p => p.clave === 'regimen') ?? null)
const regimenActual = computed<RegimenFiscal | null>(() => {
    const valor = regimen.value?.valor
    return typeof valor === 'string' && valor in REGIMENES_FISCALES ? valor as RegimenFiscal : null
})
const banderas = computed(() => (parametros.value ?? []).filter(esBandera))
/** Sin un régimen puesto por un usuario de la empresa: primera configuración (cualquier fecha). */
const primeraConfiguracion = computed(() => !(historialRegimen.value?.valores ?? []).some(v => v.nivel === 'empresa'))
const nombrePais = computed(() => {
    const codigo = empresa.value?.pais ?? localizacion.value?.pais ?? null
    return codigo ? (paises.value.find(p => p.codigo === codigo)?.nombre ?? codigo) : null
})
const instalacion = computed(() => localizacion.value?.instalaciones[0] ?? null)

async function cargarLocalizacion() {
    const resultado = await useLocalizacionFiscal().deEmpresa(props.empresaId)
    localizacion.value = resultado.ok ? resultado.data : null
    problemaLocalizacion.value = resultado.ok ? null : problemaFiscalLegible(resultado.problema)
}

async function cargarEmpresa() {
    if (!puede('empresas.ver')) {
        return
    }
    const [rEmpresa, rPaises] = await Promise.all([useEmpresas().ver(props.empresaId), useEmpresas().paises()])
    empresa.value = rEmpresa.ok ? rEmpresa.data : null
    paises.value = rPaises.ok ? rPaises.data : []
    problemaEmpresa.value = (!rEmpresa.ok ? rEmpresa.problema : null) ?? (!rPaises.ok ? rPaises.problema : null)
}

async function cargarParametros() {
    const resultado = await useParametrosFiscales().listar()
    parametros.value = resultado.ok ? resultado.data.parametros : null
    problemaParametros.value = resultado.ok ? null : problemaFiscalLegible(resultado.problema)
}

async function cargarRegimen() {
    const resultado = await useParametrosFiscales().historial('regimen')
    historialRegimen.value = resultado.ok ? resultado.data : null
    problemaRegimen.value = resultado.ok ? null : problemaFiscalLegible(resultado.problema)
}

async function cargar() {
    // La página ya exige `fiscal.ver`; la guardia deja explícito el permiso de las lecturas.
    if (!puede('fiscal.ver')) {
        return
    }
    cargando.value = true
    await Promise.all([cargarLocalizacion(), cargarEmpresa(), cargarParametros(), cargarRegimen()])
    cargando.value = false
}

async function actualizarPaquete() {
    actualizando.value = true
    const resultado = await useLocalizacionFiscal().actualizar(props.empresaId, nuevaClaveIdempotencia())
    actualizando.value = false
    if (!resultado.ok) {
        const legible = problemaFiscalLegible(resultado.problema)
        toast.add({ title: legible.title, description: legible.detail, color: 'error', icon: 'i-lucide-circle-alert' })
        return
    }
    const r = resultado.data.resumen
    toast.add({
        title: r.ya_instalada ? `${r.codigo} ya estaba instalado` : `Paquete ${r.codigo} instalado`,
        description: r.ya_instalada ? 'No se agregó nada.' : `Se agregaron ${r.cuentas.length} cuentas, ${r.parametros.length} parámetros y ${r.impuestos.length} impuestos.`,
        color: 'success',
        icon: 'i-lucide-package-check',
    })
    void cargar()
}

function cambiarBandera(parametro: ParametroFiscal, valor: boolean) {
    bandera.value = parametro
    propuesto.value = valor
    banderaAbierta.value = true
}

function alGuardarBandera(valor: ValorParametroCreado) {
    toast.add({
        title: `${valor.clave}: ${valor.valor === true ? 'Sí' : 'No'}`,
        description: `Desde ${formatearFecha(valor.vigente_desde)}; lo anterior no cambia.`,
        color: 'success',
        icon: 'i-lucide-check',
    })
    void cargarParametros()
}

function alCambiarRegimen(resultado: RegimenCambiado) {
    toast.add({
        title: `Régimen: ${etiquetaRegimen(resultado.regimen)}`,
        description: `Desde ${formatearFecha(resultado.vigente_desde)}${resultado.aviso_sat ? ` · aviso SAT ${resultado.aviso_sat.numero}` : ''}. Frases: ${resultado.frases.map(f => f.texto).join('; ') || 'ninguna'}.`,
        color: 'success',
        icon: 'i-lucide-scale',
    })
    void Promise.all([cargarParametros(), cargarRegimen()])
}

function alCambiarPais(nueva: EmpresaGrupo) {
    toast.add({ title: `País: ${nueva.pais ?? '—'}`, description: 'La localización fiscal se reinstaló para el país nuevo.', color: 'success', icon: 'i-lucide-globe' })
    void cargar()
}

onMounted(cargar)
</script>

<template>
    <div class="grid gap-4 lg:grid-cols-2">
        <UPageCard
            title="País y paquete"
            description="Paquete de localización fiscal instalado en la empresa."
            icon="i-lucide-globe"
            variant="subtle"
            :ui="{ container: 'lg:flex', wrapper: 'flex-none' }"
        >
            <ProblemaAlerta
                v-if="problemaLocalizacion"
                :problema="problemaLocalizacion"
                :reintentar="cargarLocalizacion"
            />
            <USkeleton
                v-else-if="!localizacion"
                class="h-24 w-full"
            />
            <div
                v-else
                class="flex flex-col gap-4"
            >
                <dl class="grid gap-3 sm:grid-cols-2">
                    <DatoFicha
                        etiqueta="País"
                        :valor="nombrePais"
                    />
                    <DatoFicha
                        etiqueta="Paquete instalado"
                        :valor="localizacion.instalada ? `${localizacion.codigo} (v${localizacion.version})` : 'Sin instalar'"
                        mono
                    />
                    <DatoFicha
                        etiqueta="Instalado"
                        :valor="instalacion ? `${formatearFechaHora(instalacion.instalada_en)}${instalacion.instalada_por_nombre ? ` · ${instalacion.instalada_por_nombre}` : ''}` : null"
                    />
                    <DatoFicha
                        etiqueta="Más reciente"
                        :valor="localizacion.disponible"
                        mono
                    />
                </dl>
                <UAlert
                    v-if="!localizacion.instalada"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-package-x"
                    title="Sin localización fiscal"
                    description="Las operaciones fiscales responden «La empresa no tiene localización fiscal» hasta instalar el paquete."
                />
                <ProblemaAlerta
                    v-if="problemaEmpresa"
                    :problema="problemaEmpresa"
                    :reintentar="cargarEmpresa"
                />
                <div class="flex flex-wrap gap-2">
                    <UButton
                        v-if="puede('fiscal.instalar') && (localizacion.actualizacion_disponible || !localizacion.instalada)"
                        :label="localizacion.instalada ? `Actualizar a ${localizacion.disponible}` : 'Instalar paquete'"
                        icon="i-lucide-package-plus"
                        :loading="actualizando"
                        @click="actualizarPaquete"
                    />
                    <UButton
                        v-if="puede('empresas.cambiar_pais') && empresa"
                        label="Cambiar país"
                        icon="i-lucide-globe"
                        color="neutral"
                        variant="outline"
                        @click="paisAbierto = true"
                    />
                </div>
            </div>
        </UPageCard>

        <UPageCard
            title="Régimen de ISR"
            description="Define los DTE que emite la empresa y las frases del régimen."
            icon="i-lucide-scale"
            variant="subtle"
            :ui="{ container: 'lg:flex', wrapper: 'flex-none' }"
        >
            <ProblemaAlerta
                v-if="problemaParametros"
                :problema="problemaParametros"
                :reintentar="cargarParametros"
            />
            <USkeleton
                v-else-if="!parametros"
                class="h-24 w-full"
            />
            <div
                v-else
                class="flex flex-col gap-4"
            >
                <div
                    class="flex flex-wrap items-center gap-2"
                    data-prueba="regimen-actual"
                >
                    <span class="text-lg font-semibold text-highlighted">{{ etiquetaRegimen(regimen?.valor) }}</span>
                    <UBadge
                        v-if="regimen?.nivel"
                        :label="NIVELES_FISCALES[regimen.nivel].etiqueta"
                        :color="NIVELES_FISCALES[regimen.nivel].color"
                        variant="subtle"
                        size="sm"
                    />
                    <span
                        v-if="regimen?.vigente_desde"
                        class="text-sm text-muted"
                    >desde {{ formatearFecha(regimen.vigente_desde) }}</span>
                </div>
                <p
                    v-if="regimenActual"
                    class="text-sm text-muted"
                >
                    {{ REGIMENES_FISCALES[regimenActual].descripcion }}
                </p>
                <UAlert
                    color="neutral"
                    variant="subtle"
                    icon="i-lucide-info"
                    :description="AVISO_REGIMEN"
                />

                <ProblemaAlerta
                    v-if="problemaRegimen"
                    :problema="problemaRegimen"
                    :reintentar="cargarRegimen"
                />
                <ul
                    v-else-if="historialRegimen"
                    class="flex flex-col divide-y divide-default text-sm"
                    aria-label="Historial del régimen"
                >
                    <li
                        v-for="valor in [...historialRegimen.valores].reverse()"
                        :key="valor.id"
                        class="flex flex-wrap items-center gap-x-2 gap-y-1 py-2"
                    >
                        <span class="w-24 shrink-0 text-muted">{{ formatearFecha(valor.vigente_desde) }}</span>
                        <span class="font-medium text-highlighted">{{ etiquetaRegimen(valor.valor) }}</span>
                        <UBadge
                            :label="NIVELES_FISCALES[valor.nivel].etiqueta"
                            :color="NIVELES_FISCALES[valor.nivel].color"
                            variant="subtle"
                            size="sm"
                        />
                        <span
                            v-if="valor.motivo"
                            class="w-full text-xs text-muted sm:w-auto"
                        >{{ valor.motivo }}</span>
                    </li>
                </ul>

                <div
                    v-if="puede('fiscal.cambiar_regimen') && historialRegimen"
                    class="flex"
                >
                    <UButton
                        :label="primeraConfiguracion ? 'Configurar régimen' : 'Cambiar régimen'"
                        icon="i-lucide-scale"
                        color="neutral"
                        variant="outline"
                        @click="regimenAbierto = true"
                    />
                </div>
            </div>
        </UPageCard>

        <UPageCard
            title="Banderas de la empresa"
            description="Sí/no con vigencia: cambiar una agrega un valor desde una fecha."
            icon="i-lucide-flag"
            variant="subtle"
            :ui="{ container: 'lg:flex', wrapper: 'flex-none' }"
            class="lg:col-span-2"
        >
            <ProblemaAlerta
                v-if="problemaParametros"
                :problema="problemaParametros"
                :reintentar="cargarParametros"
            />
            <USkeleton
                v-else-if="!parametros"
                class="h-24 w-full"
            />
            <ul
                v-else
                class="grid gap-3 md:grid-cols-2"
            >
                <li
                    v-for="p in banderas"
                    :key="p.clave"
                    class="flex items-start justify-between gap-3 rounded-md border border-default p-3"
                    :data-bandera="p.clave"
                >
                    <div class="flex min-w-0 flex-col gap-1">
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span class="font-mono text-sm font-medium text-highlighted">{{ p.clave }}</span>
                            <UBadge
                                v-if="p.pendiente_confirmar"
                                label="Confirmar con contador"
                                icon="i-lucide-user-check"
                                color="warning"
                                variant="subtle"
                                size="sm"
                            />
                        </div>
                        <span class="text-xs text-muted">{{ p.descripcion }}</span>
                        <span class="text-xs text-muted">
                            <template v-if="p.nivel">{{ NIVELES_FISCALES[p.nivel].etiqueta }}</template>
                            <template v-if="p.vigente_desde"> · desde {{ formatearFecha(p.vigente_desde) }}</template>
                            <template v-if="p.valor === null"> · sin valor</template>
                        </span>
                    </div>
                    <USwitch
                        :model-value="p.valor === true"
                        :disabled="!puede('fiscal.editar_parametros') || !p.editable"
                        :aria-label="p.clave"
                        @update:model-value="valor => cambiarBandera(p, valor)"
                    />
                </li>
            </ul>
        </UPageCard>

        <FiscalPaisModal
            v-if="empresa && puede('empresas.cambiar_pais')"
            v-model:open="paisAbierto"
            :empresa="empresa"
            :paises="paises"
            @hecho="alCambiarPais"
        />
        <FiscalRegimenModal
            v-if="puede('fiscal.cambiar_regimen')"
            v-model:open="regimenAbierto"
            :actual="regimenActual"
            :primera="primeraConfiguracion"
            @hecho="alCambiarRegimen"
        />
        <ParametroValorModal
            v-if="puede('fiscal.editar_parametros')"
            v-model:open="banderaAbierta"
            :parametro="bandera"
            :propuesto="propuesto"
            @hecho="alGuardarBandera"
        />
    </div>
</template>
