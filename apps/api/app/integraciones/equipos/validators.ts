import vine from '@vinejs/vine'
import { idEntidad, instanteIso } from '#shared/validadores'

/**
 * Validadores de equipos (contrato Iris 0.9.0 §12) y del reenvío de la bienvenida (§12.5). Los
 * largos del SSID y la clave los revisa la acción (`422 wifi_invalido`, como pide el contrato).
 */

const textoCorto = (max: number) => vine.string().trim().maxLength(max)
const ssid = () => vine.string().maxLength(200).nullable().optional().meta({ description: 'SSID, 1 a 32' })
const clave = () =>
    vine
        .string()
        .maxLength(200)
        .nullable()
        .optional()
        .meta({ description: 'Clave WPA2, 8 a 63. Nunca vuelve en respuestas, eventos ni auditoría' })

export const aprovisionarValidator = vine.compile(
    vine.object({
        equipo: vine.object({
            tipo: vine.enum(['ont', 'cpe_wireless', 'router_tr069'] as const),
            serie: textoCorto(64).nullable().optional(),
            mac: textoCorto(32).nullable().optional(),
            unidad_id: idEntidad().nullable().optional(),
            modelo: textoCorto(100).nullable().optional(),
        }),
        planta: vine
            .object({
                olt: textoCorto(100).nullable().optional(),
                slot: vine.number().withoutDecimals().min(0).nullable().optional(),
                pon: vine.number().withoutDecimals().min(0).nullable().optional(),
                caja: textoCorto(100).nullable().optional(),
                puerto: vine.number().withoutDecimals().min(0).nullable().optional(),
            })
            .nullable()
            .optional(),
        wireless: vine
            .object({
                ap: textoCorto(100).nullable().optional(),
                sector: textoCorto(100).nullable().optional(),
            })
            .nullable()
            .optional(),
        wifi: vine.object({ ssid: ssid(), clave: clave() }).nullable().optional(),
        tecnico: vine
            .object({ id_externo: textoCorto(100).minLength(1) })
            .nullable()
            .optional(),
        origen_tipo: vine
            .enum(['iris_orden'] as const)
            .nullable()
            .optional(),
        origen_id: textoCorto(100).minLength(1).nullable().optional(),
    }),
)

export const cambiarWifiValidator = vine.compile(
    vine.object({
        ssid: ssid(),
        clave: clave(),
        origen_tipo: vine.enum(['iris_orden', 'iris_ticket', 'iris_conversacion'] as const),
        origen_id: textoCorto(100).minLength(1),
        verificacion: vine
            .object({
                metodo: textoCorto(40).minLength(1).meta({
                    description:
                        '`codigo_telefono`, `codigo_correo` o `datos_titular`; una persona además `presencial` o `llamada_verificada`',
                }),
                verificado_en: instanteIso(),
                cliente_id: idEntidad(),
            })
            .nullable()
            .optional(),
    }),
)

export const reenviarBienvenidaValidator = vine.compile(
    vine.object({
        origen_tipo: vine
            .enum(['iris_orden'] as const)
            .nullable()
            .optional(),
        origen_id: textoCorto(100).minLength(1).nullable().optional(),
        canales: vine
            .array(vine.enum(['whatsapp', 'correo', 'telegram'] as const))
            .minLength(1)
            .maxLength(3)
            .nullable()
            .optional()
            .meta({ description: 'Sin él, todos los canales que Argos tenga configurados' }),
    }),
)

const url = () => vine.string().trim().maxLength(500).nullable().optional()
const secreto = () =>
    vine
        .string()
        .maxLength(500)
        .nullable()
        .optional()
        .meta({ description: 'Omitido: se conserva; null: se borra; texto: se reemplaza. Nunca vuelve' })

export const configurarEquiposValidator = vine.compile(
    vine.object({
        version: vine.number().withoutDecimals().min(0),
        activo: vine.boolean().optional(),
        smartolt_url: url().meta({ description: '`https://<subdominio>.smartolt.com`' }),
        smartolt_token: secreto(),
        genieacs_url: url().meta({ description: 'URL del NBI de GenieACS (o del proxy que lo protege)' }),
        genieacs_usuario: vine.string().trim().maxLength(200).nullable().optional(),
        genieacs_clave: secreto(),
        genieacs_ca: vine
            .string()
            .trim()
            .maxLength(20_000)
            .nullable()
            .optional()
            .meta({ description: 'Certificado raíz propio del proxy HTTPS del NBI (PEM); null lo borra' }),
        pppoe_por_acs: vine.boolean().optional().meta({
            description: 'Configurar usuario y clave PPPoE en el equipo por TR-069 al aprovisionar',
        }),
        perfiles: vine
            .array(
                vine.object({
                    smartolt_olt_id: vine.string().trim().minLength(1).maxLength(50),
                    plan_id: idEntidad().nullable().optional(),
                    authorization_preset_id: vine.number().withoutDecimals().min(1),
                    pon_type: vine
                        .enum(['gpon', 'epon'] as const)
                        .nullable()
                        .optional(),
                }),
            )
            .maxLength(500)
            .optional()
            .meta({
                description:
                    'Reemplaza todos los perfiles: OLT de SmartOLT + plan (null = cualquiera) → preset',
            }),
    }),
)

/** `PUT /integraciones/acs` (`contratos/equipos-olt-acs.md` §5.1). */
export const configurarAcsValidator = vine.compile(
    vine.object({
        version: vine.number().withoutDecimals().min(0),
        activo: vine.boolean().optional(),
        url: url().meta({ description: 'URL del NBI de GenieACS (o del proxy que lo protege)' }),
        usuario: vine.string().trim().maxLength(200).nullable().optional(),
        clave: secreto(),
        ca: vine
            .string()
            .trim()
            .maxLength(20_000)
            .nullable()
            .optional()
            .meta({ description: 'Certificado raíz propio del proxy HTTPS del NBI (PEM); null lo borra' }),
        pppoe_por_acs: vine.boolean().optional().meta({
            description:
                'Configurar usuario y clave PPPoE en el equipo por TR-069 al aprovisionar (solo con el ACS operativo)',
        }),
    }),
)
