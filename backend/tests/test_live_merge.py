from app.live_merge import merge_patch


def test_merge_patch_recursively_merges_nested_dicts():
    base = {"DriverList": {"1": {"Tla": "VER", "TeamName": "Red Bull"}}}
    patch = {"DriverList": {"1": {"Tla": "VER"}, "44": {"Tla": "HAM"}}}
    result = merge_patch(base, patch)
    assert result == {
        "DriverList": {
            "1": {"Tla": "VER", "TeamName": "Red Bull"},
            "44": {"Tla": "HAM"},
        }
    }


def test_merge_patch_replaces_scalar_values():
    base = {"TrackStatus": {"Status": "1", "Message": "AllClear"}}
    patch = {"TrackStatus": {"Status": "2"}}
    result = merge_patch(base, patch)
    assert result == {"TrackStatus": {"Status": "2", "Message": "AllClear"}}


def test_merge_patch_merges_lists_by_index_and_extends():
    base = {"Sectors": [{"Value": "28.1"}, {"Value": "31.0"}]}
    patch = {"Sectors": [{"Value": "27.9"}, {}, {"Value": "32.0"}]}
    result = merge_patch(base, patch)
    assert result == {
        "Sectors": [{"Value": "27.9"}, {"Value": "31.0"}, {"Value": "32.0"}]
    }


def test_merge_patch_does_not_mutate_inputs():
    base = {"a": {"b": 1}}
    patch = {"a": {"c": 2}}
    merge_patch(base, patch)
    assert base == {"a": {"b": 1}}
    assert patch == {"a": {"c": 2}}


def test_merge_patch_on_empty_base_returns_patch_shape():
    result = merge_patch({}, {"DriverList": {"1": {"Tla": "VER"}}})
    assert result == {"DriverList": {"1": {"Tla": "VER"}}}
