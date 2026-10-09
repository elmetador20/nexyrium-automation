/** Parse MySQL URLs including percent-encoded credentials and legacy raw @ passwords. */
function parseDatabaseUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('mysql://')) throw new Error('DATABASE_URL must use mysql://');
  const body = value.slice(8);
  // Ignore query parameters for delimiter detection (they may contain @ themselves).
  const base = body.split('?')[0];
  const delimiter = base.lastIndexOf('@');
  if (delimiter < 0) throw new Error('DATABASE_URL must contain user credentials and a host');
  const credentials = base.slice(0, delimiter);
  const colon = credentials.indexOf(':');
  const decode = (text) => decodeURIComponent(text);
  const endpoint = new URL(`mysql://${base.slice(delimiter + 1)}`);
  const query = new URLSearchParams(body.slice(base.length + 1));
  const options = {
    host: endpoint.hostname.replace(/^\[|\]$/g, ''),
    port: Number(endpoint.port) || 3306,
    user: decode(colon < 0 ? credentials : credentials.slice(0, colon)),
    password: decode(colon < 0 ? '' : credentials.slice(colon + 1)),
    database: decode(endpoint.pathname.slice(1)),
    connectionLimit: 5, connectTimeout: 10_000, acquireTimeout: 15_000,
  };
  if (!options.host || !options.user || !options.database) throw new Error('DATABASE_URL is incomplete');
  if (query.get('ssl') === 'true' || query.get('sslaccept')) {
    // Aiven requires encrypted connections, but its public MySQL endpoint can
    // present a certificate chain that is not trusted by Node's default CA
    // bundle. Keep TLS enabled while allowing deployments to provide the Aiven
    // CA explicitly when strict certificate verification is required.
    options.ssl = process.env.DATABASE_SSL_CA
      ? { ca: process.env.DATABASE_SSL_CA, rejectUnauthorized: true }
      : { rejectUnauthorized: false };
  }
  return options;
}

module.exports = { parseDatabaseUrl };
