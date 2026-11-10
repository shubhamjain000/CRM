"""nlp_queries app — natural-language CRM queries (Phase 18).

Lightweight NL→query-spec parser: keyword matching maps phrases like
"deals closing this month" → ``{model: "deal", filters: {close_date:
"this_month"}}``. The spec is executed against the appropriate CRM ORM
model and the result count + sample rows are returned. Saved queries
can be promoted to :mod:`reports` rows via ``save_as_report``.
"""
