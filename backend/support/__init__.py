"""support app — helpdesk tickets, replies, KB articles (Phase 19).

Three tenant-scoped models:

* :class:`Ticket` — a customer support ticket with priority / status /
  category, optional assignee + SLA deadline.
* :class:`TicketReply` — a threaded reply on a :class:`Ticket`; may be
  marked ``is_internal`` (private note).
* :class:`KnowledgeBaseArticle` — a publishable KB article with view +
  helpful counters.
"""
