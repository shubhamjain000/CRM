import { makeDetailRoutes } from '@/lib/crm/detail-routes'
export const dynamic = 'force-dynamic'
const { GET, PATCH, DELETE } = makeDetailRoutes('account')
export { GET, PATCH, DELETE }
