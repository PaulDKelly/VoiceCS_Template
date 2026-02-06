from bot_main import resolve_routing


def test_resolve_routing_prefers_normalized_match():
    mappings = {
        "+441156473116": {"client_id": "Thirsty Work", "industry": "sales"}
    }

    client_id, industry, found, candidate_used, candidates = resolve_routing(
        "+44 115-647-3116",
        mappings,
        None,
        None,
    )

    assert found is True
    assert client_id == "Thirsty Work"
    assert industry == "sales"
    assert candidate_used in candidates
