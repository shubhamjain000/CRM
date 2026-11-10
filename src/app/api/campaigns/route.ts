import { makeListRoute, makeCreateRoute } from '@/lib/crm/routes'
export const dynamic = 'force-dynamic'
export const GET = makeListRoute('campaign')
export const POST = makeCreateRoute('campaign')
