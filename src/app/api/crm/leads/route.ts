import { makeListRoute, makeCreateRoute } from '@/lib/crm/routes'
export const dynamic = 'force-dynamic'
export const GET = makeListRoute('lead')
export const POST = makeCreateRoute('lead')
