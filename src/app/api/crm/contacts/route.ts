import { makeListRoute, makeCreateRoute } from '@/lib/crm/routes'
export const dynamic = 'force-dynamic'
export const GET = makeListRoute('contact')
export const POST = makeCreateRoute('contact')
