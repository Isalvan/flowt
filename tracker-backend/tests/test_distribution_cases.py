"""The income split must give the same result here and in the JavaScript domain.

Both test suites read the same cases; a change in either implementation that
is not mirrored in the other fails one of them.
"""
import json
from pathlib import Path

import pytest

from finance import domain as d
from reviews.domain import ReviewError

CASES = json.loads((Path(__file__).parent.parent / "finance" / "distribution_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[case["nombre"] for case in CASES])
def test_split_matches_the_shared_cases(case):
    if "error" in case:
        with pytest.raises(ReviewError) as raised:
            d.distribute_income(case["importe"], case["huchas"], case["plain"])
        assert raised.value.code == case["error"]
        return
    split = d.distribute_income(case["importe"], case["huchas"], case["plain"])
    assert split == case["esperado"]
    assert sum(split["saldos"].values()) == case["importe"]
