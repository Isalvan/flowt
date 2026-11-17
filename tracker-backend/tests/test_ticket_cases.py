"""Identical raw model cases run in pytest and the Worker's Vitest suite."""
import json
from pathlib import Path

import pytest

from finance.tickets import sanitize_ticket
from reviews.domain import ReviewError

CASES = json.loads((Path(__file__).parents[1] / "finance" / "ticket_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[case["nombre"] for case in CASES])
def test_ticket_matches_shared_cases(case):
    if "error" in case:
        with pytest.raises(ReviewError) as raised:
            sanitize_ticket(case["entrada"], case["hoy"])
        assert raised.value.code == case["error"]
    else:
        assert sanitize_ticket(case["entrada"], case["hoy"]) == case["esperado"]


@pytest.mark.parametrize("total", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_amounts_are_not_tickets(total):
    with pytest.raises(ReviewError) as raised:
        sanitize_ticket({**CASES[0]["entrada"], "total": total}, "2026-11-17")
    assert raised.value.code == "not_a_ticket"
