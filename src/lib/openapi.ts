/**
 * OpenAPI 3.1 schema for the Foundation auth API. Mirrors the Django backend
 * `/openapi.json`. Consumed by `openapi-typescript` for a type-safe client.
 */
export const openapiSchema = {
  openapi: '3.1.0',
  info: {
    title: 'Foundation Auth API',
    version: '0.2.0',
    description: 'Enterprise multi-tenant auth: password, passkey, magic-link, 2FA, OAuth, SSO.',
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: {
      sessionAuth: { type: 'apiKey', in: 'cookie', name: 'fn_session' },
      bearerAuth: { type: 'http', scheme: 'bearer' },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key created under Settings → API & BI. Also accepted as `Authorization: Bearer <key>`.',
      },
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          is2faEnabled: { type: 'boolean' },
          hasPasskey: { type: 'boolean' },
        },
      },
      Organization: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          slug: { type: 'string' },
          subdomain: { type: 'string' },
          role: { type: 'string' },
          membersCount: { type: 'integer' },
        },
      },
      Role: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          permissions: { type: 'array', items: { type: 'string' } },
          parentId: { type: 'string', nullable: true },
          isSystem: { type: 'boolean' },
        },
      },
      AuditLog: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          action: { type: 'string' },
          actorEmail: { type: 'string', nullable: true },
          ip: { type: 'string', nullable: true },
          metadata: { type: 'object' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/auth/signup': {
      post: {
        summary: 'Create account + personal organization',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'name', 'password'],
                properties: {
                  email: { type: 'string' },
                  name: { type: 'string' },
                  password: { type: 'string' },
                  orgName: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Created' } },
      },
    },
    '/auth/login': {
      post: {
        summary: 'Password login (optionally followed by 2FA)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: { email: { type: 'string' }, password: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Logged in' }, '202': { description: '2FA required' } },
      },
    },
    '/auth/passkey/login-begin': { post: { summary: 'Begin passkey login', responses: { '200': { description: 'Options' } } } },
    '/auth/passkey/login-finish': { post: { summary: 'Finish passkey login', responses: { '200': { description: 'Logged in' } } } },
    '/auth/magic-link': { post: { summary: 'Send magic link', responses: { '200': { description: 'Sent' } } } },
    '/auth/magic-link/verify': { post: { summary: 'Verify magic link', responses: { '200': { description: 'Logged in' } } } },
    '/auth/logout': { post: { summary: 'Logout', responses: { '200': { description: 'OK' } } } },
    '/auth/me': { get: { summary: 'Current user', responses: { '200': { description: 'User' } } } },
    '/auth/2fa/setup': { post: { summary: 'Generate TOTP secret + URI', responses: { '200': { description: 'Secret' } } } },
    '/auth/2fa/verify': { post: { summary: 'Verify & enable 2FA', responses: { '200': { description: 'Enabled' } } } },
    '/auth/2fa/disable': { post: { summary: 'Disable 2FA', responses: { '200': { description: 'Disabled' } } } },
    '/auth/passkey/register-begin': { post: { summary: 'Begin passkey registration', responses: { '200': { description: 'Options' } } } },
    '/auth/passkey/register-finish': { post: { summary: 'Finish passkey registration', responses: { '200': { description: 'Registered' } } } },
    '/auth/passkey/{id}': { delete: { summary: 'Delete one of my passkeys', responses: { '200': { description: 'OK' } } } },
    '/organizations': { get: { summary: 'List my orgs', responses: { '200': { description: 'Orgs' } } } },
    '/organizations/switch': { post: { summary: 'Switch current org', responses: { '200': { description: 'OK' } } } },
    '/users': { get: { summary: 'List org users', responses: { '200': { description: 'Users' } } } },
    '/roles': { get: { summary: 'List org roles', responses: { '200': { description: 'Roles' } } } },
    '/audit': { get: { summary: 'List audit events', responses: { '200': { description: 'Events' } } } },
    '/devices': { get: { summary: 'List sessions', responses: { '200': { description: 'Sessions' } } } },
    '/settings/api-keys': {
      get: { summary: 'List API keys (own keys, or all for org admins)', responses: { '200': { description: 'Keys (keyHash never returned)' } } },
      post: {
        summary: 'Create an API key (plaintext returned once)',
        security: [{ sessionAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', maxLength: 80 },
                  scope: { type: 'string', enum: ['read', 'write'], default: 'read' },
                  expiresInDays: { type: 'integer', enum: [30, 60, 90], nullable: true },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created — includes the full `key` (shown once)' } },
      },
    },
    '/settings/api-keys/{id}': {
      delete: {
        summary: 'Revoke an API key (owner or org admin)',
        security: [{ sessionAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
    },
    '/public/v1/ping': {
      get: {
        summary: 'Test connection — resolves the key\'s organization (X-API-Key auth)',
        security: [{ apiKeyAuth: [] }],
        responses: { '200': { description: 'Organization + API version' } },
      },
    },
    '/public/v1/contacts': {
      get: {
        summary: 'List contacts (paginated, modified_since incremental sync)',
        security: [{ apiKeyAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
          { name: 'modified_since', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { '200': { description: 'Contacts + pagination (includes custom fields)' } },
      },
      post: {
        summary: 'Create a contact (write scope required)',
        security: [{ apiKeyAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['firstName'],
                properties: {
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  email: { type: 'string' },
                  phone: { type: 'string' },
                  ownerId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created contact' } },
      },
    },
    '/public/v1/contacts/{id}': {
      get: {
        summary: 'Get one contact by id (X-API-Key auth)',
        security: [{ apiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Contact' }, '404': { description: 'Not found' } },
      },
    },
    '/public/v1/leads': {
      get: {
        summary: 'List leads (paginated, X-API-Key auth)',
        security: [{ apiKeyAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
          { name: 'modified_since', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { '200': { description: 'Leads + pagination' } },
      },
    },
    '/public/v1/deals': {
      get: {
        summary: 'List deals (paginated, X-API-Key auth)',
        security: [{ apiKeyAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
          { name: 'modified_since', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { '200': { description: 'Deals + pagination' } },
      },
    },
  },
} as const

export type OpenAPISchema = typeof openapiSchema
