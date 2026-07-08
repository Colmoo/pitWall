from app.sse_parser import parse_sse_events


def test_parse_sse_events_extracts_event_type_and_data():
    text = 'event: initial\ndata: {"a": 1}\n\n'
    events = parse_sse_events(text)
    assert events == [("initial", '{"a": 1}')]


def test_parse_sse_events_defaults_to_message_when_no_event_line():
    text = 'data: {"a": 1}\n\n'
    events = parse_sse_events(text)
    assert events == [("message", '{"a": 1}')]


def test_parse_sse_events_handles_multiple_events():
    text = 'event: initial\ndata: {"a": 1}\n\nevent: update\ndata: {"b": 2}\n\n'
    events = parse_sse_events(text)
    assert events == [("initial", '{"a": 1}'), ("update", '{"b": 2}')]


def test_parse_sse_events_joins_multiline_data():
    text = 'event: update\ndata: line1\ndata: line2\n\n'
    events = parse_sse_events(text)
    assert events == [("update", "line1\nline2")]


def test_parse_sse_events_ignores_blocks_with_no_data():
    text = 'event: initial\n\nevent: update\ndata: {"b": 2}\n\n'
    events = parse_sse_events(text)
    assert events == [("update", '{"b": 2}')]
