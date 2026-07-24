def merge_patch(base, patch):
    if isinstance(base, dict) and isinstance(patch, dict):
        result = dict(base)
        for key, value in patch.items():
            result[key] = merge_patch(result.get(key), value)
        return result

    if isinstance(base, list) and isinstance(patch, list):
        result = list(base)
        for index, value in enumerate(patch):
            if index < len(result):
                result[index] = merge_patch(result[index], value)
            else:
                result.append(value)
        return result

    # F1's live feed patches arrays as objects with numeric-string keys
    # ("Sectors": {"2": {"Segments": {"5": {...}}}}), so a dict patch onto a
    # list base is an index-keyed update, not a replacement. Applying it by
    # index keeps arrays as arrays, so downstream list-indexing (sectors,
    # segments, stints, best-sectors) keeps working instead of hitting the
    # dict and blowing up with KeyError.
    if isinstance(base, list) and isinstance(patch, dict) and all(isinstance(k, str) and k.isdigit() for k in patch):
        result = list(base)
        for key, value in patch.items():
            index = int(key)
            while index >= len(result):
                result.append(None)
            result[index] = merge_patch(result[index], value)
        return result

    return patch
