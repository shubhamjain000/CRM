import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { authenticateApiKey, requireScope } from '@/lib/api-keys'
import {
  handlePublicError,
  loadCustomFieldMap,
  ownerNameMap,
  parseListQuery,
  publicOk,
  serializeLead,
} from '../_helpers'

export const dynamic = 'force-dynamic'

/** GET /api/public/v1/leads — paginated lead list for BI pulls. */
export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req)
    requireScope(auth, 'read')

    const query = parseListQuery(new URL(req.url))

    const where: Prisma.LeadWhereInput = {
      organizationId: auth.organizationId,
      deletedAt: null,
      ...(query.modifiedSince ? { updatedAt: { gte: query.modifiedSince } } : {}),
    }

    const [records, total] = await Promise.all([
      db.lead.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      db.lead.count({ where }),
    ])

    const [customFieldMap, ownerNames] = await Promise.all([
      loadCustomFieldMap(auth.organizationId, 'lead', records.map((r) => r.id)),
      ownerNameMap(records.map((r) => r.ownerId)),
    ])

    return publicOk(
      records.map((r) => serializeLead(r, customFieldMap.get(r.id), ownerNames)),
      {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    )
  } catch (e) {
    return handlePublicError(e)
  }
}
