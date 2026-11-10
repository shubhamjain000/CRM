"""data_security app — data classification + retention policies
(Phase 20).

Two tenant-scoped models:

* :class:`DataClassification` — per-field classification tag
  (public / internal / confidential / restricted).
* :class:`RetentionPolicy` — per-model retention window + action
  (archive / delete).
"""
