def parse_sse_events(text: str) -> list[tuple[str, str]]:
    events: list[tuple[str, str]] = []
    for block in text.strip("\n").split("\n\n"):
        if not block.strip():
            continue

        event_type = "message"
        data_lines: list[str] = []
        for line in block.split("\n"):
            if line.startswith("event:"):
                event_type = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:"):].strip())

        if data_lines:
            events.append((event_type, "\n".join(data_lines)))

    return events
