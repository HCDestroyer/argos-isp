/*
|--------------------------------------------------------------------------
| Mensajes de VineJS en español
|--------------------------------------------------------------------------
|
| Se usan en `errors[].message` de los Problem 422.
|
*/
import vine, { SimpleMessagesProvider } from '@vinejs/vine'

vine.messagesProvider = new SimpleMessagesProvider({
    required: 'El campo {{ field }} es obligatorio',
    string: 'El campo {{ field }} debe ser texto',
    email: 'El campo {{ field }} debe ser un correo válido',
    regex: 'El campo {{ field }} no tiene un formato válido',
    minLength: 'El campo {{ field }} debe tener al menos {{ min }} caracteres',
    maxLength: 'El campo {{ field }} no debe tener más de {{ max }} caracteres',
    fixedLength: 'El campo {{ field }} debe tener {{ size }} caracteres',
    in: 'El valor de {{ field }} no es válido',
    notIn: 'El valor de {{ field }} no es válido',
    ipAddress: 'El campo {{ field }} debe ser una dirección IP válida',
    uuid: 'El campo {{ field }} debe ser un UUID válido',
    url: 'El campo {{ field }} debe ser una URL válida',
    boolean: 'El campo {{ field }} debe ser verdadero o falso',
    number: 'El campo {{ field }} debe ser un número',
    min: 'El campo {{ field }} debe ser al menos {{ min }}',
    max: 'El campo {{ field }} no debe ser mayor que {{ max }}',
    range: 'El campo {{ field }} debe estar entre {{ min }} y {{ max }}',
    positive: 'El campo {{ field }} debe ser positivo',
    nonNegative: 'El campo {{ field }} debe ser cero o positivo',
    decimal: 'El campo {{ field }} debe tener {{ digits }} decimales',
    withoutDecimals: 'El campo {{ field }} debe ser un entero',
    enum: 'El valor de {{ field }} no es válido',
    literal: 'El campo {{ field }} debe ser {{ expectedValue }}',
    object: 'El campo {{ field }} debe ser un objeto',
    record: 'El campo {{ field }} debe ser un objeto',
    array: 'El campo {{ field }} debe ser una lista',
    'array.minLength': 'El campo {{ field }} debe tener al menos {{ min }} elementos',
    'array.maxLength': 'El campo {{ field }} no debe tener más de {{ max }} elementos',
    notEmpty: 'El campo {{ field }} no debe estar vacío',
    distinct: 'El campo {{ field }} tiene valores repetidos',
    union: 'Valor inválido para {{ field }}',
    date: 'El campo {{ field }} debe ser una fecha válida',
    'date.after': 'El campo {{ field }} debe ser posterior a {{ expectedValue }}',
    'date.before': 'El campo {{ field }} debe ser anterior a {{ expectedValue }}',
})
