import { makeDetailRoutes } from '@/lib/crm/detail-routes'
export const dynamic = 'force-dynamic'
const { GET, PATCH, DELETE } = makeDetailRoutes('deal')
export { GET, PATCH, DELETE }
