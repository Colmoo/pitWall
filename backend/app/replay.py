import asyncio
from collections.abc import AsyncIterator

from app.schema import SessionState


class ReplayEngine:
    def __init__(self, states: list[SessionState], speed: float = 1.0):
        self._states = states
        self._speed = speed

    async def stream(self) -> AsyncIterator[SessionState]:
        previous_timestamp = None
        for state in self._states:
            if previous_timestamp is not None:
                real_gap = (state.timestamp - previous_timestamp).total_seconds()
                await asyncio.sleep(real_gap / self._speed)
            previous_timestamp = state.timestamp
            yield state
