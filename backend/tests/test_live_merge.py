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


def test_merge_patch_applies_index_keyed_dict_onto_list():
    # F1's live feed patches arrays as numeric-string-keyed objects; this must
    # update the list in place (by index) instead of replacing it with a dict,
    # otherwise downstream sectors[0] indexing raises KeyError.
    base = {"Sectors": [{"Value": "28.1"}, {"Value": "31.0"}, {"Value": "22.5"}]}
    patch = {"Sectors": {"1": {"Value": "30.4", "Segments": {"2": {"Status": 2051}}}}}
    result = merge_patch(base, patch)
    assert isinstance(result["Sectors"], list)
    assert result["Sectors"][0] == {"Value": "28.1"}
    assert result["Sectors"][1]["Value"] == "30.4"
    assert result["Sectors"][1]["Segments"] == {"2": {"Status": 2051}} or isinstance(
        result["Sectors"][1]["Segments"], list
    )
    assert result["Sectors"][2] == {"Value": "22.5"}


def test_merge_patch_index_keyed_dict_onto_nested_list_segments():
    base = {"Sectors": [{"Segments": [{"Status": 0}, {"Status": 0}]}]}
    patch = {"Sectors": {"0": {"Segments": {"1": {"Status": 2049}}}}}
    result = merge_patch(base, patch)
    assert result["Sectors"][0]["Segments"] == [{"Status": 0}, {"Status": 2049}]


def test_merge_patch_index_keyed_dict_extends_list_with_padding():
    base = {"s": [{"v": 1}]}
    patch = {"s": {"2": {"v": 3}}}
    result = merge_patch(base, patch)
    assert result["s"] == [{"v": 1}, None, {"v": 3}]


def test_merge_patch_does_not_mutate_inputs():
    base = {"a": {"b": 1}}
    patch = {"a": {"c": 2}}
    merge_patch(base, patch)
    assert base == {"a": {"b": 1}}
    assert patch == {"a": {"c": 2}}


def test_merge_patch_on_empty_base_returns_patch_shape():
    result = merge_patch({}, {"DriverList": {"1": {"Tla": "VER"}}})
    assert result == {"DriverList": {"1": {"Tla": "VER"}}}
