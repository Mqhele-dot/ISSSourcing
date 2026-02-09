from dataclasses import dataclass


@dataclass
class ConnectorResult:
    status: str
    processed: int
    message: str = ""
    batch_id: int | None = None
    errors: int = 0


class Connector:
    name = "base"

    def run(self) -> ConnectorResult:
        raise NotImplementedError
