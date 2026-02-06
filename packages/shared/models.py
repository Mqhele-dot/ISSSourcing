from pydantic import BaseModel
from typing import Literal


class ExceptionCaseModel(BaseModel):
    id: int
    type: str
    severity: Literal['low', 'medium', 'high']
    status: Literal['open', 'closed']
    linked_entity_id: str
    assignee: str | None = None
    reason: str | None = None
