import { makeListRoute, makeCreateRoute } from '@/lib/crm/routes'
export const dynamic = 'force-dynamic'
export const GET = makeListRoute('account')
export const POST = makeCreateRoute('account')
