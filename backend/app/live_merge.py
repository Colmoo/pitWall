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

    return patch
