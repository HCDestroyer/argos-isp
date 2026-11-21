import {
    booleano,
    definirEsquema,
    enumerado,
    id,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { RELACIONES_CONTACTO } from '#core/contactos'

/** Esquemas de contactos del cliente (contrato Iris 0.10.0 §3.5, A42; 0.10.1 §3.8, A46). */

export const PermisosContacto = definirEsquema(
    'PermisosContacto',
    objeto({ consultar: booleano, reportar: booleano, pagar: booleano, avisos: booleano }),
)

export const TelefonoContacto = definirEsquema(
    'TelefonoContacto',
    objeto({
        numero: { ...texto, description: 'E.164 (`+50255123344`)' },
        whatsapp: booleano,
        principal: booleano,
        adicional: {
            ...booleano,
            description: 'Número adicional del titular: no cuenta como registrado (contacto no verificado)',
        },
    }),
)

export const ContactoCliente = definirEsquema(
    'ContactoCliente',
    objeto({
        contacto_id: id,
        cliente_id: id,
        empresa_id: nulable(id),
        nombre: texto,
        relacion: enumerado(RELACIONES_CONTACTO),
        es_titular: booleano,
        servicios: {
            ...nulable(lista(id)),
            description: 'Servicios del cliente a los que aplica; null = todos',
        },
        permisos: PermisosContacto,
        telefonos: {
            ...lista(TelefonoContacto),
            description:
                'En el titular, solo los adicionales: sus números registrados son `telefono` y `movil` del cliente',
        },
        persona_cliente_id: { ...nulable(id), description: 'Otro cliente que es esta persona (A46)' },
        origen: enumerado(['argos', 'iris', 'portal']),
        version: { type: 'integer' },
        created_at: instante,
        updated_at: instante,
    }),
)

export const ContactoEncontrado = definirEsquema(
    'ContactoEncontrado',
    objeto({
        cliente_id: id,
        empresa_id: nulable(id),
        contacto_id: id,
        nombre: texto,
        relacion: enumerado(RELACIONES_CONTACTO),
        es_titular: booleano,
        adicional: { ...booleano, description: 'El número es un adicional del titular (no verificado)' },
        a_cargo: { ...booleano, description: 'El número no es del titular (0.10.1, §3.8)' },
        servicios: nulable(lista(id)),
        permisos: PermisosContacto,
    }),
)
