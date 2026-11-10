"""Territories app — geographic / vertical territory management.

Phase 17 — Salesforce-Territory-equivalent: groups of users own a
slice of the CRM (e.g. "US West Accounts" / "EMEA Enterprise"). The
territory's ``rules`` JSON encodes the assignment criteria; the
``realign`` service walks every member and re-assigns matching
records.

* :class:`Territory` — name + rules JSON + manager (User) + parent
  (self-FK for nested territories).
* :class:`TerritoryMember` — (territory, user) pair.
"""
