import httpx

from app.schema import SessionState, TrackStatus


def summarize_changes(previous: SessionState | None, current: SessionState) -> str:
    if previous is None:
        return "Session start."

    lines: list[str] = []
    previous_by_number = {d.driver_number: d for d in previous.drivers}

    for driver in current.drivers:
        prev = previous_by_number.get(driver.driver_number)
        if prev is None:
            continue
        if driver.position != prev.position:
            lines.append(f"{driver.abbreviation} moved from P{prev.position} to P{driver.position}.")
        if driver.best_lap_time is not None and (
            prev.best_lap_time is None or driver.best_lap_time < prev.best_lap_time
        ):
            lines.append(f"{driver.abbreviation} set a new best lap: {driver.best_lap_time:.3f}s.")
        if driver.tire.compound != prev.tire.compound:
            lines.append(f"{driver.abbreviation} pitted for {driver.tire.compound} tires.")

    if current.track_status != TrackStatus.GREEN:
        lines.append(f"Track status: {current.track_status.value}.")

    if not lines:
        return "No significant changes since last check."
    return " ".join(lines)


def describe_state(state: SessionState) -> str:
    if not state.drivers:
        return "No drivers on track."
    top3 = ", ".join(f"{d.abbreviation} (P{d.position})" for d in state.drivers[:3])
    return f"Track status: {state.track_status.value}. Top 3: {top3}."


async def call_ollama(
    prompt: str, host: str, model: str, transport: httpx.AsyncBaseTransport | None = None
) -> str | None:
    try:
        async with httpx.AsyncClient(transport=transport, timeout=30.0) as client:
            response = await client.post(
                f"{host}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            response.raise_for_status()
            return response.json().get("response")
    except (httpx.HTTPError, ValueError):
        return None
