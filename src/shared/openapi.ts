/**
 * The OpenAPI 3.1 document, generated from the route table (#51).
 *
 * Generated rather than hand-kept. A spec written beside a router drifts, and
 * the half that drifts is always the spec — nobody notices a document that is
 * quietly wrong until an integrator does. Here there is one table
 * (`apiSurface.ts`), and the smoke checks it against the router's own source.
 *
 * Pure, and free of anything install-specific: no server name, id or count
 * appears, which is what makes it safe to serve without a credential.
 */
import {
  API_ROUTES,
  API_PREFIX,
  API_VERSION,
  apiGroups,
  operationId,
  type ApiGate,
  type ApiRoute
} from './apiSurface'

/** Bumped when the *document* changes shape, not when a route is added. */
export const OPENAPI_DOC_VERSION = '1.0.0'

const GATE_TEXT: Record<ApiGate, string> = {
  public: 'No credential required.',
  any: 'Any session or key.',
  owner: 'Owner **session** only — no API key can hold a role, so no key reaches this.',
  view: 'Scope `view` on the server.',
  console: 'Scope `console` on the server.',
  power: 'Scope `power` on the server.',
  players: 'Scope `players` on the server.',
  files: 'Scope `files` on the server.',
  backups: 'Scope `backups` on the server.',
  settings: 'Scope `settings` on the server.',
  store: 'Scope `store` on the server.',
  worlds: 'Scope `worlds` on the server.'
}

function describe(route: ApiRoute): string {
  const parts = [GATE_TEXT[route.gate]]
  if (route.confirm) {
    parts.push('Requires an explicit confirmation on top of the scope — see the reference.')
  }
  if (route.body) {
    parts.push(
      'Body fields:\n' +
        Object.entries(route.body)
          .map(([k, v]) => `- \`${k}\` — ${v}`)
          .join('\n')
    )
  }
  if (route.notes) parts.push(route.notes)
  return parts.join('\n\n')
}

const RESPONSES = {
  '200': { description: 'Success.' },
  '400': { description: 'Malformed request, or a missing confirmation.' },
  '401': { description: 'No usable credential.' },
  '403': { description: 'Authenticated, but not permitted — the body names what was needed.' },
  '404': { description: 'No such server, or no such route.' },
  '409': { description: 'Conflicts with the current state (running server, name taken, …).' },
  '429': { description: 'Rate limited. `Retry-After` says for how long.' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

export function openApiDocument(): Json {
  const paths: Json = {}
  for (const route of API_ROUTES) {
    const full = route.path === '/' ? API_PREFIX : API_PREFIX + route.path
    const item = (paths[full] ??= {})
    item[route.method.toLowerCase()] = {
      operationId: operationId(route),
      summary: route.summary,
      description: describe(route),
      tags: [route.group],
      ...(route.gate === 'public' ? { security: [] } : {}),
      ...(route.params?.length
        ? {
            parameters: route.params.map((p) => ({
              name: p.name,
              in: p.in,
              required: p.in === 'path' ? true : !!p.required,
              description: p.description,
              schema: { type: 'string' }
            }))
          }
        : {}),
      ...(route.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  // Deliberately open: the body shapes are documented as prose
                  // in the description rather than as sixty invented schemas,
                  // which would be sixty more things to keep true.
                  schema: { type: 'object', additionalProperties: true }
                }
              }
            }
          }
        : {}),
      responses: RESPONSES
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'MSMS integration API',
      version: API_VERSION,
      description: [
        'The surface a third-party application integrates with.',
        '',
        'Authenticate with an **API key** (`Authorization: Bearer msms_…` or',
        '`X-API-Key: msms_…`). A key is not a person: it carries its own scopes',
        'and its own server allowlist, and can never hold a role — routes marked',
        'owner-only are reachable from a panel session and from nothing else.',
        '',
        'Live push is a WebSocket at `/api/v1/stream`; it is not described here,',
        'because OpenAPI does not describe WebSocket protocols. See',
        '`docs/api-websocket.md`.',
        '',
        'This server is plain HTTP, bound to 127.0.0.1 unless the operator opts',
        'into LAN. TLS belongs to your own reverse proxy.'
      ].join('\n'),
      license: { name: 'MIT' }
    },
    servers: [{ url: 'http://127.0.0.1:8722', description: 'Default admin panel listener.' }],
    tags: apiGroups().map((g) => ({ name: g })),
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        bearer: { type: 'http', scheme: 'bearer', description: 'An API key or a session token.' }
      }
    },
    security: [{ apiKey: [] }, { bearer: [] }],
    paths
  }
}
