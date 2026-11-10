import { db } from '@/lib/db'
import { authenticateApiKey, requireScope } from '@/lib/api-keys'
import {
  handlePublicError,
  loadCustomFieldMap,
  ownerNameMap,
  publicFail,
  publicOk,
  serializeContact,
} from '../../_helpers'

export const dynamic = 'force-dynamic'

/** GET /api/public/v1/contacts/{id} — fetch a single contact with custom fields. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateApiKey(req)
    requireScope(auth, 'read')

    const { id } = await params
    const record = await db.contact.findFirst({
      where: { id, organizationId: auth.organizationId, deletedAt: null },
      include: { account: { select: { name: true } } },
    })
    if (!record) return publicFail('Contact not found', 404)

    const [customFieldMap, ownerNames] = await Promise.all([
      loadCustomFieldMap(auth.organizationId, 'contact', [record.id]),
      ownerNameMap([record.ownerId]),
    ])

    return publicOk(serializeContact(record, customFieldMap.get(record.id), ownerNames))
  } catch (e) {
    return handlePublicError(e)
  }
}
