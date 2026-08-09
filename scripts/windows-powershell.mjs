export function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}
