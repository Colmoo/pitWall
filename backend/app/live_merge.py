# ponytail: merges in place and returns base - the live tree is single-owner
# (live_adapter reassigns the result to the same 'tree'/'last_tree'), so copying
# the whole tree per patch was pure allocation. Copy at the call site if a second
# owner ever needs the pre-merge tree.
def merge_patch(base, patch):
    if isinstance(base, dict) and isinstance(patch, dict):
        for key, value in patch.items():
            base[key] = merge_patch(base.get(key), value)
        return base

    if isinstance(base, list) and isinstance(patch, list):
        for index, value in enumerate(patch):
            if index < len(base):
                base[index] = merge_patch(base[index], value)
            else:
                base.append(value)
        return base

    # F1's live feed patches arrays as objects with numeric-string keys
    # ("Sectors": {"2": {"Segments": {"5": {...}}}}), so a dict patch onto a
    # list base is an index-keyed update, not a replacement. Applying it by
    # index keeps arrays as arrays, so downstream list-indexing (sectors,
    # segments, stints, best-sectors) keeps working instead of hitting the
    # dict and blowing up with KeyError.
    if isinstance(base, list) and isinstance(patch, dict) and all(isinstance(k, str) and k.isdigit() for k in patch):
        for key, value in patch.items():
            index = int(key)
            while index >= len(base):
                base.append(None)
            base[index] = merge_patch(base[index], value)
        return base

    return patch
