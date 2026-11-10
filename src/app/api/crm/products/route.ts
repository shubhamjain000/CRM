import { makeListRoute, makeCreateRoute } from '@/lib/crm/routes'
export const dynamic = 'force-dynamic'
export const GET = makeListRoute('product')
export const POST = makeCreateRoute('product')
