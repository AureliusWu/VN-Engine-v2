import { isRecord } from '../storage/save.js';
type Schema = Record<string, any>;

/** Validator for the JSON Schema vocabulary emitted above; no executable author input. */
export function schemaErrors(schema: Schema, value: unknown, path: (string | number)[] = []): { path: (string | number)[]; message: string }[] {
  const error = (message: string) => [{ path, message }];
  if (schema.oneOf || schema.anyOf) {
    const matches = (schema.oneOf ?? schema.anyOf).filter((item: Schema) => !schemaErrors(item, value, path).length).length;
    return matches >= 1 && (!schema.oneOf || matches === 1) ? [] : error('Value does not match the declared alternatives');
  }
  if ('const' in schema && value !== schema.const) return error('Unexpected constant');
  if (schema.enum && !schema.enum.includes(value)) return error('Value is outside the declared enumeration');
  const type = schema.type;
  if (type && !(type === 'object' ? isRecord(value) : type === 'array' ? Array.isArray(value) : type === 'null' ? value === null
    : type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value) : typeof value === type)) return error('Expected ' + type);
  if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) return error('Number is outside bounds');
  if (typeof value === 'string' && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) return error('String does not match constraints');
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return error('Array size is outside bounds');
    return schema.items ? value.flatMap((item, i) => schemaErrors(schema.items, item, [...path, i])) : [];
  }
  if (isRecord(value)) {
    const errors = (schema.required ?? []).filter((key: string) => !Object.hasOwn(value, key)).flatMap((key: string) => [{ path: [...path, key], message: 'Required field is missing' }]);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...schemaErrors(schema.properties[key], item, [...path, key]));
      else if (schema.additionalProperties === false) errors.push({ path: [...path, key], message: 'Unknown field' });
    } return errors;
  } return [];
}
