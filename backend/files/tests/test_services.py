"""Service-layer tests for the files app.

These tests cover the pure-Python helpers (DLP PII detection, etc.) that
don't depend on S3/MinIO being reachable.
"""

from __future__ import annotations

from files.services import detect_pii


def test_detect_pii_finds_credit_card():
    text = "My card is 4111 1111 1111 1111 and 5500-0000-0000-0004."
    findings = detect_pii(text)
    types = [f["type"] for f in findings]
    assert types.count("credit_card") == 2


def test_detect_pii_finds_ssn():
    text = "SSN on file: 123-45-6789."
    findings = detect_pii(text)
    assert {"type": "ssn", "value": "123-45-6789"} in findings


def test_detect_pii_finds_email():
    text = "Reach me at ada@example.com for details."
    findings = detect_pii(text)
    assert {"type": "email", "value": "ada@example.com"} in findings


def test_detect_pii_empty_text_returns_empty():
    assert detect_pii("") == []
    assert detect_pii(None) == []  # type: ignore[arg-type]


def test_detect_pii_no_findings_in_clean_text():
    text = "Just a regular meeting note about the Q3 roadmap."
    assert detect_pii(text) == []


def test_detect_pii_mixed_findings():
    text = (
        "Email ada@example.com, card 4111 1111 1111 1111, "
        "SSN 123-45-6789 — please scrub before export."
    )
    findings = detect_pii(text)
    types = sorted(f["type"] for f in findings)
    assert types == ["credit_card", "email", "ssn"]
