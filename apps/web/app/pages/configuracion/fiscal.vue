<script setup lang="ts">
/**
 * Configuración › Empresa y fiscal › Régimen e impuestos (tablero OperConfigEmpresa, pestaña
 * «Régimen e impuestos»; localización GT, `contratos/localizacion-fiscal.md` §11 y §14): país,
 * régimen y banderas, establecimientos, frases, parámetros con vigencia e impuestos de la empresa
 * de las pastillas, cada uno en su bloque dentro de la tarjeta, más el aviso de pequeño
 * contribuyente del panel financiero (decisión 12; antes en Configuración › Reportes). Los feriados
 * son globales (todas las empresas). `?pestana=` (enlaces desde el calendario fiscal y el
 * comparador) lleva a su bloque.
 */
definePageMeta({ permiso: 'fiscal.ver' })

useHead({ title: 'Régimen e impuestos · ArgosIsp' })

const route = useRoute()
const { puede } = usePermisos()
const { empresaId, conSelector } = useEmpresaActiva()
/** Los umbrales del aviso son el parámetro `pc_alertas`: al guardarlos se relee el historial. */
const umbralesGuardados = ref(0)

const BLOQUES = ['general', 'establecimientos', 'frases', 'parametros', 'aviso-pc', 'impuestos', 'feriados'] as const

onMounted(() => {
    const valor = route.query.pestana
    const bloque = BLOQUES.find(b => b === valor)
    if (bloque && bloque !== 'general') {
        void nextTick(() => document.getElementById(`fiscal-${bloque}`)?.scrollIntoView({ block: 'start' }))
    }
})
</script>

<template>
    <ConfiguracionMarco
        id="configuracion-fiscal"
        empresas
    >
        <UAlert
            v-if="empresaId === null"
            color="info"
            variant="subtle"
            icon="i-lucide-building-2"
            title="Elige una empresa"
            :description="conSelector ? 'La configuración fiscal es de cada empresa (NIT): elige una en las pastillas de arriba. Los feriados, abajo, valen para todas.' : 'No hay una empresa activa en tu sesión.'"
            data-prueba="elegir-empresa"
        />
        <template v-else>
            <p class="text-sm text-muted">
                Lo que cambia aquí rige desde la fecha que indiques y nunca reescribe lo ya emitido.
            </p>
            <FiscalGeneral
                id="fiscal-general"
                :key="`general-${empresaId}`"
                :empresa-id="empresaId"
            />
            <div class="grid gap-4 2xl:grid-cols-2">
                <ConfiguracionBloque
                    id="fiscal-establecimientos"
                    titulo="Establecimientos"
                    icono="i-lucide-map-pin"
                >
                    <FiscalEstablecimientos :key="`est-${empresaId}`" />
                </ConfiguracionBloque>
                <ConfiguracionBloque
                    id="fiscal-frases"
                    titulo="Frases de la factura"
                    icono="i-lucide-file-text"
                >
                    <FiscalFrases :key="`frases-${empresaId}`" />
                </ConfiguracionBloque>
            </div>
            <ConfiguracionBloque
                id="fiscal-parametros"
                titulo="Parámetros con historial"
                icono="i-lucide-history"
            >
                <FiscalParametros :key="`param-${empresaId}-${umbralesGuardados}`" />
                <template #pie>
                    Un cambio de ley se registra con su fecha; lo anterior no se reescribe.
                </template>
            </ConfiguracionBloque>
            <ConfiguracionBloque
                v-if="puede('panel_financiero.ver')"
                id="fiscal-aviso-pc"
                titulo="Aviso de pequeño contribuyente"
                icono="i-lucide-gauge"
                data-prueba="bloque-aviso-pc"
            >
                <FiscalAvisoPc
                    :key="`aviso-pc-${empresaId}`"
                    @umbrales-guardados="umbralesGuardados++"
                />
            </ConfiguracionBloque>
            <ConfiguracionBloque
                id="fiscal-impuestos"
                titulo="Impuestos"
                icono="i-lucide-percent"
            >
                <FiscalImpuestos :key="`imp-${empresaId}`" />
            </ConfiguracionBloque>
        </template>
        <ConfiguracionBloque
            id="fiscal-feriados"
            titulo="Feriados"
            icono="i-lucide-flag"
            descripcion="Días inhábiles para los plazos fiscales de toda la instalación: valen para todas las empresas."
        >
            <FiscalFeriados />
        </ConfiguracionBloque>
    </ConfiguracionMarco>
</template>
